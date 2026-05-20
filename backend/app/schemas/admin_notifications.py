"""Admin notification-management request + response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field

from app.schemas.base import CamelModel


class NotificationDefaultRow(CamelModel):
    event_type: str
    group: str
    is_required_for_all: bool
    always_notify_emails: list[str]


class NotificationDefaultsResponse(CamelModel):
    defaults: list[NotificationDefaultRow]


class NotificationDefaultUpdate(CamelModel):
    is_required_for_all: bool
    always_notify_emails: list[EmailStr] = Field(default_factory=list, max_length=20)


class AdminSubscriptionRow(CamelModel):
    id: str
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    event_type: str
    group: str
    recipient_email: str
    is_active: bool
    is_required: bool
    created_at: datetime


class AdminSubscriptionList(CamelModel):
    rows: list[AdminSubscriptionRow]
    total: int


class AdminSubscriptionPatch(CamelModel):
    is_active: Optional[bool] = None
    is_required: Optional[bool] = None


class AdminMailSendRow(CamelModel):
    id: str
    call_site: str
    recipient: str
    subject: str
    status: str
    error_message: Optional[str] = None
    correlation_id: Optional[str] = None
    sent_at: datetime


class AdminMailSendList(CamelModel):
    rows: list[AdminMailSendRow]
    total: int


class AdminMailSendPreview(CamelModel):
    id: str
    subject: str
    recipient: str
    status: str
    sent_at: datetime
    html: Optional[str] = None
    provider_response: Optional[dict] = None
    error_message: Optional[str] = None
