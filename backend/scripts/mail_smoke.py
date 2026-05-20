"""SMTP smoke test for the mail subsystem.

Uses the same env vars the real backend uses (SMTP_HOST / PORT / USERNAME /
PASSWORD / FROM_ADDRESS). Renders the signup_invite template against a fake
tenant context and sends to whoever is passed as --to.

Usage:
    export SMTP_HOST=smtp.office365.com
    export SMTP_PORT=587
    export SMTP_USERNAME=no-reply-ai-platform@tatvacare.in
    export SMTP_PASSWORD='...'
    export SMTP_FROM_ADDRESS=no-reply-ai-platform@tatvacare.in
    PYTHONPATH=backend python -m scripts.mail_smoke --to you@tatvacare.in

Confirms: SMTP AUTH works, STARTTLS works, template renders, mail lands.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from email.message import EmailMessage
from email.utils import formataddr

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")

import aiosmtplib

from app.config import settings
from app.services.mail.call_sites import CallSite
from app.services.mail.template_renderer import (
    _HEADER_BG_DATA_URI,
    _PLATFORM_LOGO_DATA_URI,
    _env,
)


def _render_inline(recipient: str, tenant_name: str) -> tuple[str, str, str, str]:
    """Render without the DB chrome (tenant lookup) so the script is standalone."""
    is_platform_tenant = tenant_name.strip().lower() == "tatvacare"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=168)
    ctx = {
        "tenant_name": tenant_name,
        "tenant_logo_url": None,
        "is_platform_tenant": is_platform_tenant,
        "platform_name": "TatvaCare",
        "platform_logo_data_uri": _PLATFORM_LOGO_DATA_URI,
        "header_bg_data_uri": _HEADER_BG_DATA_URI,
        "app_base_url": (settings.APP_BASE_URL or "http://localhost:5173").rstrip("/"),
        "now_display": now.astimezone(_IST).strftime("%d %b %Y, %H:%M IST"),
        "user_name": recipient.split("@")[0],
        "inviter_name": "platform-smoke-test",
        "invite_url": "https://example.invalid/signup?invite=SMOKE-TOKEN",
        "expires_at_display": expires_at.astimezone(_IST).strftime("%d %b %Y, %H:%M IST"),
    }
    site = CallSite.SIGNUP_INVITE.value.split(".", 1)[1]
    subject = _env.get_template(f"{site}.subject.j2").render(**ctx).strip()
    html = _env.get_template(f"{site}.html.j2").render(**ctx)
    text = _env.get_template(f"{site}.txt.j2").render(**ctx)
    from_display = (
        f"{settings.SMTP_FROM_DISPLAY} — {tenant_name}"
        if tenant_name and not is_platform_tenant
        else settings.SMTP_FROM_DISPLAY
    )
    return subject, html, text, from_display


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", required=True, help="Recipient email address")
    parser.add_argument(
        "--tenant",
        default="Acme Health",
        help="Tenant name for the template chrome (use 'TatvaCare' to test single-logo header)",
    )
    args = parser.parse_args()

    missing = [
        k
        for k in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM_ADDRESS")
        if not getattr(settings, k)
    ]
    if missing:
        print(f"[smoke] missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 2

    subject, html, text, from_display = _render_inline(args.to, args.tenant)

    msg = EmailMessage()
    msg["From"] = formataddr((from_display, settings.SMTP_FROM_ADDRESS))
    msg["To"] = args.to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    print(f"[smoke] host={settings.SMTP_HOST}:{settings.SMTP_PORT} starttls={settings.SMTP_USE_STARTTLS}")
    print(f"[smoke] from={msg['From']}  to={args.to}  subject={subject!r}")

    try:
        errors, message = await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            start_tls=settings.SMTP_USE_STARTTLS,
            timeout=settings.SMTP_TIMEOUT_SECONDS,
        )
    except aiosmtplib.SMTPException as exc:
        print(f"[smoke] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"[smoke] FAILED (network): {exc}", file=sys.stderr)
        return 1

    print(f"[smoke] OK — relay returned: {message!r}")
    if errors:
        print(f"[smoke] per-recipient errors: {errors}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
