"""Manifest guard: every dispatch node consults this before any side effect."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowRunRecipient
from app.services.orchestration.errors import RecipientNotInManifestError


async def assert_recipient_in_manifest(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    recipient_id: str,
) -> WorkflowRunRecipient:
    """Return the manifest row for ``(run_id, recipient_id)`` or raise.

    Dispatch nodes call this as their first per-recipient side effect. If the
    row is absent the recipient mutated into the cohort source after T0 and
    must be hard-rejected — the caller should mark the recipient state as
    ``skipped_invalid_phone`` or ``skipped`` and return without dispatching.
    """
    stmt = select(WorkflowRunRecipient).where(
        WorkflowRunRecipient.run_id == run_id,
        WorkflowRunRecipient.recipient_id == recipient_id,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise RecipientNotInManifestError(
            run_id=run_id, recipient_id=recipient_id
        )
    return row
