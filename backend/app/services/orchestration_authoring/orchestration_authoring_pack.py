"""orchestration.authoring CapabilityPack — Phase 1.

Phase 1 ships the pack as the canonical source of truth for tool_specs
and tool_handlers. The v3 `authoring_specialist` imports from here to
construct its FunctionTool list. The boot validator
`validate_all_app_pack_ids` discovers this module via the `*_pack.py`
glob and registers `pack_id='orchestration.authoring'`.

Ownership note: this file's `tool_specs()` / `tool_handlers()` are the
ONLY place tool surface is declared. Edits here automatically flow to
the specialist; do not duplicate tool wiring elsewhere.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Mapping, Sequence

# Import the orchestration nodes package so @register_node fires.
# Without this, NODE_REGISTRY is empty when the specialist boots in
# isolation (e.g. unit tests) and the node_type enum collapses.
import app.services.orchestration.nodes  # noqa: F401  (registry side-effect)
from app.services.chat_engine.artifact import (
    Outcome,
    build_envelope,
)
from app.services.chat_engine.capability_pack import register_pack
from app.services.orchestration.node_registry import (
    NODE_REGISTRY,
    NodeRegistryError,
    resolve_handler,
)
from app.services.orchestration_authoring.audit import (
    emit_authoring_event,
    permission_denied_for,
    validation_result_for,
)
from app.services.orchestration_authoring.canvas_patch import (
    CANVAS_PATCH_CONTRACT_ID,
    CanvasPatch,
    CanvasPatchOp,
)
from app.services.orchestration_authoring.lookup_models import (
    ActionTemplateRef,
    ActionTemplatesList,
    CohortDatasetRef,
    CohortDatasetsList,
    NodeTypeRef,
    NodeTypesList,
    ProviderConnectionRef,
    ProviderConnectionsList,
    WatiTemplateRef,
    WatiTemplatesList,
    contains_credential_fields,
)


# Phase 3 of the design ships a dedicated `audit.py`; Phase 1 keeps the
# logger named so the call sites land on the right channel from day one.
authoring_logger = logging.getLogger('sherlock_v3.authoring')


PACK_ID = 'orchestration.authoring'


# Pack-scoped reason codes (Decision §R5, plan §Reason codes). Keeping
# these exhaustive at boot lets the boot validator and tests assert the
# shape without spinning up the SDK.
REASON_CODES: frozenset[str] = frozenset({
    'NO_BUILDER_CONTEXT',
    'PERMISSION_DENIED',
    'APP_FORBIDDEN',
    'WORKFLOW_NOT_FOUND',
    'UNKNOWN_NODE_TYPE',
    'NODE_CONFIG_INVALID',
    'PREDICATE_INVALID',
    'GRAPH_INVALID',
    'UUID_NOT_AUTHORIZED',
    'BASE_HASH_MISMATCH',
    'CREDENTIAL_LEAK_BLOCKED',
    'PATCH_OPS_EMPTY',
    'PATCH_TOO_LARGE',
})


# Sanity caps so a confused LLM cannot DoS the canvas applier.
MAX_PATCH_OPS = 50
_VALID_OPS: frozenset[str] = frozenset({
    'add_node', 'update_node_config', 'connect', 'remove_node',
})


# ---------------------------------------------------------------------------
# Tool: apply_patch
# ---------------------------------------------------------------------------


def _node_type_enum() -> list[str]:
    """All node_type strings registered in NODE_REGISTRY, sorted.

    The specialist constructs the JSON schema with this enum so the SDK
    rejects unknown node types before the handler runs (defense in depth
    on top of the resolve_handler check).
    """
    seen: set[str] = set()
    for (_workflow_type, node_type) in NODE_REGISTRY:
        if not node_type.startswith('test.'):
            seen.add(node_type)
    return sorted(seen)


_APPLY_PATCH_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['ops_json', 'rationale'],
    'properties': {
        'ops_json': {
            'type': 'string',
            'description': (
                "JSON-encoded array of ops. Each op is "
                "{op, node_id, payload}. Op shapes:\n"
                "- add_node: payload = {node_type, position?, config}\n"
                "- update_node_config: payload = {config_patch}\n"
                "- connect: payload = {source_node_id, output_id, target_node_id, edge_id}\n"
                "- remove_node: payload = {}\n"
                "Configs are JSON OBJECTS inside this string, not nested strings."
            ),
        },
        'rationale': {
            'type': 'string',
            'description': 'One-sentence reason; surfaced to the user.',
        },
    },
}


def _result_json(
    *,
    status: str,
    summary: str,
    artifacts: list[dict[str, Any]],
    started: float,
    reason_code: str | None = None,
    detail: dict[str, Any] | None = None,
) -> str:
    """Shape a SpecialistResult JSON identical to data_specialist's contract.

    `kind='action'` is the existing literal in `contracts.ResultKind`
    (no new contract enum).
    """
    meta: dict[str, Any] = {
        'confidence': 0.8 if status == 'ok' else 0.0,
        'latency_ms': int((time.monotonic() - started) * 1000),
        'source_pack_id': PACK_ID,
    }
    if reason_code is not None:
        meta['reason_code'] = reason_code
    if detail is not None:
        meta['detail'] = detail
    return json.dumps({
        'kind': 'action',
        'status': status,
        'summary': summary,
        'evidence': [],
        'artifacts': artifacts,
        'state_delta': {},
        'meta': meta,
    }, default=str)


def _error_result(
    *, reason_code: str, message: str, started: float,
    detail: dict[str, Any] | None = None,
) -> str:
    return _result_json(
        status='error',
        summary=message,
        artifacts=[],
        started=started,
        reason_code=reason_code,
        detail=detail,
    )


def _emit_authoring_audit(
    *,
    tool: str,
    builder_context: Any,
    auth: Any,
    started: float,
    reason_code: str | None,
    patch_op_count: int,
) -> None:
    """Stamp one R10 audit line for a tool invocation.

    Caller wraps its body in `try`/`finally` so this fires even on
    unexpected exceptions; the security team's audit trail is the only
    durable trace of authoring activity.
    """
    emit_authoring_event({
        'tool': tool,
        'app_id': str(getattr(builder_context, 'app_id', '') or ''),
        'tenant_id': str(getattr(auth, 'tenant_id', '') or ''),
        'user_id': str(getattr(auth, 'user_id', '') or ''),
        'workflow_id': str(getattr(builder_context, 'workflow_id', '') or ''),
        'patch_op_count': int(patch_op_count),
        'validation_result': validation_result_for(reason_code),
        'permission_denied': permission_denied_for(reason_code),
        'duration_ms': int((time.monotonic() - started) * 1000),
    })


def _validate_op_shape(op: Any) -> tuple[CanvasPatchOp | None, str | None]:
    """Cast a raw op dict into `CanvasPatchOp`. Returns (op, error_message)."""
    if not isinstance(op, dict):
        return None, 'each op must be an object'
    op_kind = op.get('op')
    if op_kind not in _VALID_OPS:
        return None, f'unknown op {op_kind!r}'
    node_id = op.get('node_id')
    if not isinstance(node_id, str) or not node_id:
        return None, "op missing 'node_id'"
    try:
        return CanvasPatchOp(
            op=op_kind,
            node_id=node_id,
            payload=op.get('payload') or {},
        ), None
    except Exception as exc:  # pydantic ValidationError; treat as shape error
        return None, f'invalid op shape: {exc}'


def _validate_node_config(
    *,
    workflow_type: str,
    node_type: str,
    config: Any,
) -> tuple[bool, str]:
    """Resolve handler and run config_schema(**config). Returns (ok, error)."""
    try:
        handler = resolve_handler(workflow_type=workflow_type, node_type=node_type)
    except NodeRegistryError:
        return False, f'unknown node_type {node_type!r} for workflow_type {workflow_type!r}'
    if not isinstance(config, dict):
        return False, "'config' must be an object"
    try:
        handler.config_schema(**config)
    except Exception as exc:  # pydantic ValidationError surfaces here
        return False, f'config invalid for {node_type}: {exc}'
    return True, ''


# ---------------------------------------------------------------------------
# Graph pre-flight + UUID allowlist
# ---------------------------------------------------------------------------


# Field names inside a node config that reference an external resource
# UUID. Anything appearing under one of these names must have been
# returned by a list_* lookup earlier in the same turn.
_UUID_REFERENCE_KEYS: frozenset[str] = frozenset({
    'connection_id',
    'dataset_version_id',
    'action_template_id',
})


def _walk_uuid_references(payload: Any) -> list[tuple[str, str]]:
    """Yield every (field_name, value) where field_name is in
    `_UUID_REFERENCE_KEYS`. Recursive over dicts and lists.
    """
    out: list[tuple[str, str]] = []

    def _walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, v in value.items():
                if (
                    isinstance(key, str)
                    and key in _UUID_REFERENCE_KEYS
                    and isinstance(v, str) and v
                ):
                    out.append((key, v))
                _walk(v)
        elif isinstance(value, list):
            for item in value:
                _walk(item)

    _walk(payload)
    return out


def _apply_ops_to_definition(
    *,
    base_definition: dict[str, Any],
    ops: list[CanvasPatchOp],
) -> dict[str, Any]:
    """Replay a CanvasPatch against a copy of the canvas definition.

    Used by Step 9 graph preflight to feed `validate_definition` a
    realistic post-patch shape. Mirrors the frontend applier semantics:

      - add_node:           append `{id, type, position?, data, config}`
      - update_node_config: shallow-merge `payload.config_patch` into
                            the matching node's `config`
      - connect:            append `{id, source, target, output_id}`
      - remove_node:        drop the node and any edges that touch it
    """
    nodes = list(base_definition.get('nodes') or [])
    edges = list(base_definition.get('edges') or [])

    by_id: dict[str, dict[str, Any]] = {n.get('id'): dict(n) for n in nodes if n.get('id')}
    new_nodes: list[dict[str, Any]] = list(by_id.values())
    new_edges: list[dict[str, Any]] = [dict(e) for e in edges]

    for op in ops:
        if op.op == 'add_node':
            node_type = op.payload.get('node_type')
            new_node = {
                'id': op.node_id,
                'type': node_type,
                'position': op.payload.get('position') or {},
                'data': {},
                'config': dict(op.payload.get('config') or {}),
            }
            by_id[op.node_id] = new_node
            new_nodes.append(new_node)
        elif op.op == 'update_node_config':
            target = by_id.get(op.node_id)
            if target is not None:
                cfg = dict(target.get('config') or {})
                cfg.update(op.payload.get('config_patch') or {})
                target['config'] = cfg
        elif op.op == 'connect':
            new_edges.append({
                'id': op.payload.get('edge_id'),
                'source': op.payload.get('source_node_id'),
                'target': op.payload.get('target_node_id'),
                'output_id': op.payload.get('output_id'),
            })
        elif op.op == 'remove_node':
            by_id.pop(op.node_id, None)
            new_nodes = [n for n in new_nodes if n.get('id') != op.node_id]
            new_edges = [
                e for e in new_edges
                if e.get('source') != op.node_id and e.get('target') != op.node_id
            ]

    return {
        'nodes': new_nodes,
        'edges': new_edges,
        'canvas': base_definition.get('canvas') or {},
    }


async def _apply_patch_handler(ctx: Any, args: str) -> str:
    """Terminal authoring tool — validate ops + emit one CanvasPatch artifact.

    Body wrapped in `try`/`finally` so the R10 audit line lands even on
    unexpected exceptions. Every reason_code path stamps `reason_code`
    before returning so the audit row reflects what actually happened.
    """
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth = getattr(sherlock_ctx, 'auth', None)
    reason_code: str | None = None
    patch_op_count = 0

    try:
        if builder_context is None:
            reason_code = 'NO_BUILDER_CONTEXT'
            return _error_result(
                reason_code=reason_code,
                message='Authoring tools require an active builder context.',
                started=started,
            )

        # Layered permission re-check (R3). The route gate (R1) and conditional
        # tool inclusion (R2) cover the same ground; this ensures a future bug
        # in either does not bypass the gate. Use the canonical helper so the
        # Owner role's permission bypass is honored here too.
        from app.auth.permissions import missing_permissions
        if auth is None or missing_permissions(auth, 'orchestration:manage'):
            reason_code = 'PERMISSION_DENIED'
            return _error_result(
                reason_code=reason_code,
                message='Missing orchestration:manage permission.',
                started=started,
            )
        if builder_context.app_id not in getattr(auth, 'app_access', frozenset()):
            reason_code = 'APP_FORBIDDEN'
            return _error_result(
                reason_code=reason_code,
                message=f'No access to app {builder_context.app_id}.',
                started=started,
            )

        try:
            parsed = json.loads(args) if args.strip() else {}
        except json.JSONDecodeError as exc:
            reason_code = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code=reason_code,
                message=f'apply_patch arguments are not valid JSON: {exc}',
                started=started,
            )

        rationale = (parsed.get('rationale') or '').strip()
        raw_ops_json = parsed.get('ops_json')
        if not isinstance(raw_ops_json, str) or not raw_ops_json.strip():
            reason_code = 'PATCH_OPS_EMPTY'
            return _error_result(
                reason_code=reason_code,
                message='apply_patch requires a non-empty ops_json string.',
                started=started,
            )
        try:
            raw_ops = json.loads(raw_ops_json)
        except json.JSONDecodeError as exc:
            reason_code = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code=reason_code,
                message=f'ops_json is not valid JSON: {exc}',
                started=started,
            )
        if not isinstance(raw_ops, list) or len(raw_ops) == 0:
            reason_code = 'PATCH_OPS_EMPTY'
            return _error_result(
                reason_code=reason_code,
                message='ops_json must be a non-empty array.',
                started=started,
            )
        if len(raw_ops) > MAX_PATCH_OPS:
            reason_code = 'PATCH_TOO_LARGE'
            patch_op_count = len(raw_ops)
            return _error_result(
                reason_code=reason_code,
                message=f'ops_json has {len(raw_ops)} ops; max is {MAX_PATCH_OPS}.',
                started=started,
            )

        workflow_type = builder_context.workflow_type
        validated_ops: list[CanvasPatchOp] = []
        for index, raw_op in enumerate(raw_ops):
            op, shape_err = _validate_op_shape(raw_op)
            if op is None:
                reason_code = 'NODE_CONFIG_INVALID'
                patch_op_count = len(raw_ops)
                return _error_result(
                    reason_code=reason_code,
                    message=f'op[{index}]: {shape_err}',
                    started=started,
                )
            if op.op == 'add_node':
                node_type = op.payload.get('node_type')
                if not isinstance(node_type, str) or not node_type:
                    reason_code = 'UNKNOWN_NODE_TYPE'
                    patch_op_count = len(raw_ops)
                    return _error_result(
                        reason_code=reason_code,
                        message=f'op[{index}] add_node: payload.node_type required',
                        started=started,
                    )
                ok, err = _validate_node_config(
                    workflow_type=workflow_type,
                    node_type=node_type,
                    config=op.payload.get('config') or {},
                )
                if not ok:
                    reason_code = (
                        'UNKNOWN_NODE_TYPE'
                        if 'unknown node_type' in err
                        else 'NODE_CONFIG_INVALID'
                    )
                    patch_op_count = len(raw_ops)
                    return _error_result(
                        reason_code=reason_code,
                        message=f'op[{index}] {err}',
                        started=started,
                    )
            elif op.op == 'update_node_config':
                patch = op.payload.get('config_patch')
                if not isinstance(patch, dict):
                    reason_code = 'NODE_CONFIG_INVALID'
                    patch_op_count = len(raw_ops)
                    return _error_result(
                        reason_code=reason_code,
                        message=f'op[{index}] update_node_config: payload.config_patch must be an object',
                        started=started,
                    )
            elif op.op == 'connect':
                for required in ('source_node_id', 'output_id', 'target_node_id', 'edge_id'):
                    if not isinstance(op.payload.get(required), str) or not op.payload.get(required):
                        reason_code = 'NODE_CONFIG_INVALID'
                        patch_op_count = len(raw_ops)
                        return _error_result(
                            reason_code=reason_code,
                            message=f'op[{index}] connect: payload.{required} required',
                            started=started,
                        )
            # remove_node: no payload fields to validate at this layer
            validated_ops.append(op)
        patch_op_count = len(validated_ops)

        # ── R6: per-turn UUID allowlist enforcement ──────────────────────
        scratch = getattr(sherlock_ctx, 'scratch', {}) or {}
        authorized = scratch.get('authorized_uuids')
        if not isinstance(authorized, set):
            authorized = set(authorized or [])
        for op in validated_ops:
            for field, value in _walk_uuid_references(op.payload):
                if value not in authorized:
                    authoring_logger.warning(
                        'apply_patch UUID_NOT_AUTHORIZED field=%s value=%s '
                        'tenant=%s app=%s',
                        field, value,
                        getattr(auth, 'tenant_id', None),
                        builder_context.app_id,
                    )
                    reason_code = 'UUID_NOT_AUTHORIZED'
                    return _error_result(
                        reason_code=reason_code,
                        message=(
                            f'Patch references {field}={value} but no list_* '
                            'tool returned that UUID this turn.'
                        ),
                        started=started,
                    )

        # ── Graph-level pre-flight ───────────────────────────────────────
        # Validate the patched-copy definition against publish-time graph
        # rules. We run the same validator that publish uses; draft mode
        # tolerates publish-required fields being absent (the validator
        # checks structure, not dispatch readiness).
        try:
            from app.services.orchestration.definition_validator import (
                DefinitionValidationError,
                validate_definition,
            )
            from app.services.orchestration.definition_normalizer import (
                normalize_definition,
            )

            patched = _apply_ops_to_definition(
                base_definition=builder_context.definition or {},
                ops=validated_ops,
            )
            try:
                normalized = normalize_definition(patched)
            except Exception:  # noqa: BLE001 — bad shape; fall through to validator
                normalized = patched
            try:
                validate_definition(normalized, workflow_type=workflow_type)
            except DefinitionValidationError as exc:
                reason_code = 'GRAPH_INVALID'
                return _error_result(
                    reason_code=reason_code,
                    message=f'Patched graph fails validation: {exc}',
                    started=started,
                    detail={'errors': exc.errors},
                )
        except ImportError:
            # `definition_normalizer.normalize_definition` may be absent in
            # older branches; fail open for graph rules then. Per-op validation
            # already ran.
            pass

        canvas_patch = CanvasPatch(
            workflow_id=str(builder_context.workflow_id),
            version_id=(
                str(builder_context.version_id)
                if builder_context.version_id is not None else None
            ),
            base_data_hash=builder_context.data_hash,
            ops=validated_ops,
            rationale=rationale,
        )

        payload = canvas_patch.model_dump(mode='json')

        # Egress credential filter (R5) — defense in depth even on the patch
        # body. Patches reference connection_ids by UUID; a credential field
        # leaking into a config payload would be a bug, but we catch it here
        # rather than trusting upstream to be clean.
        leaked_field = contains_credential_fields(payload)
        if leaked_field is not None:
            authoring_logger.warning(
                'apply_patch egress filter blocked field=%s tenant=%s app=%s',
                leaked_field,
                getattr(auth, 'tenant_id', None),
                builder_context.app_id,
            )
            reason_code = 'CREDENTIAL_LEAK_BLOCKED'
            return _error_result(
                reason_code=reason_code,
                message=f'Patch payload contained forbidden field: {leaked_field}',
                started=started,
            )

        artifact = {
            'kind': CANVAS_PATCH_CONTRACT_ID,
            'payload': payload,
        }

        return _result_json(
            status='ok',
            summary=f'Proposed {len(validated_ops)} canvas op(s).',
            artifacts=[artifact],
            started=started,
        )
    finally:
        _emit_authoring_audit(
            tool='apply_patch',
            builder_context=builder_context,
            auth=auth,
            started=started,
            reason_code=reason_code,
            patch_op_count=patch_op_count,
        )


# ---------------------------------------------------------------------------
# Lookup tools — tenant + app scoped (R4) and credential-stripped (R5)
# ---------------------------------------------------------------------------


_LIST_PROVIDER_CONNECTIONS_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['provider'],
    'properties': {
        'provider': {
            'type': 'string',
            'enum': ['wati', 'bolna', 'sms', 'lsq', 'msg91', 'aisensy'],
            'description': 'Provider type to filter on.',
        },
    },
}

_LIST_ACTION_TEMPLATES_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['channel'],
    'properties': {
        'channel': {
            'type': 'string',
            'description': "Channel slug (e.g. 'whatsapp', 'voice', 'sms', 'lsq').",
        },
    },
}

_LIST_WATI_TEMPLATES_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['connection_id'],
    'properties': {
        'connection_id': {
            'type': 'string',
            'description': 'UUID of the WATI provider_connections row.',
        },
    },
}

_LIST_COHORT_DATASETS_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'properties': {},
}

_LIST_NODE_TYPES_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'properties': {
        'category': {
            'type': 'string',
            'description': "Optional category filter (e.g. 'source', 'sink').",
        },
    },
}


def _record_authorized_uuids(scratch: dict[str, Any], uuids: list[str]) -> None:
    """Add returned UUIDs to the per-turn allowlist (R6).

    `apply_patch` will reject any patch whose connection_id /
    dataset_version_id / action_template_id is not in this set. Step 9
    enforces; lookups populate.
    """
    bucket = scratch.setdefault('authorized_uuids', set())
    if not isinstance(bucket, set):
        bucket = set(bucket)
        scratch['authorized_uuids'] = bucket
    for value in uuids:
        if value:
            bucket.add(str(value))


def _lookup_result_json(
    *,
    started: float,
    summary: str,
    payload: dict[str, Any],
    tool_name: str,
) -> str:
    """Wrap a lookup result in the SpecialistResult shape.

    Lookups don't emit artifacts — the supervisor consumes the payload
    directly. Putting them under SpecialistResult keeps the
    custom_output_extractor's "match by tool name" contract intact and
    makes the audit log uniform.
    """
    leaked = contains_credential_fields(payload)
    if leaked is not None:
        authoring_logger.warning(
            'lookup egress filter blocked tool=%s field=%s', tool_name, leaked,
        )
        return _error_result(
            reason_code='CREDENTIAL_LEAK_BLOCKED',
            message=f'Lookup result contained forbidden field: {leaked}',
            started=started,
        )
    meta: dict[str, Any] = {
        'confidence': 1.0,
        'latency_ms': int((time.monotonic() - started) * 1000),
        'source_pack_id': PACK_ID,
        'tool': tool_name,
    }
    return json.dumps({
        'kind': 'data',
        'status': 'ok',
        'summary': summary,
        'evidence': [],
        'artifacts': [],
        'state_delta': {},
        'meta': meta,
        'payload': payload,
    }, default=str)


async def _check_layered_auth(
    sherlock_ctx: Any,
    *,
    started: float,
    audit: dict[str, Any],
) -> tuple[Any, Any] | str:
    """Re-run R3 checks. Returns (auth, builder_context) or an error JSON.

    `audit` is mutated in place: on failure paths, `audit['reason_code']`
    is stamped before the error JSON is returned so the caller's
    `try/finally` audit emit picks up the right validation_result.
    """
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth = getattr(sherlock_ctx, 'auth', None)
    if builder_context is None:
        audit['reason_code'] = 'NO_BUILDER_CONTEXT'
        return _error_result(
            reason_code='NO_BUILDER_CONTEXT',
            message='Authoring tools require an active builder context.',
            started=started,
        )
    # Owner role bypass via canonical helper (matches `_lookup_handler`
    # block above; see comment there).
    from app.auth.permissions import missing_permissions as _missing_perms_apply
    if auth is None or _missing_perms_apply(auth, 'orchestration:manage'):
        audit['reason_code'] = 'PERMISSION_DENIED'
        return _error_result(
            reason_code='PERMISSION_DENIED',
            message='Missing orchestration:manage permission.',
            started=started,
        )
    if builder_context.app_id not in getattr(auth, 'app_access', frozenset()):
        audit['reason_code'] = 'APP_FORBIDDEN'
        return _error_result(
            reason_code='APP_FORBIDDEN',
            message=f'No access to app {builder_context.app_id}.',
            started=started,
        )
    return auth, builder_context


def _mark_leak_in_result(audit: dict[str, Any], result: str) -> str:
    """Mirror a CREDENTIAL_LEAK_BLOCKED reason_code from the lookup
    result JSON into the audit dict, so the caller's `finally` emit
    records the right validation_result. Returns the original result
    untouched so callers can pass it straight back to the SDK."""
    try:
        decoded = json.loads(result)
        meta = decoded.get('meta') if isinstance(decoded, dict) else None
        if isinstance(meta, dict) and meta.get('reason_code') == 'CREDENTIAL_LEAK_BLOCKED':
            audit['reason_code'] = 'CREDENTIAL_LEAK_BLOCKED'
    except (ValueError, AttributeError):
        pass
    return result


async def _list_node_types_handler(ctx: Any, args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    audit: dict[str, Any] = {'reason_code': None}
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth = getattr(sherlock_ctx, 'auth', None)
    try:
        check = await _check_layered_auth(sherlock_ctx, started=started, audit=audit)
        if isinstance(check, str):
            return check
        parsed = json.loads(args) if args.strip() else {}
        category_filter = (parsed.get('category') or '').strip() or None

        items: list[NodeTypeRef] = []
        seen: dict[str, NodeTypeRef] = {}
        for (workflow_type, node_type), handler in NODE_REGISTRY.items():
            if node_type.startswith('test.'):
                continue
            if category_filter and getattr(handler, 'category', '') != category_filter:
                continue
            ref = seen.get(node_type)
            if ref is None:
                ref = NodeTypeRef(
                    node_type=node_type,
                    category=str(getattr(handler, 'category', '')),
                    workflow_types=[workflow_type],
                    output_edges=list(getattr(handler, 'output_edges', []) or []),
                )
                seen[node_type] = ref
                items.append(ref)
            else:
                if workflow_type not in ref.workflow_types:
                    ref.workflow_types.append(workflow_type)

        payload = NodeTypesList(items=items).model_dump(mode='json')
        return _mark_leak_in_result(audit, _lookup_result_json(
            started=started,
            summary=f'{len(items)} node type(s) available.',
            payload=payload,
            tool_name='list_node_types',
        ))
    finally:
        _emit_authoring_audit(
            tool='list_node_types',
            builder_context=builder_context,
            auth=auth,
            started=started,
            reason_code=audit.get('reason_code'),
            patch_op_count=0,
        )


async def _list_provider_connections_handler(ctx: Any, args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    audit: dict[str, Any] = {'reason_code': None}
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth_outer = getattr(sherlock_ctx, 'auth', None)
    try:
        check = await _check_layered_auth(sherlock_ctx, started=started, audit=audit)
        if isinstance(check, str):
            return check
        auth, builder_context = check

        parsed = json.loads(args) if args.strip() else {}
        provider = parsed.get('provider')
        if not isinstance(provider, str) or not provider:
            audit['reason_code'] = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code='NODE_CONFIG_INVALID',
                message='provider is required',
                started=started,
            )

        from sqlalchemy import select

        from app.database import async_session
        from app.models.provider_connection import ProviderConnection

        async with async_session() as db:
            rows = (
                await db.execute(
                    select(ProviderConnection).where(
                        ProviderConnection.tenant_id == auth.tenant_id,
                        ProviderConnection.app_id == builder_context.app_id,
                        ProviderConnection.provider == provider,
                        ProviderConnection.active.is_(True),
                    )
                )
            ).scalars().all()

        items = [
            ProviderConnectionRef(
                id=str(row.id),
                name=row.name,
                provider=row.provider,
            )
            for row in rows
        ]
        _record_authorized_uuids(
            sherlock_ctx.scratch if hasattr(sherlock_ctx, 'scratch') else {},
            [item.id for item in items],
        )

        payload = ProviderConnectionsList(items=items).model_dump(mode='json')
        return _mark_leak_in_result(audit, _lookup_result_json(
            started=started,
            summary=f'{len(items)} {provider} connection(s).',
            payload=payload,
            tool_name='list_provider_connections',
        ))
    finally:
        _emit_authoring_audit(
            tool='list_provider_connections',
            builder_context=builder_context,
            auth=auth_outer,
            started=started,
            reason_code=audit.get('reason_code'),
            patch_op_count=0,
        )


async def _list_action_templates_handler(ctx: Any, args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    audit: dict[str, Any] = {'reason_code': None}
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth_outer = getattr(sherlock_ctx, 'auth', None)
    try:
        check = await _check_layered_auth(sherlock_ctx, started=started, audit=audit)
        if isinstance(check, str):
            return check
        auth, builder_context = check

        parsed = json.loads(args) if args.strip() else {}
        channel = parsed.get('channel')
        if not isinstance(channel, str) or not channel:
            audit['reason_code'] = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code='NODE_CONFIG_INVALID',
                message='channel is required',
                started=started,
            )

        from sqlalchemy import or_, select

        from app.database import async_session
        from app.models.orchestration import WorkflowActionTemplate

        async with async_session() as db:
            rows = (
                await db.execute(
                    select(WorkflowActionTemplate).where(
                        or_(
                            WorkflowActionTemplate.tenant_id == auth.tenant_id,
                            WorkflowActionTemplate.tenant_id.is_(None),
                        ),
                        or_(
                            WorkflowActionTemplate.app_id == builder_context.app_id,
                            WorkflowActionTemplate.app_id.is_(None),
                        ),
                        WorkflowActionTemplate.channel == channel,
                        WorkflowActionTemplate.active.is_(True),
                    )
                )
            ).scalars().all()

        items = [
            ActionTemplateRef(
                id=str(row.id),
                slug=row.slug,
                name=row.name,
                channel=row.channel,
            )
            for row in rows
        ]
        _record_authorized_uuids(
            sherlock_ctx.scratch if hasattr(sherlock_ctx, 'scratch') else {},
            [item.id for item in items],
        )

        payload = ActionTemplatesList(items=items).model_dump(mode='json')
        return _mark_leak_in_result(audit, _lookup_result_json(
            started=started,
            summary=f'{len(items)} action template(s) for channel {channel}.',
            payload=payload,
            tool_name='list_action_templates',
        ))
    finally:
        _emit_authoring_audit(
            tool='list_action_templates',
            builder_context=builder_context,
            auth=auth_outer,
            started=started,
            reason_code=audit.get('reason_code'),
            patch_op_count=0,
        )


async def _list_wati_templates_handler(ctx: Any, args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    audit: dict[str, Any] = {'reason_code': None}
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth_outer = getattr(sherlock_ctx, 'auth', None)
    try:
        check = await _check_layered_auth(sherlock_ctx, started=started, audit=audit)
        if isinstance(check, str):
            return check
        auth, builder_context = check

        parsed = json.loads(args) if args.strip() else {}
        connection_id_raw = parsed.get('connection_id')
        if not isinstance(connection_id_raw, str) or not connection_id_raw:
            audit['reason_code'] = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code='NODE_CONFIG_INVALID',
                message='connection_id is required',
                started=started,
            )
        try:
            import uuid as _uuid
            connection_uuid = _uuid.UUID(connection_id_raw)
        except (TypeError, ValueError):
            audit['reason_code'] = 'NODE_CONFIG_INVALID'
            return _error_result(
                reason_code='NODE_CONFIG_INVALID',
                message='connection_id is not a UUID',
                started=started,
            )

        # Connection-ownership re-check at the same SQL boundary as the
        # template fetch — use the existing helper so the tenant + app scope
        # mirrors the connections route.
        from app.database import async_session
        from app.services.orchestration.api.agents import list_connection_wati_templates

        async with async_session() as db:
            result = await list_connection_wati_templates(
                db,
                tenant_id=auth.tenant_id,
                app_id=builder_context.app_id,
                connection_id=connection_uuid,
            )

        raw_items = result.get('items') or []
        items: list[WatiTemplateRef] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            params = raw.get('parameters') or []
            if not isinstance(params, list):
                params = []
            items.append(WatiTemplateRef(
                name=str(raw.get('name') or ''),
                language=str(raw.get('language') or ''),
                status=str(raw.get('status') or ''),
                parameters=[str(p) for p in params],
            ))

        payload = WatiTemplatesList(
            items=items,
            error=result.get('error'),
        ).model_dump(mode='json')
        return _mark_leak_in_result(audit, _lookup_result_json(
            started=started,
            summary=f'{len(items)} WATI template(s).',
            payload=payload,
            tool_name='list_wati_templates',
        ))
    finally:
        _emit_authoring_audit(
            tool='list_wati_templates',
            builder_context=builder_context,
            auth=auth_outer,
            started=started,
            reason_code=audit.get('reason_code'),
            patch_op_count=0,
        )


async def _list_cohort_datasets_handler(ctx: Any, args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = getattr(ctx, 'context', ctx)
    audit: dict[str, Any] = {'reason_code': None}
    builder_context = getattr(sherlock_ctx, 'builder_context', None)
    auth_outer = getattr(sherlock_ctx, 'auth', None)
    try:
        check = await _check_layered_auth(sherlock_ctx, started=started, audit=audit)
        if isinstance(check, str):
            return check
        auth, builder_context = check
        del args  # no parameters

        from sqlalchemy import desc, select

        from app.database import async_session
        from app.models.orchestration import CohortDataset, CohortDatasetVersion

        items: list[CohortDatasetRef] = []
        async with async_session() as db:
            rows = (
                await db.execute(
                    select(CohortDataset).where(
                        CohortDataset.tenant_id == auth.tenant_id,
                        CohortDataset.app_id == builder_context.app_id,
                    )
                )
            ).scalars().all()
            for row in rows:
                latest_version = await db.scalar(
                    select(CohortDatasetVersion)
                    .where(CohortDatasetVersion.dataset_id == row.id)
                    .order_by(desc(CohortDatasetVersion.version_number))
                    .limit(1)
                )
                items.append(CohortDatasetRef(
                    id=str(row.id),
                    name=row.name,
                    latest_version_id=(
                        str(latest_version.id) if latest_version is not None else None
                    ),
                ))

        _record_authorized_uuids(
            sherlock_ctx.scratch if hasattr(sherlock_ctx, 'scratch') else {},
            [item.id for item in items if item.id]
            + [item.latest_version_id for item in items if item.latest_version_id],
        )

        payload = CohortDatasetsList(items=items).model_dump(mode='json')
        return _mark_leak_in_result(audit, _lookup_result_json(
            started=started,
            summary=f'{len(items)} cohort dataset(s).',
            payload=payload,
            tool_name='list_cohort_datasets',
        ))
    finally:
        _emit_authoring_audit(
            tool='list_cohort_datasets',
            builder_context=builder_context,
            auth=auth_outer,
            started=started,
            reason_code=audit.get('reason_code'),
            patch_op_count=0,
        )


# ---------------------------------------------------------------------------
# Pack class
# ---------------------------------------------------------------------------


class OrchestrationAuthoringPack:
    """Concrete `CapabilityPack` for orchestration authoring tools."""

    pack_id: str = PACK_ID
    reason_codes: frozenset[str] = REASON_CODES
    artifact_contracts: Mapping[str, type] = {
        CANVAS_PATCH_CONTRACT_ID: CanvasPatch,
    }
    artifact_extras_contracts: Mapping[str, type] = {}

    def tool_specs(self) -> Sequence[Mapping[str, Any]]:
        return (
            {
                'name': 'apply_patch',
                'description': (
                    'Terminal authoring tool. Emit a single CanvasPatch '
                    'with all ops you want to apply this turn. Returns a '
                    'SpecialistResult; on status=error you may regenerate '
                    'and call once more.'
                ),
                'params_json_schema': _APPLY_PATCH_SCHEMA,
            },
            {
                'name': 'list_node_types',
                'description': (
                    'Enumerate the node types available in this builder. '
                    'Optional `category` filter; safe to call multiple times.'
                ),
                'params_json_schema': _LIST_NODE_TYPES_SCHEMA,
            },
            {
                'name': 'list_provider_connections',
                'description': (
                    'List provider_connections in this app for a given '
                    'provider. Returns (id, name, provider) only — no '
                    'credentials. UUIDs returned here are added to the '
                    'per-turn allowlist used by apply_patch.'
                ),
                'params_json_schema': _LIST_PROVIDER_CONNECTIONS_SCHEMA,
            },
            {
                'name': 'list_action_templates',
                'description': (
                    'List action templates available for the named '
                    'channel in this tenant + app. Returns (id, slug, '
                    'name, channel).'
                ),
                'params_json_schema': _LIST_ACTION_TEMPLATES_SCHEMA,
            },
            {
                'name': 'list_wati_templates',
                'description': (
                    'List WATI message templates registered against the '
                    'given connection_id. Returns (name, language, status, '
                    'parameters); never returns API tokens.'
                ),
                'params_json_schema': _LIST_WATI_TEMPLATES_SCHEMA,
            },
            {
                'name': 'list_cohort_datasets',
                'description': (
                    'List cohort_datasets in this app. Returns (id, name, '
                    'latest_version_id). Both IDs are added to the '
                    'per-turn allowlist.'
                ),
                'params_json_schema': _LIST_COHORT_DATASETS_SCHEMA,
            },
        )

    def tool_handlers(self) -> Mapping[str, Any]:
        return {
            'apply_patch': _apply_patch_handler,
            'list_node_types': _list_node_types_handler,
            'list_provider_connections': _list_provider_connections_handler,
            'list_action_templates': _list_action_templates_handler,
            'list_wati_templates': _list_wati_templates_handler,
            'list_cohort_datasets': _list_cohort_datasets_handler,
        }

    def validate_arguments(self, tool_name: str, args: Mapping[str, Any]) -> None:
        return None

    def describe_tools(self, app_id: str) -> Mapping[str, str]:
        # `app_id` is reserved for per-app vocabulary substitution; the
        # authoring tool surface doesn't depend on it today.
        del app_id
        return {
            'apply_patch': (
                'Propose canvas edits as one CanvasPatch. The user reviews '
                'and saves manually — never claim work is saved or live.'
            ),
            'list_node_types': (
                'List node types available for this builder, optionally '
                'filtered by category.'
            ),
            'list_provider_connections': (
                'List provider connections (id, name, provider). UUIDs are '
                'added to the per-turn allowlist for apply_patch.'
            ),
            'list_action_templates': (
                'List action templates by channel.'
            ),
            'list_wati_templates': (
                'List WATI message templates registered against a connection.'
            ),
            'list_cohort_datasets': (
                'List cohort datasets in this app and their latest version IDs.'
            ),
        }

    def build_outcome(self, tool_name: str, raw_result: Any) -> Outcome:
        """v2 chat-engine egress hook with credential filter (Decision §R5).

        v3 routes the SpecialistResult JSON through the supervisor's
        custom_output_extractor and never calls this; the inline filters
        in `_apply_patch_handler` / `_lookup_result_json` are the
        load-bearing egress points today. We still wire the filter here
        so that any future harness path that goes through
        `CapabilityPack.build_outcome` cannot regress R5.
        """
        payload = dict(raw_result) if isinstance(raw_result, dict) else {}
        leaked = contains_credential_fields(payload)
        if leaked is not None:
            authoring_logger.warning(
                'build_outcome egress filter blocked tool=%s field=%s',
                tool_name, leaked,
            )
            envelope = build_envelope(
                status='error',
                summary=f'{tool_name}: credential field {leaked} blocked',
                kind='error',
                capability=PACK_ID,
                reason_code='CREDENTIAL_LEAK_BLOCKED',
                payload={},
            )
            return envelope.outcome.model_dump()  # type: ignore[return-value]
        envelope = build_envelope(
            status='ok',
            summary=f'{tool_name} ok',
            kind='artifact',
            capability=PACK_ID,
            payload=payload,
        )
        return envelope.outcome.model_dump()  # type: ignore[return-value]

    def describe_job(self, job: Any) -> str:
        from app.services.chat_engine.capability_pack import render_job_line
        return render_job_line(job)


# Register the pack on import; the boot validator discovers this via
# the `*_pack.py` glob in `capability_pack._discover_pack_modules`.
register_pack(OrchestrationAuthoringPack())


def node_type_enum() -> list[str]:
    """Public accessor — used by the specialist when bolting the enum
    onto the tool schema."""
    return _node_type_enum()


__all__ = [
    'OrchestrationAuthoringPack',
    'PACK_ID',
    'REASON_CODES',
    'MAX_PATCH_OPS',
    'node_type_enum',
]
