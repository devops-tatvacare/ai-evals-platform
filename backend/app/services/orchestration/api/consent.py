"""Consent record list + append-only set."""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import WorkflowConsentRecord


async def get_recipient_consent(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    recipient_id: str,
) -> list[WorkflowConsentRecord]:
    """All consent rows for the recipient ordered newest-first."""
    return list((await db.execute(
        select(WorkflowConsentRecord).where(
            WorkflowConsentRecord.tenant_id == tenant_id,
            WorkflowConsentRecord.app_id == app_id,
            WorkflowConsentRecord.recipient_id == recipient_id,
        ).order_by(WorkflowConsentRecord.created_at.desc())
    )).scalars().all())


async def set_consent(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    recipient_id: str,
    channel: str,
    status: str,
    source: str,
    evidence: Optional[dict[str, Any]],
) -> WorkflowConsentRecord:
    row = WorkflowConsentRecord(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        recipient_id=recipient_id,
        channel=channel,
        status=status,
        source=source,
        evidence=evidence,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
