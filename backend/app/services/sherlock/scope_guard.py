"""Deterministic scope gate (plan §4, §5.2).

:class:`ScopeGuard.resolve` is a pure function — no LLM, no DB writes,
no event emission. It takes auth + a request hint and returns exactly
one ``effective_app_id`` for the turn, along with the denied candidates.

App-alias authority is singular and explicit: ``App.slug`` is the
canonical id and ``App.config.displayName`` is the passive label. No
other source feeds aliases into scope in Phase 1.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from app.auth.context import AuthContext
from app.services.chat_engine.capability_pack import resolve_pack_ids_for_app
from app.services.sherlock.bundle_types import (
    ScopeContext,
    ScopeDenial,
)
from app.services.sherlock.provenance import Provenance, ProvenancedValue


_log = logging.getLogger(__name__)


class ScopeGuard:
    """Deterministic scope resolver for a single Sherlock turn.

    Usage:

        guard = ScopeGuard(app_registry=my_apps)
        scope = guard.resolve(
            auth=auth,
            requested_app_id='kaira-bot',
            session_app_id=session.app_id,
        )

    ``app_registry`` is an iterable of app-descriptor dicts (``slug``,
    ``is_active``, ``config``). In production the chat handler passes the
    live ``App`` rows it already loads; tests can inject plain dicts.
    """

    def __init__(self, app_registry: Sequence[Mapping[str, Any]]):
        self._apps: dict[str, Mapping[str, Any]] = {}
        for entry in app_registry or ():
            slug = entry.get('slug') if isinstance(entry, Mapping) else None
            if isinstance(slug, str) and slug:
                self._apps[slug] = entry

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def resolve(
        self,
        *,
        auth: AuthContext,
        requested_app_id: str | None = None,
        session_app_id: str | None = None,
    ) -> ScopeContext:
        """Return a single-app ``ScopeContext``.

        Precedence:
        1. ``requested_app_id`` (route body / caller hint).
        2. ``session_app_id`` (durable runtime session row).
        3. Lexicographically-first app the user has access to.

        Any candidate that fails RBAC / inactive / unknown-pack checks is
        recorded in ``scope_denials`` and the resolver moves to the next
        candidate. If every candidate fails, :class:`ValueError` is
        raised — the caller must handle the denied-request case.
        """
        tenant_id = auth.tenant_id
        user_id = auth.user_id
        allowed_app_ids = tuple(sorted(auth.app_access))

        requested_order: list[str] = []
        for candidate in (requested_app_id, session_app_id):
            if isinstance(candidate, str) and candidate and candidate not in requested_order:
                requested_order.append(candidate)
        requested_app_ids = tuple(requested_order)

        denials: list[ScopeDenial] = []
        effective: str | None = None

        for candidate in requested_order:
            reason = self._check_candidate(candidate, allowed_app_ids)
            if reason is None:
                effective = candidate
                break
            denials.append(reason)

        if effective is None:
            # Fall through: first allowed app not already denied above.
            already_tried = {d.app_id for d in denials}
            for candidate in allowed_app_ids:
                if candidate in already_tried:
                    continue
                reason = self._check_candidate(candidate, allowed_app_ids)
                if reason is None:
                    effective = candidate
                    break
                denials.append(reason)

        if effective is None:
            message = 'ScopeGuard: no resolvable app for this auth context'
            _log.warning('%s (allowed=%s, requested=%s)', message, allowed_app_ids, requested_order)
            raise ValueError(message)

        app = self._apps.get(effective) or {}
        capabilities = _read_capabilities(app)
        try:
            effective_pack_ids = tuple(resolve_pack_ids_for_app(
                list(capabilities) if capabilities else None,
                app_id=effective,
            ))
        except RuntimeError as exc:
            raise ValueError(
                f'ScopeGuard: effective app {effective!r} has invalid capabilities — {exc}'
            ) from exc

        app_aliases = _compute_aliases(effective, app)

        scope_hints = {
            'effective_app_id': ProvenancedValue(
                value=effective,
                provenance=Provenance.SCOPE_DERIVED,
                confidence=1.0,
                source_tool='scope_guard',
            ),
        }

        return ScopeContext(
            tenant_id=tenant_id,
            user_id=user_id,
            allowed_app_ids=allowed_app_ids,
            requested_app_ids=requested_app_ids,
            effective_app_id=effective,
            effective_pack_ids=effective_pack_ids,
            scope_hints=scope_hints,
            scope_denials=tuple(denials),
            app_aliases=app_aliases,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _check_candidate(
        self,
        candidate: str,
        allowed_app_ids: Sequence[str],
    ) -> ScopeDenial | None:
        if candidate not in allowed_app_ids:
            return ScopeDenial(
                reason_code='app_not_allowed',
                message=f'user does not have access to {candidate!r}',
                app_id=candidate,
            )
        app = self._apps.get(candidate)
        if app is None:
            return ScopeDenial(
                reason_code='app_unknown',
                message=f'app {candidate!r} not registered',
                app_id=candidate,
            )
        if app.get('is_active') is False:
            return ScopeDenial(
                reason_code='app_inactive',
                message=f'app {candidate!r} is inactive',
                app_id=candidate,
            )
        return None


# ---------------------------------------------------------------------------
# Event payload (plan §4) — emitted by the harness in M2.
# ---------------------------------------------------------------------------


def scope_resolved_event(scope: ScopeContext) -> dict[str, Any]:
    """Stable payload shape for the ``scope.resolved`` runtime event.

    Phase 1 produces the dict only; writing it to
    ``sherlock_turn_events`` is M2's responsibility.
    """
    return {
        'event_type': 'scope.resolved',
        'payload': scope.as_event_payload(),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_capabilities(app: Mapping[str, Any]) -> tuple[str, ...]:
    config = app.get('config') or {}
    if not isinstance(config, Mapping):
        return ()
    chat = config.get('chat') or {}
    if not isinstance(chat, Mapping):
        return ()
    caps = chat.get('capabilities') or []
    if not isinstance(caps, (list, tuple)):
        return ()
    return tuple(str(c) for c in caps if isinstance(c, str) and c)


def _compute_aliases(slug: str, app: Mapping[str, Any]) -> tuple[str, ...]:
    aliases = {slug}
    config = app.get('config') or {}
    if isinstance(config, Mapping):
        display = config.get('displayName')
        if isinstance(display, str) and display:
            aliases.add(display)
    return tuple(sorted(aliases))


__all__ = ['ScopeGuard', 'scope_resolved_event']
