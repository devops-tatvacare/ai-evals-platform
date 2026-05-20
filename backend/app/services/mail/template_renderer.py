"""Renders subject + HTML + text for a call site, merging tenant chrome."""
from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tenant import Tenant
from app.models.tenant_config import TenantConfiguration
from app.services.mail.call_sites import CallSite

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_PLATFORM_LOGO_FILE = _REPO_ROOT / "public" / "tatva_logo.jpeg"
_PLATFORM_NAME = "TatvaCare"
# Gmail/Outlook strip data: URIs in <img>; the logo must travel as a related
# inline part referenced by this Content-ID.
_PLATFORM_LOGO_CID = "platform-logo@tatvacare"

_PLATFORM_LOGO_BYTES = (
    _PLATFORM_LOGO_FILE.read_bytes() if _PLATFORM_LOGO_FILE.exists() else b""
)


# Mirrors the login page's AuroraBackdrop: #07070d base, 28px white grid at
# 3.5% alpha, purple radial aurora overlay. Inlined as a single SVG data URI
# so email clients render it as the header background.
_HEADER_BG_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120" preserveAspectRatio="none" viewBox="0 0 600 120">
<defs>
<pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse">
<path d="M28 0H0V28" fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>
</pattern>
<radialGradient id="a" cx="22%" cy="50%" r="60%">
<stop offset="0%" stop-color="rgba(112,48,160,0.32)"/>
<stop offset="55%" stop-color="rgba(64,60,207,0.10)"/>
<stop offset="100%" stop-color="rgba(7,7,13,0)"/>
</radialGradient>
<radialGradient id="b" cx="85%" cy="40%" r="40%">
<stop offset="0%" stop-color="rgba(139,92,246,0.16)"/>
<stop offset="100%" stop-color="rgba(7,7,13,0)"/>
</radialGradient>
</defs>
<rect width="100%" height="100%" fill="#07070d"/>
<rect width="100%" height="100%" fill="url(#a)"/>
<rect width="100%" height="100%" fill="url(#b)"/>
<rect width="100%" height="100%" fill="url(#g)"/>
</svg>"""


def _header_bg_data_uri() -> str:
    encoded = base64.b64encode(_HEADER_BG_SVG.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


_HEADER_BG_DATA_URI = _header_bg_data_uri()


_env = Environment(
    loader=FileSystemLoader(_TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "j2"]),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)


@dataclass(frozen=True)
class InlineImage:
    cid: str
    data: bytes
    subtype: str


@dataclass(frozen=True)
class RenderedMail:
    subject: str
    html: str
    text: str
    from_display: str
    inline_images: tuple[InlineImage, ...] = ()


async def render(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    call_site: CallSite,
    context: dict[str, Any],
) -> RenderedMail:
    tenant_name, tenant_logo_url = await _load_tenant_chrome(db, tenant_id)
    is_platform_tenant = (tenant_name or "").strip().lower() == _PLATFORM_NAME.lower()

    app_base = (settings.APP_BASE_URL or "").rstrip("/")
    now = datetime.now(timezone.utc)

    inline_images: tuple[InlineImage, ...] = ()
    platform_logo_cid = ""
    if _PLATFORM_LOGO_BYTES:
        platform_logo_cid = _PLATFORM_LOGO_CID
        inline_images = (
            InlineImage(cid=_PLATFORM_LOGO_CID, data=_PLATFORM_LOGO_BYTES, subtype="jpeg"),
        )

    chrome = {
        "tenant_name": tenant_name,
        "tenant_logo_url": tenant_logo_url,
        "is_platform_tenant": is_platform_tenant,
        "platform_name": _PLATFORM_NAME,
        "platform_logo_cid": platform_logo_cid,
        "header_bg_data_uri": _HEADER_BG_DATA_URI,
        "app_base_url": app_base,
        "now_display": now.astimezone(_IST).strftime("%d %b %Y, %H:%M IST"),
    }
    full_ctx = {**chrome, **context}

    site_key = call_site.value.split(".", 1)[1]
    subject_tpl = _env.get_template(f"{site_key}.subject.j2")
    html_tpl = _env.get_template(f"{site_key}.html.j2")
    text_tpl = _env.get_template(f"{site_key}.txt.j2")

    subject = subject_tpl.render(**full_ctx).strip()
    html = html_tpl.render(**full_ctx)
    text = text_tpl.render(**full_ctx)

    from_display = (
        f"{settings.SMTP_FROM_DISPLAY} — {tenant_name}"
        if tenant_name and not is_platform_tenant
        else settings.SMTP_FROM_DISPLAY
    )

    return RenderedMail(
        subject=subject,
        html=html,
        text=text,
        from_display=from_display,
        inline_images=inline_images,
    )


async def _load_tenant_chrome(
    db: AsyncSession, tenant_id: uuid.UUID
) -> tuple[str | None, str | None]:
    tenant = await db.get(Tenant, tenant_id)
    name = tenant.name if tenant else None

    config = await db.scalar(
        select(TenantConfiguration).where(TenantConfiguration.tenant_id == tenant_id)
    )
    logo_url = config.logo_url if config and config.logo_url else None
    return name, logo_url
