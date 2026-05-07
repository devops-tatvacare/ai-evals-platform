"""ClinicalOutboxWriter — enqueue rows in analytics.log_clinical_action_outbox.

Each ``clinical.*`` node handler calls ``outbox.enqueue(...)`` to insert a
pending row keyed by (tenant_id, recipient_id, idempotency_key). Downstream
EMR / care-team consumers (out of v1 scope) flip status='consumed' once
they've processed.

The insert uses ``ON CONFLICT DO NOTHING`` against the
``uq_log_clinical_action_outbox_idem`` unique constraint, so re-runs of the
same handler step (idempotency_key matches) are no-ops. This mirrors the
``WorkflowRunRecipientAction`` dispatch pattern used by CRM channels.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clinical_outbox import LogClinicalActionOutbox


class ClinicalOutboxWriter:
    """Idempotent writer for log_clinical_action_outbox rows."""

    async def enqueue(
        self,
        db: AsyncSession,
        *,
        tenant_id: uuid.UUID,
        app_id: str,
        recipient_id: str,
        action_type: str,
        idempotency_key: str,
        payload: dict[str, Any],
    ) -> uuid.UUID:
        """Insert a pending outbox row. Returns the row id (existing or new).

        On unique-constraint conflict (same tenant + recipient + key), the
        insert is a no-op and we return the existing row's id — so callers
        don't need to second-guess re-runs.
        """
        new_id = uuid.uuid4()
        stmt = (
            pg_insert(LogClinicalActionOutbox)
            .values(
                id=new_id,
                tenant_id=tenant_id,
                app_id=app_id,
                recipient_id=recipient_id,
                action_type=action_type,
                status="pending",
                idempotency_key=idempotency_key,
                payload=payload,
            )
            .on_conflict_do_nothing(constraint="uq_log_clinical_action_outbox_idem")
            .returning(LogClinicalActionOutbox.id)
        )
        res = await db.execute(stmt)
        returned: Optional[uuid.UUID] = res.scalar()
        if returned is not None:
            await db.flush()
            return returned

        # Conflict — fetch the existing row's id so the caller gets a real
        # FK they can attach to action results.
        existing = await db.scalar(
            select(LogClinicalActionOutbox.id).where(
                LogClinicalActionOutbox.tenant_id == tenant_id,
                LogClinicalActionOutbox.recipient_id == recipient_id,
                LogClinicalActionOutbox.idempotency_key == idempotency_key,
            )
        )
        if existing is None:
            # Should be unreachable under the unique constraint, but defensive
            # — if the row was deleted between the conflict and the lookup,
            # surface it as an error rather than silently returning None.
            raise RuntimeError(
                "ClinicalOutboxWriter.enqueue: conflict reported but row not found"
            )
        return existing
