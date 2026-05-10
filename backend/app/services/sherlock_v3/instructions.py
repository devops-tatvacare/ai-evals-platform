"""Phase 3 — load Sherlock data_specialist instruction blocks.

Two-tier: app default (markdown on disk) + tenant override
(``platform.tenant_configurations.sherlock_instructions`` TEXT column).
Both are non-fatal: a missing app file or DB lookup failure degrades to
"no instructions block in prompt", never to a crashed turn.

Concatenation order is **app default → tenant override**: the tenant
block sits AFTER the app block in the prompt, so on contradiction the
tenant rule wins by document order (the LLM reads top-to-bottom and the
later instruction takes precedence on conflicting "always do X" rules).
"""
from __future__ import annotations

import logging
import pathlib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant_config import TenantConfiguration

_log = logging.getLogger(__name__)

_INSTRUCTIONS_DIR = pathlib.Path(__file__).resolve().parent / 'instructions'


def _load_app_default(app_id: str) -> str:
    """Read the app-default markdown file for ``app_id``.

    Missing file = empty string (not a hard failure). The grounding
    layer treats an empty instructions block as "no INSTRUCTIONS heading
    rendered" so callers don't see a stub heading.
    """
    path = _INSTRUCTIONS_DIR / f'{app_id}.md'
    if not path.exists():
        return ''
    try:
        return path.read_text(encoding='utf-8').strip()
    except OSError as exc:
        _log.warning(
            'sherlock_v3.instructions: failed to read %s: %s', path, exc,
        )
        return ''


async def _load_tenant_override(
    tenant_id: uuid.UUID, db: AsyncSession,
) -> str:
    """Fetch the tenant override TEXT, empty string if unset/missing."""
    try:
        row = (await db.execute(
            select(TenantConfiguration.sherlock_instructions).where(
                TenantConfiguration.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001 — non-fatal
        _log.warning(
            'sherlock_v3.instructions: tenant override lookup failed for %s: %s',
            tenant_id, exc,
        )
        return ''
    if not row:
        return ''
    return row.strip()


async def load_instructions(
    app_id: str,
    *,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> str:
    """Compose app-default + tenant-override into the INSTRUCTIONS block.

    Returns an empty string when both tiers are empty — the prompt
    builder uses that as the signal to skip rendering the heading
    entirely (no stub "INSTRUCTIONS: (none)" noise).
    """
    app_block = _load_app_default(app_id)
    tenant_block = await _load_tenant_override(tenant_id, db)

    parts: list[str] = []
    if app_block:
        parts.append(app_block)
    if tenant_block:
        # Visible separator so the LLM (and a human auditing the prompt)
        # can see that a tenant override is present.
        parts.append('## Tenant overrides\n\n' + tenant_block)

    return '\n\n'.join(parts)
