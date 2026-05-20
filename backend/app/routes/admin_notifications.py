"""Admin notification management: defaults, subscribers, send-log."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, require_permission
from app.database import get_db
from app.models.mail_send_log import MailSendLog
from app.models.notification_subscription import NotificationSubscription
from app.models.user import User
from app.schemas.admin_notifications import (
    AdminMailSendList,
    AdminMailSendPreview,
    AdminMailSendRow,
    AdminSubscriptionList,
    AdminSubscriptionPatch,
    AdminSubscriptionRow,
    NotificationDefaultRow,
    NotificationDefaultUpdate,
    NotificationDefaultsResponse,
)
from app.services.audit import write_audit_log
from app.services.mail.event_pipeline import EVENT_GROUP, EventType


router = APIRouter(prefix="/api/admin/notifications", tags=["admin-notifications"])


async def _load_always_notify(
    db: AsyncSession, *, tenant_id: uuid.UUID
) -> dict[str, list[str]]:
    """Return `{event_type: [email, ...]}` for rows scoped to `user_id IS NULL`."""
    result = await db.execute(
        select(NotificationSubscription).where(
            NotificationSubscription.tenant_id == tenant_id,
            NotificationSubscription.user_id.is_(None),
            NotificationSubscription.is_required.is_(True),
            NotificationSubscription.is_active.is_(True),
        )
    )
    rows = result.scalars().all()
    out: dict[str, list[str]] = {}
    for row in rows:
        out.setdefault(row.event_type, []).append(row.recipient_email)
    return out


async def _is_required_for_all(
    db: AsyncSession, *, tenant_id: uuid.UUID, event_type: str
) -> bool:
    """True when every tenant user has an `is_required=true` row for this event."""
    user_count = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.tenant_id == tenant_id, User.is_active.is_(True))
        )
        or 0
    )
    if user_count == 0:
        return False
    required_count = (
        await db.scalar(
            select(func.count())
            .select_from(NotificationSubscription)
            .where(
                NotificationSubscription.tenant_id == tenant_id,
                NotificationSubscription.event_type == event_type,
                NotificationSubscription.is_required.is_(True),
                NotificationSubscription.user_id.is_not(None),
            )
        )
        or 0
    )
    return required_count >= user_count


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


@router.get("/defaults", response_model=NotificationDefaultsResponse)
async def list_defaults(
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
) -> NotificationDefaultsResponse:
    always_by_event = await _load_always_notify(db, tenant_id=auth.tenant_id)
    rows: list[NotificationDefaultRow] = []
    for event_type in EventType:
        rows.append(
            NotificationDefaultRow(
                event_type=event_type.value,
                group=EVENT_GROUP[event_type],
                is_required_for_all=await _is_required_for_all(
                    db, tenant_id=auth.tenant_id, event_type=event_type.value
                ),
                always_notify_emails=always_by_event.get(event_type.value, []),
            )
        )
    return NotificationDefaultsResponse(defaults=rows)


@router.put("/defaults/{event_type}", response_model=NotificationDefaultRow)
async def update_default(
    event_type: str,
    payload: NotificationDefaultUpdate,
    request: Request,
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
) -> NotificationDefaultRow:
    if event_type not in {et.value for et in EventType}:
        raise HTTPException(status_code=400, detail="Unknown event type.")
    et_enum = EventType(event_type)

    before_required = await _is_required_for_all(
        db, tenant_id=auth.tenant_id, event_type=event_type
    )
    before_always = (await _load_always_notify(db, tenant_id=auth.tenant_id)).get(
        event_type, []
    )

    # Sync the "always notify" list: rows where user_id IS NULL.
    existing_always = (
        (
            await db.execute(
                select(NotificationSubscription).where(
                    NotificationSubscription.tenant_id == auth.tenant_id,
                    NotificationSubscription.event_type == event_type,
                    NotificationSubscription.user_id.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    desired = {addr.strip().lower(): addr.strip() for addr in payload.always_notify_emails}
    existing_by_email = {row.recipient_email.strip().lower(): row for row in existing_always}

    for key, row in existing_by_email.items():
        if key not in desired:
            await db.delete(row)
    for key, addr in desired.items():
        if key in existing_by_email:
            existing_by_email[key].is_required = True
            existing_by_email[key].is_active = True
        else:
            db.add(
                NotificationSubscription(
                    id=uuid.uuid4(),
                    tenant_id=auth.tenant_id,
                    user_id=None,
                    event_type=event_type,
                    recipient_email=addr,
                    is_active=True,
                    is_required=True,
                )
            )

    # Sync the per-user required state.
    user_rows = (
        (
            await db.execute(
                select(User).where(
                    User.tenant_id == auth.tenant_id, User.is_active.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    if payload.is_required_for_all:
        existing_user_rows = (
            (
                await db.execute(
                    select(NotificationSubscription).where(
                        NotificationSubscription.tenant_id == auth.tenant_id,
                        NotificationSubscription.event_type == event_type,
                        NotificationSubscription.user_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        by_user = {r.user_id: r for r in existing_user_rows}
        for user in user_rows:
            existing_row = by_user.get(user.id)
            if existing_row is None:
                db.add(
                    NotificationSubscription(
                        id=uuid.uuid4(),
                        tenant_id=auth.tenant_id,
                        user_id=user.id,
                        event_type=event_type,
                        recipient_email=user.email,
                        is_active=True,
                        is_required=True,
                    )
                )
            else:
                existing_row.is_required = True
                existing_row.is_active = True
    else:
        # Flipping off — relax `is_required` but leave subscriptions intact.
        existing_user_rows = (
            (
                await db.execute(
                    select(NotificationSubscription).where(
                        NotificationSubscription.tenant_id == auth.tenant_id,
                        NotificationSubscription.event_type == event_type,
                        NotificationSubscription.user_id.is_not(None),
                        NotificationSubscription.is_required.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in existing_user_rows:
            row.is_required = False

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="notifications:default_changed",
        entity_type="notification_event",
        entity_id=uuid.uuid5(uuid.NAMESPACE_DNS, f"notification-event:{event_type}"),
        before_state={
            "is_required_for_all": before_required,
            "always_notify_emails": before_always,
        },
        after_state={
            "is_required_for_all": payload.is_required_for_all,
            "always_notify_emails": list(desired.values()),
        },
        request=request,
    )
    await db.commit()

    return NotificationDefaultRow(
        event_type=event_type,
        group=EVENT_GROUP[et_enum],
        is_required_for_all=payload.is_required_for_all,
        always_notify_emails=list(desired.values()),
    )


# ---------------------------------------------------------------------------
# Subscribers
# ---------------------------------------------------------------------------


@router.get("/subscriptions", response_model=AdminSubscriptionList)
async def list_subscriptions(
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
    event_type: Optional[str] = Query(None),
    user_id: Optional[uuid.UUID] = Query(None),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
) -> AdminSubscriptionList:
    base = select(NotificationSubscription, User.email).join(
        User, NotificationSubscription.user_id == User.id, isouter=True
    ).where(NotificationSubscription.tenant_id == auth.tenant_id)
    if event_type:
        base = base.where(NotificationSubscription.event_type == event_type)
    if user_id is not None:
        base = base.where(NotificationSubscription.user_id == user_id)
    if is_active is not None:
        base = base.where(NotificationSubscription.is_active.is_(is_active))

    total_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.scalar(total_stmt)) or 0

    rows_stmt = base.order_by(NotificationSubscription.created_at.desc()).limit(page_size).offset(
        (page - 1) * page_size
    )
    rows = (await db.execute(rows_stmt)).all()

    out: list[AdminSubscriptionRow] = []
    for sub, user_email in rows:
        et_enum = EventType(sub.event_type) if sub.event_type in {e.value for e in EventType} else None
        group = EVENT_GROUP[et_enum] if et_enum else "system"
        out.append(
            AdminSubscriptionRow(
                id=str(sub.id),
                user_id=str(sub.user_id) if sub.user_id else None,
                user_email=user_email,
                event_type=sub.event_type,
                group=group,
                recipient_email=sub.recipient_email,
                is_active=sub.is_active,
                is_required=sub.is_required,
                created_at=sub.created_at,
            )
        )
    return AdminSubscriptionList(rows=out, total=int(total))


@router.patch("/subscriptions/{subscription_id}", response_model=AdminSubscriptionRow)
async def patch_subscription(
    subscription_id: uuid.UUID,
    payload: AdminSubscriptionPatch,
    request: Request,
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
) -> AdminSubscriptionRow:
    sub = await db.scalar(
        select(NotificationSubscription).where(
            NotificationSubscription.id == subscription_id,
            NotificationSubscription.tenant_id == auth.tenant_id,
        )
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    before = {"is_active": sub.is_active, "is_required": sub.is_required}
    if payload.is_active is not None:
        sub.is_active = payload.is_active
    if payload.is_required is not None:
        sub.is_required = payload.is_required
    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="notifications:override",
        entity_type="notification_subscription",
        entity_id=sub.id,
        before_state=before,
        after_state={"is_active": sub.is_active, "is_required": sub.is_required},
        request=request,
    )
    await db.commit()

    user_email: Optional[str] = None
    if sub.user_id is not None:
        user_email = await db.scalar(
            select(User.email).where(User.id == sub.user_id)
        )
    et_enum = EventType(sub.event_type) if sub.event_type in {e.value for e in EventType} else None
    group = EVENT_GROUP[et_enum] if et_enum else "system"
    return AdminSubscriptionRow(
        id=str(sub.id),
        user_id=str(sub.user_id) if sub.user_id else None,
        user_email=user_email,
        event_type=sub.event_type,
        group=group,
        recipient_email=sub.recipient_email,
        is_active=sub.is_active,
        is_required=sub.is_required,
        created_at=sub.created_at,
    )


@router.delete("/subscriptions/{subscription_id}", status_code=204, response_model=None)
async def delete_subscription(
    subscription_id: uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
) -> None:
    sub = await db.scalar(
        select(NotificationSubscription).where(
            NotificationSubscription.id == subscription_id,
            NotificationSubscription.tenant_id == auth.tenant_id,
        )
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="notifications:override",
        entity_type="notification_subscription",
        entity_id=sub.id,
        before_state={
            "is_active": sub.is_active,
            "is_required": sub.is_required,
            "deleted": False,
        },
        after_state={"deleted": True},
        request=request,
    )
    await db.delete(sub)
    await db.commit()


# ---------------------------------------------------------------------------
# Send log
# ---------------------------------------------------------------------------


def _apply_send_log_filters(
    base,
    *,
    status: Optional[str],
    call_site: Optional[str],
    recipient: Optional[str],
    from_date: Optional[datetime],
    to_date: Optional[datetime],
):
    if status:
        base = base.where(MailSendLog.status == status)
    if call_site:
        base = base.where(MailSendLog.call_site == call_site)
    if recipient:
        base = base.where(MailSendLog.recipient.ilike(f"%{recipient}%"))
    if from_date is not None:
        base = base.where(MailSendLog.sent_at >= from_date)
    if to_date is not None:
        base = base.where(MailSendLog.sent_at <= to_date)
    return base


@router.get("/send-log", response_model=AdminMailSendList)
async def list_send_log(
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
    call_site: Optional[str] = Query(None),
    recipient: Optional[str] = Query(None),
    from_date: Optional[datetime] = Query(None),
    to_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
) -> AdminMailSendList:
    base = _apply_send_log_filters(
        select(MailSendLog).where(MailSendLog.tenant_id == auth.tenant_id),
        status=status,
        call_site=call_site,
        recipient=recipient,
        from_date=from_date,
        to_date=to_date,
    )
    total = (await db.scalar(select(func.count()).select_from(base.subquery()))) or 0

    rows_stmt = (
        base.order_by(MailSendLog.sent_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = (await db.execute(rows_stmt)).scalars().all()
    return AdminMailSendList(
        rows=[
            AdminMailSendRow(
                id=str(r.id),
                call_site=r.call_site,
                recipient=r.recipient,
                subject=r.subject,
                status=r.status,
                error_message=r.error_message,
                correlation_id=r.correlation_id,
                sent_at=r.sent_at,
            )
            for r in rows
        ],
        total=int(total),
    )


@router.get("/send-log/{send_log_id}/preview", response_model=AdminMailSendPreview)
async def preview_send_log(
    send_log_id: uuid.UUID,
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
) -> AdminMailSendPreview:
    row = await db.scalar(
        select(MailSendLog).where(
            MailSendLog.id == send_log_id,
            MailSendLog.tenant_id == auth.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Send-log entry not found.")
    return AdminMailSendPreview(
        id=str(row.id),
        subject=row.subject,
        recipient=row.recipient,
        status=row.status,
        sent_at=row.sent_at,
        html=row.html_cached_at_send,
        provider_response=row.provider_response,
        error_message=row.error_message,
    )


@router.get("/send-log.csv")
async def export_send_log_csv(
    auth: AuthContext = require_permission("notifications:manage"),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = Query(None),
    call_site: Optional[str] = Query(None),
    recipient: Optional[str] = Query(None),
    from_date: Optional[datetime] = Query(None),
    to_date: Optional[datetime] = Query(None),
) -> StreamingResponse:
    base = _apply_send_log_filters(
        select(MailSendLog).where(MailSendLog.tenant_id == auth.tenant_id),
        status=status,
        call_site=call_site,
        recipient=recipient,
        from_date=from_date,
        to_date=to_date,
    )
    # Cap the export — protects the worker + browser from a huge dump.
    rows = (
        await db.execute(base.order_by(MailSendLog.sent_at.desc()).limit(10000))
    ).scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["sent_at", "call_site", "recipient", "subject", "status", "correlation_id", "error_message"])
    for r in rows:
        writer.writerow(
            [
                r.sent_at.isoformat() if r.sent_at else "",
                r.call_site,
                r.recipient,
                r.subject,
                r.status,
                r.correlation_id or "",
                (r.error_message or "").replace("\n", " ").replace("\r", " "),
            ]
        )
    buf.seek(0)
    filename = f"mail-send-log-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
