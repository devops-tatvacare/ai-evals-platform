"""Provision required-by-admin notification subscriptions for new users."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_subscription import NotificationSubscription
from app.services.mail.event_pipeline import EventType


async def provision_required_subscriptions_for_user(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    user_email: str,
) -> int:
    """Auto-provision `is_required=true` rows for events the admin marked required-for-all.

    Required-for-all is encoded as "at least one tenant user has an `is_required=true`
    row for this event". Mirrors the admin-flip-on semantic at PUT /defaults/{event_type}.
    Idempotent — a user that already has a row for an event is skipped. Returns the
    count of rows added.
    """
    new_rows = 0
    for event_type in EventType:
        existing_required = await db.scalar(
            select(NotificationSubscription).where(
                NotificationSubscription.tenant_id == tenant_id,
                NotificationSubscription.event_type == event_type.value,
                NotificationSubscription.is_required.is_(True),
                NotificationSubscription.user_id.is_not(None),
            )
        )
        if existing_required is None:
            continue
        existing_for_user = await db.scalar(
            select(NotificationSubscription).where(
                NotificationSubscription.tenant_id == tenant_id,
                NotificationSubscription.user_id == user_id,
                NotificationSubscription.event_type == event_type.value,
            )
        )
        if existing_for_user is not None:
            continue
        db.add(
            NotificationSubscription(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                user_id=user_id,
                event_type=event_type.value,
                recipient_email=user_email,
                is_active=True,
                is_required=True,
            )
        )
        new_rows += 1
    return new_rows
