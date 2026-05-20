"""Tenant allowed-email-domain policy. Single source of truth.

The two consumers — auth routes (raise on rejection) and the mail event
pipeline (silently drop rejected recipients) — share the same suffix
matcher and tenant-config lookup. Adding a new consumer = call these
helpers; never re-implement the rule.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant_config import TenantConfiguration


async def load_tenant_allowed_domains(
    db: AsyncSession, tenant_id: uuid.UUID
) -> list[str]:
    """Return the tenant's configured allowed-domain list, or `[]` when unset."""
    config = await db.scalar(
        select(TenantConfiguration).where(TenantConfiguration.tenant_id == tenant_id)
    )
    if not config or not config.allowed_domains:
        return []
    return list(config.allowed_domains)


def is_email_domain_allowed(email: str, allowed_domains: list[str]) -> bool:
    """Empty list means no restriction; otherwise require a suffix match."""
    if not allowed_domains:
        return True
    needle = email.strip().lower()
    for domain in allowed_domains:
        suffix = domain.lower().strip()
        if not suffix.startswith("@"):
            suffix = "@" + suffix
        if needle.endswith(suffix):
            return True
    return False
