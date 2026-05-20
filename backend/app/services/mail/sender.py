"""SMTP mail sender + send_mail() facade.

Single platform identity sourced from env (SMTP_* vars). Per-tenant
identity is carried through the template chrome (display name, logo,
footer) — not through a separate sender.
"""
from __future__ import annotations

import logging
import uuid
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

import aiosmtplib
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.mail.call_sites import CallSite
from app.services.mail.send_log import write_log
from app.services.mail.template_renderer import render

logger = logging.getLogger(__name__)


class MailNotConfigured(RuntimeError):
    """Raised when SMTP_HOST / credentials are missing in the environment."""


class MailRecipientRejected(ValueError):
    """Raised when a recipient fails app-level validation (domain gate)."""


class MailSendError(RuntimeError):
    """SMTP relay rejected the message."""


def _assert_configured() -> None:
    missing = [
        k
        for k in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM_ADDRESS")
        if not getattr(settings, k)
    ]
    if missing:
        raise MailNotConfigured(
            f"Mail subsystem inactive — missing env vars: {', '.join(missing)}"
        )


async def send_mail(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    call_site: CallSite,
    recipient: str,
    context: dict[str, Any],
    correlation_id: str | None = None,
) -> None:
    """Render + send + log. Raises on configuration or relay failure.

    Tenant-domain checks (e.g. allowed_domains) are caller's responsibility —
    the sender stays a pure transport layer.
    """
    _assert_configured()

    rendered = await render(db, tenant_id, call_site, context)

    msg = EmailMessage()
    msg["From"] = formataddr((rendered.from_display, settings.SMTP_FROM_ADDRESS))
    msg["To"] = recipient
    msg["Subject"] = rendered.subject
    msg.set_content(rendered.text)
    msg.add_alternative(rendered.html, subtype="html")

    # Inline images ride on the HTML part as a multipart/related, referenced by
    # cid: in the markup — data: URIs are stripped by Gmail/Outlook.
    if rendered.inline_images:
        html_part = next(
            part for part in msg.iter_parts() if part.get_content_type() == "text/html"
        )
        for image in rendered.inline_images:
            html_part.add_related(
                image.data, "image", image.subtype, cid=f"<{image.cid}>"
            )

    try:
        provider_response = await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            start_tls=settings.SMTP_USE_STARTTLS,
            timeout=settings.SMTP_TIMEOUT_SECONDS,
        )
    except (aiosmtplib.SMTPException, OSError) as exc:
        await write_log(
            db,
            tenant_id=tenant_id,
            call_site=call_site,
            recipient=recipient,
            subject=rendered.subject,
            status="failed",
            error_message=f"{type(exc).__name__}: {exc}",
            correlation_id=correlation_id,
            html_cached_at_send=rendered.html,
        )
        logger.warning(
            "mail.send_failed",
            extra={
                "call_site": call_site.value,
                "tenant_id": str(tenant_id),
                "recipient": recipient,
                "error": str(exc),
            },
        )
        raise MailSendError(str(exc)) from exc

    errors, message = provider_response
    await write_log(
        db,
        tenant_id=tenant_id,
        call_site=call_site,
        recipient=recipient,
        subject=rendered.subject,
        status="sent",
        provider_response={"errors": errors, "message": message},
        correlation_id=correlation_id,
        html_cached_at_send=rendered.html,
    )
