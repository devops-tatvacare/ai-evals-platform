"""Parallel execution engine for evaluation runners.

Provides a single `run_parallel()` function that both batch and adversarial
runners use to process items concurrently with bounded parallelism.

With concurrency=1, behavior is identical to a sequential for-loop.
"""
import asyncio
import logging
from typing import TypeVar, Sequence, Callable, Awaitable

from app.services.job_worker import is_job_cancelled, JobCancelledError

logger = logging.getLogger(__name__)

T = TypeVar("T")
R = TypeVar("R")


async def run_parallel(
    items: Sequence[T],
    worker: Callable[[int, T], Awaitable[R]],
    *,
    concurrency: int = 1,
    job_id,
    progress_callback: Callable[[int, int, str], Awaitable[None]] | None = None,
    progress_message: Callable[[int, int, int, int], str] | None = None,
    inter_item_delay: float = 0,
) -> list[R | BaseException]:
    """Run worker(index, item) for each item with bounded concurrency.

    Args:
        items: Sequence of items to process.
        worker: async (index, item) -> result. Index is 0-based.
        concurrency: Max in-flight workers. 1 = sequential.
        job_id: For cancellation checks.
        progress_callback: async (current, total, message) -> None.
        progress_message: (completed_ok, errors, current, total) -> str.
            Defaults to "Item {current}/{total} ({ok} ok, {err} errors)".
        inter_item_delay: Seconds to wait between starting each item
            (stagger starts for rate limiting). Uses a lock so delay
            applies even with concurrent workers.

    Returns:
        List of results in input order. Failed items are BaseException instances.
    """
    total = len(items)
    if total == 0:
        return []

    results: list[R | BaseException] = [None] * total  # type: ignore[list-item]
    completed_count = 0
    ok_count = 0
    error_count = 0
    semaphore = asyncio.Semaphore(concurrency)
    delay_lock = asyncio.Lock() if inter_item_delay > 0 else None

    def _default_message(ok: int, err: int, current: int, tot: int) -> str:
        return f"Item {current}/{tot} ({ok} ok, {err} errors)"

    msg_fn = progress_message or _default_message

    async def _run_one(index: int, item: T):
        nonlocal completed_count, ok_count, error_count

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # Stagger starts if delay is configured
        if delay_lock and index > 0:
            async with delay_lock:
                await asyncio.sleep(inter_item_delay)

        async with semaphore:
            if await is_job_cancelled(job_id):
                raise JobCancelledError("Job was cancelled by user")

            try:
                results[index] = await worker(index, item)
                ok_count += 1
            except JobCancelledError:
                raise
            except BaseException as exc:
                results[index] = exc
                error_count += 1

            completed_count += 1
            if progress_callback:
                await progress_callback(
                    completed_count, total,
                    msg_fn(ok_count, error_count, completed_count, total),
                )

    if concurrency <= 1:
        # Sequential path — exact same behavior as a for loop
        for i, item in enumerate(items):
            await _run_one(i, item)
    else:
        # Parallel path — create tasks and wait for all
        tasks = []
        for i, item in enumerate(items):
            tasks.append(asyncio.create_task(_run_one(i, item)))

        # Wait for all tasks; on cancellation, cancel remaining
        try:
            await asyncio.gather(*tasks)
        except JobCancelledError:
            for t in tasks:
                if not t.done():
                    t.cancel()
            # Wait for cancellation to propagate
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

    return results
