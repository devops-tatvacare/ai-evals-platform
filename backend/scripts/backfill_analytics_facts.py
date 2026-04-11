"""
Backfill analytics fact tables from existing completed eval_runs.
Idempotent — deletes existing facts for a run before re-inserting.

Usage:
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts --app-id kaira-bot
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts --run-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from uuid import UUID

from sqlalchemy import select

from app.database import async_session
from app.models.eval_run import EvalRun
from app.services.analytics.fact_populator import FactPopulator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def backfill(app_id: str | None = None, run_id: str | None = None) -> None:
    """Backfill analytics facts for completed runs."""
    start = time.monotonic()

    async with async_session() as db:
        # Build query for completed runs
        query = (
            select(EvalRun.id, EvalRun.app_id, EvalRun.eval_type)
            .where(EvalRun.status.in_(["completed", "completed_with_errors"]))
            .order_by(EvalRun.created_at.asc())
        )

        if run_id:
            query = query.where(EvalRun.id == UUID(run_id))
        if app_id:
            query = query.where(EvalRun.app_id == app_id)

        result = await db.execute(query)
        runs = result.all()

    total = len(runs)
    if total == 0:
        logger.info("No completed runs found matching filters")
        return

    logger.info("Found %d runs to backfill", total)

    success = 0
    failed = 0
    total_rows = 0

    for i, (rid, aid, etype) in enumerate(runs, 1):
        try:
            async with async_session() as db:
                populator = FactPopulator(db)
                pop_result = await populator.populate(rid)
                total_rows += pop_result.rows_inserted
                success += 1
                logger.info(
                    "[%d/%d] Backfilled run %s (app=%s type=%s): %d rows",
                    i, total, str(rid)[:8], aid, etype, pop_result.rows_inserted,
                )
        except Exception as e:
            failed += 1
            logger.error(
                "[%d/%d] FAILED run %s (app=%s type=%s): %s",
                i, total, str(rid)[:8], aid, etype, e,
            )

    elapsed = time.monotonic() - start
    logger.info(
        "Done. %d/%d runs backfilled, %d failed, %d total fact rows in %.1fs",
        success, total, failed, total_rows, elapsed,
    )


def main():
    parser = argparse.ArgumentParser(description="Backfill analytics fact tables")
    parser.add_argument("--app-id", help="Filter by app_id")
    parser.add_argument("--run-id", help="Backfill a single run by ID")
    args = parser.parse_args()

    asyncio.run(backfill(app_id=args.app_id, run_id=args.run_id))


if __name__ == "__main__":
    main()
