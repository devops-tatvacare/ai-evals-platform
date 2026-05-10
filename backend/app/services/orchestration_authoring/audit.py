"""Phase 3 — structured audit logger for orchestration_authoring tool calls.

Mirrors the `sherlock_v3.routing` logger pattern from `data_specialist.py`.
Every tool invocation in `orchestration_authoring_pack` writes one
JSON-friendly INFO line on `sherlock_v3.authoring`, matching the schema
locked in Decision §R10.

The schema is fixed; adding fields is a separate PR with a log-schema
migration. See `docs/plans/sherlock-builder/...` for the audit query
contract the security team consumes.
"""
from __future__ import annotations

import logging
from typing import Any

authoring_logger = logging.getLogger('sherlock_v3.authoring')


# Reason codes from the pack mapped onto the four-state validation_result
# enum from R10 (plus 'credential_leak_blocked' for Phase 3's egress
# filter). Permission/auth failures live on the orthogonal
# `permission_denied` boolean — validation never ran, so validation_result
# stays 'ok' for those rows.
_VALIDATION_RESULT_BY_REASON: dict[str, str] = {
    'NODE_CONFIG_INVALID': 'node_config_invalid',
    'UNKNOWN_NODE_TYPE': 'node_config_invalid',
    'PREDICATE_INVALID': 'node_config_invalid',
    'PATCH_OPS_EMPTY': 'node_config_invalid',
    'PATCH_TOO_LARGE': 'node_config_invalid',
    'GRAPH_INVALID': 'graph_invalid',
    'BASE_HASH_MISMATCH': 'graph_invalid',
    'UUID_NOT_AUTHORIZED': 'uuid_not_authorized',
    'CREDENTIAL_LEAK_BLOCKED': 'credential_leak_blocked',
}

_PERMISSION_DENIED_REASONS: frozenset[str] = frozenset({
    'PERMISSION_DENIED',
    'APP_FORBIDDEN',
    'NO_BUILDER_CONTEXT',
    'WORKFLOW_NOT_FOUND',
})

_VALIDATION_ENUM: frozenset[str] = frozenset({
    'ok',
    'node_config_invalid',
    'graph_invalid',
    'uuid_not_authorized',
    'credential_leak_blocked',
})


def validation_result_for(reason_code: str | None) -> str:
    """Map a pack reason_code onto the R10 validation_result enum."""
    if reason_code is None:
        return 'ok'
    return _VALIDATION_RESULT_BY_REASON.get(reason_code, 'ok')


def permission_denied_for(reason_code: str | None) -> bool:
    return reason_code in _PERMISSION_DENIED_REASONS if reason_code else False


def emit_authoring_event(event: dict[str, Any]) -> None:
    """Emit one structured audit log line for an authoring tool call.

    Schema (R10 + Phase 3 credential_leak_blocked extension):
      {
        event: 'authoring_tool_call',
        tool: str,
        app_id: str,
        tenant_id: str,
        user_id: str,
        workflow_id: str,
        patch_op_count: int,
        validation_result: 'ok'|'node_config_invalid'|'graph_invalid'
                          |'uuid_not_authorized'|'credential_leak_blocked',
        permission_denied: bool,
        duration_ms: int,
      }

    The caller is responsible for passing a fully-shaped dict; this
    helper only stamps `event='authoring_tool_call'` if missing and
    asserts the validation_result is in the closed enum (logged as a
    warning; the line still emits so the audit trail is never silently
    dropped).
    """
    payload = dict(event)
    payload.setdefault('event', 'authoring_tool_call')
    vr = payload.get('validation_result')
    if vr not in _VALIDATION_ENUM:
        authoring_logger.warning(
            'authoring audit: validation_result=%r not in enum; coercing to ok', vr,
        )
        payload['validation_result'] = 'ok'
    authoring_logger.info('sherlock_v3.authoring %s', payload)


__all__ = [
    'authoring_logger',
    'emit_authoring_event',
    'validation_result_for',
    'permission_denied_for',
]
