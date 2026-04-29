"""Turn-time wiring between the harness and the sherlock assembly layer.

M2 / plan §4, §10.2. The harness (``chat_handler._execute_chat_turn``)
calls :func:`resolve_turn_scope_and_bundle` once per turn to obtain the
deterministic :class:`ScopeContext` + :class:`ScopedBundle` that
replace the old entity-recognition pre-pass.

This module is intentionally thin — it only glues ``ScopeGuard`` +
``BundleBuilder`` to the live SQLAlchemy session and returns the merged
outputs. The harness owns every downstream concern (prompt assembly,
SSE events, runtime persistence).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application
from app.services.sherlock.bundle import BundleBuilder
from app.services.sherlock.bundle_types import (
    ResolverRecord,
    ScopedBundle,
    ScopeContext,
)
from app.services.sherlock.scope_guard import ScopeGuard


@dataclass(frozen=True)
class TurnAssembly:
    """Everything the harness needs from the assembly layer for one turn."""

    scope: ScopeContext
    bundle: ScopedBundle


async def resolve_turn_scope_and_bundle(
    *,
    auth: Any,
    session_app_id: str | None,
    requested_app_id: str | None,
    db: AsyncSession,
) -> TurnAssembly:
    """Resolve deterministic scope + build the per-turn bundle.

    ``session_app_id`` is the durable ``sherlock_runtime_session.app_id``
    (the session is single-app; ``ScopeGuard`` still resolves it
    explicitly so app aliases land in scope metadata, not in entity
    recognition). ``requested_app_id`` is the optional route/body hint —
    ``ScopeGuard`` prefers it, then falls back to ``session_app_id``,
    then to the first lexicographic allowed app.
    """
    app_registry = await _load_app_registry(db)
    guard = ScopeGuard(app_registry)
    scope = guard.resolve(
        auth=auth,
        requested_app_id=requested_app_id,
        session_app_id=session_app_id,
    )

    bundle = await BundleBuilder(db).build(scope)
    return TurnAssembly(scope=scope, bundle=bundle)


async def _load_app_registry(db: AsyncSession) -> list[Mapping[str, Any]]:
    """Read the active ``App`` rows into the ``ScopeGuard`` registry shape."""
    rows = (
        await db.execute(
            select(Application.slug, Application.is_active, Application.config).where(Application.is_active.is_(True))
        )
    ).all()
    return [
        {
            'slug': slug,
            'is_active': bool(is_active),
            'config': config or {},
        }
        for slug, is_active, config in rows
    ]


# ---------------------------------------------------------------------------
# Bundle → legacy-resolver compat shape
# ---------------------------------------------------------------------------


def bundle_resolvers_as_legacy(
    bundle: ScopedBundle,
    *,
    entity_type: str | None = None,
) -> list[dict[str, Any]]:
    """Project ``bundle.resolvers`` into the legacy ``get_entity_resolvers``
    shape consumed by ``entity_resolution.resolve_entity_matches`` and
    ``tool_handlers.handle_discover``.

    The bundle owns the resolver authority in M2 — no runtime reads of
    the legacy app-config resolver seed. This helper stays small because
    the legacy dict shape is stable and the callers only need a handful
    of keys (``key``, ``entity_type``, ``source``, ``field``,
    ``dimension``, ``match``, ``limit``).
    """
    wanted = entity_type.strip().lower() if entity_type else None
    out: list[dict[str, Any]] = []
    for record in bundle.resolvers:
        if wanted and record.entity_type.strip().lower() != wanted:
            continue
        out.append(_resolver_record_to_legacy(record))
    return out


def _resolver_record_to_legacy(record: ResolverRecord) -> dict[str, Any]:
    cfg = dict(record.config or {})
    source = (str(cfg.get('source') or record.source) or '').strip() or 'semantic_dimension'
    match = _normalize_match(cfg.get('match'))
    limit = _normalize_limit(cfg.get('limit'))
    field = (str(cfg.get('field') or '').strip() or None)
    dimension = (str(cfg.get('dimension') or '').strip() or None)
    if source == 'semantic_dimension' and not dimension:
        dimension = record.entity_type
    return {
        'key': record.key or record.entity_type,
        'entity_type': record.entity_type,
        'description': record.description or f'Resolved value for {record.entity_type}.',
        'source': source,
        'field': field,
        'dimension': dimension,
        'match': match,
        'limit': limit,
    }


def _normalize_match(value: Any) -> str:
    normalized = str(value or 'contains').strip().lower()
    if normalized not in {'exact', 'prefix', 'contains'}:
        return 'contains'
    return normalized


def _normalize_limit(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = 10
    return min(max(numeric, 1), 25)


__all__ = [
    'TurnAssembly',
    'bundle_resolvers_as_legacy',
    'resolve_turn_scope_and_bundle',
]
