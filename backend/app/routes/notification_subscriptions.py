"""User-self notification subscriptions + recent-sends."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.database import get_db
from app.models.mail_send_log import MailSendLog
from app.models.notification_subscription import NotificationSubscription
from app.schemas.notification_subscription import (
    EmailSettingsResponse,
    NotificationSubscriptionRow,
    RecentSendRow,
    RecipientUpdate,
    SubscriptionUpdate,
)
from app.services.mail.event_pipeline import EVENT_GROUP, EventType
from app.services.tenant_policy import (
    is_email_domain_allowed,
    load_tenant_allowed_domains,
)


router = APIRouter(
    prefix="/api/notification-subscriptions", tags=["notification-subscriptions"]
)


# Re-exported as a test-monkeypatch seam — production calls the same function.
_load_tenant_allowed_domains = load_tenant_allowed_domains


_VALID_EVENT_TYPES: frozenset[str] = frozenset(et.value for et in EventType)


def _row_for_event(
    *,
    event_type: EventType,
    existing: NotificationSubscription | None,
    default_recipient: str,
) -> NotificationSubscriptionRow:
    return NotificationSubscriptionRow(
        event_type=event_type.value,
        group=EVENT_GROUP[event_type],
        is_active=bool(existing.is_active) if existing else False,
        is_required=bool(existing.is_required) if existing else False,
        recipient_email=existing.recipient_email if existing else default_recipient,
    )


@router.get("", response_model=EmailSettingsResponse)
async def list_email_settings(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> EmailSettingsResponse:
    result = await db.execute(
        select(NotificationSubscription).where(
            NotificationSubscription.tenant_id == auth.tenant_id,
            NotificationSubscription.user_id == auth.user_id,
        )
    )
    existing_rows = result.scalars().all()
    by_event: dict[str, NotificationSubscription] = {r.event_type: r for r in existing_rows}

    # Use the first existing row's recipient as the user's effective address;
    # falls back to the auth email when the user has no rows yet.
    recipient = existing_rows[0].recipient_email if existing_rows else auth.email

    subscriptions = [
        _row_for_event(
            event_type=event_type,
            existing=by_event.get(event_type.value),
            default_recipient=recipient,
        )
        for event_type in EventType
    ]
    return EmailSettingsResponse(recipient_email=recipient, subscriptions=subscriptions)


@router.put("/recipient", response_model=EmailSettingsResponse)
async def update_recipient(
    payload: RecipientUpdate,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> EmailSettingsResponse:
    new_recipient = payload.recipient_email.strip()
    allowed = await _load_tenant_allowed_domains(db, auth.tenant_id)
    if not is_email_domain_allowed(new_recipient, allowed):
        raise HTTPException(
            status_code=400,
            detail="That domain is not allowed for this workspace.",
        )

    result = await db.execute(
        select(NotificationSubscription).where(
            NotificationSubscription.tenant_id == auth.tenant_id,
            NotificationSubscription.user_id == auth.user_id,
        )
    )
    rows = result.scalars().all()
    for row in rows:
        row.recipient_email = new_recipient
    await db.commit()

    by_event: dict[str, NotificationSubscription] = {r.event_type: r for r in rows}
    subscriptions = [
        _row_for_event(
            event_type=event_type,
            existing=by_event.get(event_type.value),
            default_recipient=new_recipient,
        )
        for event_type in EventType
    ]
    return EmailSettingsResponse(recipient_email=new_recipient, subscriptions=subscriptions)


@router.put("/{event_type}", response_model=NotificationSubscriptionRow)
async def upsert_subscription(
    event_type: str,
    payload: SubscriptionUpdate,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> NotificationSubscriptionRow:
    if event_type not in _VALID_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown event type.")
    et_enum = EventType(event_type)

    existing = await db.scalar(
        select(NotificationSubscription).where(
            NotificationSubscription.tenant_id == auth.tenant_id,
            NotificationSubscription.user_id == auth.user_id,
            NotificationSubscription.event_type == event_type,
        )
    )
    if existing is not None and existing.is_required:
        raise HTTPException(
            status_code=409,
            detail="This notification is required by your admin and cannot be changed.",
        )

    if existing is None:
        new_row = NotificationSubscription(
            id=uuid.uuid4(),
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            event_type=event_type,
            recipient_email=auth.email,
            is_active=payload.is_active,
            is_required=False,
        )
        db.add(new_row)
        await db.commit()
        return _row_for_event(
            event_type=et_enum, existing=new_row, default_recipient=auth.email
        )

    existing.is_active = payload.is_active
    await db.commit()
    return _row_for_event(
        event_type=et_enum, existing=existing, default_recipient=auth.email
    )


@router.get("/recent-sends", response_model=list[RecentSendRow])
async def list_recent_sends(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[RecentSendRow]:
    capped_limit = max(1, min(limit, 200))
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    result = await db.execute(
        select(MailSendLog)
        .where(
            MailSendLog.tenant_id == auth.tenant_id,
            MailSendLog.recipient == auth.email,
            MailSendLog.sent_at >= cutoff,
        )
        .order_by(MailSendLog.sent_at.desc())
        .limit(capped_limit)
    )
    rows = result.scalars().all()
    return [
        RecentSendRow(
            id=str(r.id),
            call_site=r.call_site,
            recipient=r.recipient,
            subject=r.subject,
            status=r.status,
            error_message=r.error_message,
            sent_at=r.sent_at,
        )
        for r in rows
    ]
