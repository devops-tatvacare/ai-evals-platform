"""Signal derivation framework — multi-tenant definition resolution.

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

A signal definition seeded under ``SYSTEM_TENANT_ID`` is a **platform
template**: it applies to every tenant that has the app, exactly like
every other system default ("System library data belongs to
SYSTEM_TENANT_ID ... visible to all tenants as read-only defaults"). A
tenant can override by creating its own ``(tenant_id, app_id, signal_set)``
row — that row **shadows** the system template for that tenant.

Two resolution shapes, one per caller pattern:

* ``resolve_target_tenants`` — the scheduled ``rule`` pass iterates every
  enabled definition; for a system template it must fan out across every
  tenant with leads for the app (minus tenants that override the set).
* ``resolve_effective_definition`` — the per-eval-run / operator-backfill
  paths have a concrete ``(tenant_id, app_id)`` and need the one
  definition that applies: the tenant's own row if present, else the
  system template.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.analytics_lead_facts import DimLead
from app.models.analytics_signal_definition import SignalDefinition

# Per source surface: how to enumerate the distinct tenant_ids that carry
# rows for an app. Mirrors orchestrator._SOURCE_LOADERS.
_SURFACE_TENANT_QUERIES = {
    "dim_lead": lambda app_id: select(DimLead.tenant_id)
    .where(DimLead.app_id == app_id)
    .distinct(),
}


async def resolve_target_tenants(
    db: AsyncSession, definition: SignalDefinition
) -> list[uuid.UUID]:
    """Tenants a definition should be derived for.

    Tenant-owned definition → just that tenant. System template → every
    tenant with rows on the source surface for the app, minus tenants that
    have their own enabled row for the same ``(app_id, signal_set)``.
    """
    if definition.tenant_id != SYSTEM_TENANT_ID:
        return [definition.tenant_id]

    surface_query = _SURFACE_TENANT_QUERIES.get(definition.source_surface)
    if surface_query is None:
        raise ValueError(
            f"signal_definition {definition.id}: no tenant-enumeration query "
            f"for source_surface {definition.source_surface!r}"
        )
    all_tenants = set(
        (await db.execute(surface_query(definition.app_id))).scalars().all()
    )

    # Tenants that override this signal_set keep their own row instead.
    overriders = set(
        (
            await db.execute(
                select(SignalDefinition.tenant_id).where(
                    SignalDefinition.app_id == definition.app_id,
                    SignalDefinition.signal_set == definition.signal_set,
                    SignalDefinition.tenant_id != SYSTEM_TENANT_ID,
                )
            )
        ).scalars().all()
    )
    return sorted(all_tenants - overriders, key=str)


async def resolve_effective_definition(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    strategy: str,
) -> SignalDefinition | None:
    """The single enabled definition that applies to ``(tenant_id, app_id)``
    for a given ``strategy``.

    Tenant's own enabled row wins; otherwise the ``SYSTEM_TENANT_ID``
    template; otherwise ``None``. Intended for the single-definition-per-app
    strategies (``llm_transcript`` / ``llm_profile``) — the per-eval-run and
    operator-backfill callers.
    """
    rows = (
        await db.execute(
            select(SignalDefinition).where(
                SignalDefinition.app_id == app_id,
                SignalDefinition.strategy == strategy,
                SignalDefinition.enabled.is_(True),
                SignalDefinition.tenant_id.in_([tenant_id, SYSTEM_TENANT_ID]),
            )
        )
    ).scalars().all()
    if not rows:
        return None
    own = [r for r in rows if r.tenant_id == tenant_id]
    return own[0] if own else rows[0]
