import asyncio
import uuid
from typing import Callable


def normalize_kaira_credential_pool(
    raw_pool: list[dict] | None,
    *,
    fallback_user_id: str,
    fallback_auth_token: str,
) -> list[dict]:
    normalized: list[dict] = []
    seen_user_ids: set[str] = set()

    def _append_pair(user_id: str, auth_token: str) -> None:
        clean_user_id = str(user_id or '').strip()
        clean_auth_token = str(auth_token or '').strip()
        if not clean_user_id or not clean_auth_token:
            return
        signature = clean_user_id.lower()
        if signature in seen_user_ids:
            return
        seen_user_ids.add(signature)
        normalized.append({
            'user_id': clean_user_id,
            'auth_token': clean_auth_token,
        })

    for item in raw_pool or []:
        if not isinstance(item, dict):
            continue
        _append_pair(
            item.get('user_id') or item.get('userId') or '',
            item.get('auth_token') or item.get('authToken') or '',
        )

    _append_pair(fallback_user_id, fallback_auth_token)
    return normalized


async def run_cases_with_credential_lanes(
    *,
    cases: list,
    credentials: list[dict],
    worker,
    concurrency: int,
    job_id,
    tenant_id: uuid.UUID,
    progress_callback,
    progress_message: Callable[[int, int, int, int], str],
    inter_item_delay: float,
    client_factory: Callable[[dict], object],
    is_job_cancelled,
    cancelled_error_cls: type[BaseException],
) -> list[dict | BaseException]:
    total = len(cases)
    if total == 0:
        return []

    results: list[dict | BaseException] = [None] * total  # type: ignore[list-item]
    completed_count = 0
    ok_count = 0
    error_count = 0
    queue: asyncio.Queue[tuple[int, object]] = asyncio.Queue()
    state_lock = asyncio.Lock()
    delay_lock = asyncio.Lock() if inter_item_delay > 0 else None

    for index, case in enumerate(cases):
        queue.put_nowait((index, case))

    async def _lane_worker(lane_index: int, credential: dict) -> None:
        nonlocal completed_count, ok_count, error_count

        client = client_factory(credential)
        await client.open()
        try:
            while True:
                if await is_job_cancelled(job_id, tenant_id=tenant_id):
                    raise cancelled_error_cls('BackgroundJob was cancelled by user')

                try:
                    index, case = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

                if delay_lock and index > 0:
                    async with delay_lock:
                        await asyncio.sleep(inter_item_delay)

                try:
                    results[index] = await worker(index, case, credential, client, lane_index)
                    item_failed = False
                except cancelled_error_cls:
                    queue.task_done()
                    raise
                except BaseException as exc:
                    results[index] = exc
                    item_failed = True
                finally:
                    queue.task_done()

                async with state_lock:
                    completed_count += 1
                    if item_failed:
                        error_count += 1
                    else:
                        ok_count += 1
                    current = completed_count
                    current_ok = ok_count
                    current_errors = error_count

                if progress_callback:
                    await progress_callback(
                        current,
                        total,
                        progress_message(current_ok, current_errors, current, total),
                    )
        finally:
            await client.close()

    lane_count = min(max(concurrency, 1), len(credentials), total)
    tasks = [
        asyncio.create_task(_lane_worker(index, credentials[index]))
        for index in range(lane_count)
    ]

    try:
        await asyncio.gather(*tasks)
    except cancelled_error_cls:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise

    return results
