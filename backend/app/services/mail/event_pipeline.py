"""Event-driven notification fan-out via the mail subsystem."""
from __future__ import annotations

import logging
import uuid
from enum import StrEnum
from typing import Any, Awaitable, Callable, Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_subscription import NotificationSubscription
from app.models.scheduled_job import ScheduledJobDefinition
from app.services.mail.call_sites import CallSite

logger = logging.getLogger(__name__)


class EventType(StrEnum):
    SCHEDULED_JOB_FAILED = "scheduled_job.failed"
    # Forward-declared; producers wire these in a later phase.
    SCHEDULED_JOB_COMPLETED = "scheduled_job.completed"
    WORKFLOW_RUN_FAILED = "workflow_run.failed"
    WORKFLOW_RUN_COMPLETED = "workflow_run.completed"


EVENT_CALL_SITE: Mapping[EventType, CallSite] = {
    EventType.SCHEDULED_JOB_FAILED: CallSite.SCHEDULED_JOB_FAILED,
    EventType.SCHEDULED_JOB_COMPLETED: CallSite.SCHEDULED_JOB_COMPLETED,
    EventType.WORKFLOW_RUN_FAILED: CallSite.WORKFLOW_RUN_FAILED,
    EventType.WORKFLOW_RUN_COMPLETED: CallSite.WORKFLOW_RUN_COMPLETED,
}


# Group key for each event — the FE renders sections by this key and resolves
# its label from copy. Adding a new event = one enum row + one EVENT_GROUP row
# + one FE copy line. No other surface changes.
EVENT_GROUP: Mapping[EventType, str] = {
    EventType.SCHEDULED_JOB_FAILED: "scheduled_job",
    EventType.SCHEDULED_JOB_COMPLETED: "scheduled_job",
    EventType.WORKFLOW_RUN_FAILED: "workflow",
    EventType.WORKFLOW_RUN_COMPLETED: "workflow",
}


async def _scheduled_job_failure_recipients(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    resource_id: uuid.UUID,
) -> list[str]:
    # Tenant-filtered: never resolve recipients for another tenant's
    # schedule even if the caller mismatches the IDs.
    defn = await db.scalar(
        select(ScheduledJobDefinition).where(
            ScheduledJobDefinition.id == resource_id,
            ScheduledJobDefinition.tenant_id == tenant_id,
        )
    )
    if defn is None:
        return []
    out: list[str] = []
    if defn.notify_owner_on_failure and defn.created_by_user_email_snapshot:
        out.append(defn.created_by_user_email_snapshot)
    out.extend(defn.notify_emails_on_failure or [])
    return out


# Resource lookups are tenant-scoped by contract. Each callable MUST take a
# keyword ``tenant_id`` and filter every read by it.
RESOURCE_RECIPIENT_LOOKUPS: Mapping[
    str,
    Callable[..., Awaitable[list[str]]],
] = {
    "scheduled_job_definition": _scheduled_job_failure_recipients,
}


from app.services.tenant_policy import (
    is_email_domain_allowed as _domain_allowed,
    load_tenant_allowed_domains as _allowed_domains,
)


async def _gather_recipients(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    event_type: EventType,
    resource_type: str | None,
    resource_id: uuid.UUID | None,
) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []

    def _add(email: str | None) -> None:
        if not email:
            return
        key = email.strip().lower()
        if not key or key in seen:
            return
        seen.add(key)
        ordered.append(email.strip())

    if resource_type and resource_id is not None:
        lookup = RESOURCE_RECIPIENT_LOOKUPS.get(resource_type)
        if lookup is not None:
            for addr in await lookup(db, tenant_id=tenant_id, resource_id=resource_id):
                _add(addr)

    sub_rows = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.tenant_id == tenant_id,
                NotificationSubscription.event_type == event_type.value,
                NotificationSubscription.is_active.is_(True),
            )
        )
    ).scalars().all()
    for row in sub_rows:
        _add(row.recipient_email)

    required_rows = (
        await db.execute(
            select(NotificationSubscription).where(
                NotificationSubscription.tenant_id == tenant_id,
                NotificationSubscription.event_type == event_type.value,
                NotificationSubscription.is_required.is_(True),
            )
        )
    ).scalars().all()
    for row in required_rows:
        _add(row.recipient_email)

    return ordered


async def emit_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    event_type: EventType,
    payload: dict[str, Any],
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> int:
    """Fan a tenant-scoped event to its recipients. Returns send-mail jobs enqueued."""
    if event_type not in EVENT_CALL_SITE:
        logger.warning(
            "emit_event_unknown_event",
            extra={"tenant_id": str(tenant_id), "event_type": str(event_type)},
        )
        return 0

    call_site = EVENT_CALL_SITE[event_type]
    candidates = await _gather_recipients(
        db,
        tenant_id=tenant_id,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    if not candidates:
        return 0

    allowed = await _allowed_domains(db, tenant_id)
    recipients = [r for r in candidates if _domain_allowed(r, allowed)]
    dropped = [r for r in candidates if r not in recipients]
    for rejected in dropped:
        logger.warning(
            "emit_event_recipient_dropped_domain",
            extra={
                "tenant_id": str(tenant_id),
                "event_type": event_type.value,
                "recipient": rejected,
            },
        )

    if not recipients:
        return 0

    from app.services.mail.send_mail_job import enqueue_send_mail

    enqueued = 0
    for recipient in recipients:
        await enqueue_send_mail(
            db,
            tenant_id=tenant_id,
            call_site=call_site,
            recipient=recipient,
            context=dict(payload),
            correlation_id=correlation_id,
        )
        enqueued += 1
    return enqueued
