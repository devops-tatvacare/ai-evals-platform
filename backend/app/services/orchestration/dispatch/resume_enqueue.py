"""Idempotent delayed BackgroundJob enqueue for workflow resume — collapses concurrent producers."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_USER_ID
from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRun


_log = logging.getLogger(__name__)


_IDEMPOTENCY_INDEX_ELEMENTS: tuple[str, ...] = (
    "tenant_id", "user_id", "idempotency_key",
)
_IDEMPOTENCY_INDEX_WHERE = text("idempotency_key IS NOT NULL")


async def _idempotent_insert(
    db: AsyncSession, *, values: dict,
) -> Optional[uuid.UUID]:
    """Insert-or-no-op against the partial unique index; returns new id or None on conflict."""
    stmt = (
        pg_insert(BackgroundJob)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=list(_IDEMPOTENCY_INDEX_ELEMENTS),
            index_where=_IDEMPOTENCY_INDEX_WHERE,
        )
        .returning(BackgroundJob.id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def enqueue_resume_for_recipient(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    recipient_id: str,
    available_at: Optional[datetime] = None,
    reason: str,
) -> Optional[uuid.UUID]:
    """Insert a delayed ``run-workflow`` resume job; idempotency key folds in ``reason``."""
    run = await db.scalar(
        select(WorkflowRun).where(WorkflowRun.id == run_id)
    )
    if run is None:
        _log.warning(
            "orchestration.resume_enqueue.run_missing run_id=%s recipient_id=%s",
            run_id, recipient_id,
        )
        return None

    user_id = run.triggered_by_user_id or SYSTEM_USER_ID
    idem = f"run-resume:{run_id}:{recipient_id}:{reason}"

    av_at = available_at
    if av_at is not None and av_at.tzinfo is None:
        av_at = av_at.replace(tzinfo=timezone.utc)

    return await _idempotent_insert(
        db,
        values={
            "id": uuid.uuid4(),
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "user_id": user_id,
            "job_type": "run-workflow",
            "queue_class": "standard",
            "priority": 5,
            "status": "queued",
            "available_at": av_at,
            "idempotency_key": idem,
            "params": {
                "run_id": str(run_id),
                "resume_recipient_ids": [recipient_id],
                "tenant_id": str(run.tenant_id),
                "user_id": str(user_id),
            },
        },
    )
