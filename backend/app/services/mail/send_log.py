"""Single fact-row writer for mail send attempts."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mail_send_log import MailSendLog
from app.services.mail.call_sites import CallSite


async def write_log(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    call_site: CallSite,
    recipient: str,
    subject: str,
    status: str,
    provider_response: dict[str, Any] | None = None,
    error_message: str | None = None,
    correlation_id: str | None = None,
) -> MailSendLog:
    row = MailSendLog(
        tenant_id=tenant_id,
        call_site=call_site.value,
        recipient=recipient,
        subject=subject,
        status=status,
        provider_response=provider_response,
        error_message=error_message,
        correlation_id=correlation_id,
    )
    db.add(row)
    await db.flush()
    return row
