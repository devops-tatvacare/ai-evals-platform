"""Request + response schemas for `/api/notification-subscriptions/*`."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field

from app.schemas.base import CamelModel, CamelORMModel


class NotificationSubscriptionRow(CamelModel):
    """One event type for the current user. Renders as one toggle in the FE."""

    event_type: str
    group: str
    is_active: bool
    is_required: bool
    recipient_email: str


class EmailSettingsResponse(CamelModel):
    """Full payload for the user's email-settings screen."""

    recipient_email: str
    subscriptions: list[NotificationSubscriptionRow]


class SubscriptionUpdate(CamelModel):
    is_active: bool


class RecipientUpdate(CamelModel):
    recipient_email: EmailStr = Field(..., max_length=320)


class RecentSendRow(CamelORMModel):
    id: str
    call_site: str
    recipient: str
    subject: str
    status: str
    error_message: Optional[str] = None
    sent_at: datetime
