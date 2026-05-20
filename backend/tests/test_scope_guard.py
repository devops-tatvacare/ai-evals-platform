"""Phase 1 / M1 — ScopeGuard tests.

Covers the plan-pinned assertions:
4. ``ScopeGuard`` resolves a default active app.
5. ``ScopeGuard`` emits exactly one ``effective_app_id`` for a live turn.
6. Scope denials are captured.
7. ``scope.resolved`` event payload shape is stable.
"""
from __future__ import annotations

import uuid

import pytest

from app.auth import AuthContext
from app.services.sherlock.scope_guard import ScopeGuard, scope_resolved_event


_KAIRA = {
    'slug': 'kaira-bot',
    'is_active': True,
    'config': {
        'displayName': 'Kaira Bot',
        'chat': {'capabilities': ['orchestration.authoring']},
    },
}
_VOICE = {
    'slug': 'voice-rx',
    'is_active': True,
    'config': {
        'displayName': 'Voice Rx',
        'chat': {'capabilities': ['orchestration.authoring']},
    },
}
_INSIDE_SALES = {
    'slug': 'inside-sales',
    'is_active': True,
    'config': {
        'displayName': 'Inside Sales',
        'chat': {'capabilities': ['orchestration.authoring']},
    },
}
_INACTIVE_APP = {
    'slug': 'retired-app',
    'is_active': False,
    'config': {
        'displayName': 'Retired',
        'chat': {'capabilities': ['orchestration.authoring']},
    },
}


def _auth(*apps: str, tenant_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> AuthContext:
    return AuthContext(
        user_id=user_id or uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        email='test@example.com',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=frozenset(apps),
    )


def test_resolves_requested_app_when_allowed() -> None:
    guard = ScopeGuard([_KAIRA, _VOICE])
    auth = _auth('kaira-bot', 'voice-rx')

    scope = guard.resolve(auth=auth, requested_app_id='kaira-bot')

    assert scope.effective_app_id == 'kaira-bot'
    # Single-app invariant: exactly one effective app id.
    assert isinstance(scope.effective_app_id, str)
    assert scope.scope_denials == ()


def test_resolves_active_app_default_when_no_request() -> None:
    """Plan-assertion 4: ``ScopeGuard`` resolves a default active app."""
    guard = ScopeGuard([_KAIRA, _VOICE])
    auth = _auth('kaira-bot', 'voice-rx')

    scope = guard.resolve(auth=auth)

    # Lexicographic fallback across allowed apps; both pass RBAC/active
    # checks so we pick the first alphabetically.
    assert scope.effective_app_id == 'kaira-bot'
    assert scope.requested_app_ids == ()


def test_emits_exactly_one_effective_app_id_for_live_turn() -> None:
    """Plan-assertion 5: effective_app_id cardinality == 1 (plan §1.1)."""
    guard = ScopeGuard([_KAIRA, _VOICE, _INSIDE_SALES])
    auth = _auth('kaira-bot', 'voice-rx', 'inside-sales')

    scope = guard.resolve(auth=auth, requested_app_id='voice-rx', session_app_id='kaira-bot')

    # Single id -- never a list, never a tuple.
    assert isinstance(scope.effective_app_id, str)
    assert scope.effective_app_id  # non-empty
    # Even though we fed two candidates, only one is effective.
    assert scope.effective_app_id == 'voice-rx'
    # requested_app_ids preserves both candidates for audit, not scope.
    assert scope.requested_app_ids == ('voice-rx', 'kaira-bot')


def test_scope_denials_captured_for_unallowed_app() -> None:
    """Plan-assertion 6: scope denials are captured with a reason code."""
    guard = ScopeGuard([_KAIRA, _VOICE, _INSIDE_SALES])
    auth = _auth('kaira-bot', 'voice-rx')  # user cannot reach inside-sales

    scope = guard.resolve(auth=auth, requested_app_id='inside-sales')

    # Fell through to a permitted default.
    assert scope.effective_app_id in {'kaira-bot', 'voice-rx'}
    # Denial is recorded with a machine-readable reason.
    reasons = [(d.reason_code, d.app_id) for d in scope.scope_denials]
    assert ('app_not_allowed', 'inside-sales') in reasons


def test_scope_denials_capture_inactive_app() -> None:
    guard = ScopeGuard([_KAIRA, _INACTIVE_APP])
    auth = _auth('kaira-bot', 'retired-app')

    scope = guard.resolve(auth=auth, requested_app_id='retired-app')

    assert scope.effective_app_id == 'kaira-bot'
    reasons = {d.reason_code for d in scope.scope_denials}
    assert 'app_inactive' in reasons


def test_raises_when_no_resolvable_app() -> None:
    guard = ScopeGuard([_KAIRA])
    auth = _auth()  # empty app_access

    with pytest.raises(ValueError) as exc:
        guard.resolve(auth=auth)
    assert 'no resolvable app' in str(exc.value)


def test_scope_resolved_event_payload_shape_is_stable() -> None:
    """Plan-assertion 7: event payload shape is stable + introspectable."""
    guard = ScopeGuard([_KAIRA, _VOICE])
    auth = _auth('kaira-bot', 'voice-rx')

    scope = guard.resolve(auth=auth, requested_app_id='kaira-bot')
    event = scope_resolved_event(scope)

    assert event['event_type'] == 'scope.resolved'
    payload = event['payload']
    expected_keys = {
        'tenant_id',
        'user_id',
        'allowed_app_ids',
        'requested_app_ids',
        'effective_app_id',
        'effective_pack_ids',
        'app_aliases',
        'scope_hints',
        'scope_denials',
    }
    assert set(payload.keys()) == expected_keys
    assert payload['effective_app_id'] == 'kaira-bot'
    # Scope hints carry the ProvenancedValue shape.
    hint = payload['scope_hints']['effective_app_id']
    assert hint['value'] == 'kaira-bot'
    assert hint['provenance'] == 'scope_derived'
    # App aliases include both the slug and the display name.
    assert 'kaira-bot' in payload['app_aliases']
    assert 'Kaira Bot' in payload['app_aliases']


def test_effective_pack_ids_come_from_app_capabilities() -> None:
    guard = ScopeGuard([_KAIRA])
    auth = _auth('kaira-bot')

    scope = guard.resolve(auth=auth, requested_app_id='kaira-bot')

    # Pack registration is a module-import side effect; only packs
    # declared in App.config.chat.capabilities must resolve. Analytics
    # is built into v3 and not surfaced as a pack any more.
    assert 'orchestration.authoring' in scope.effective_pack_ids
