"""Phase 1 Step 2 — apply_patch handler reason-code coverage.

Each test triggers exactly one reason_code from the Step 2 surface:
NODE_CONFIG_INVALID, UNKNOWN_NODE_TYPE, PATCH_OPS_EMPTY, PATCH_TOO_LARGE.
Layered checks (NO_BUILDER_CONTEXT, PERMISSION_DENIED, APP_FORBIDDEN,
CREDENTIAL_LEAK_BLOCKED) are also covered here so the per-tool re-check
(R3) can never silently regress.
"""
from __future__ import annotations

import json
import unittest
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.orchestration_authoring.canvas_patch import (
    CANVAS_PATCH_CONTRACT_ID,
)
from app.services.orchestration_authoring.orchestration_authoring_pack import (
    MAX_PATCH_OPS,
    _apply_patch_handler,
)


def _make_auth(*, has_perm: bool = True, app: str = 'inside-sales') -> SimpleNamespace:
    return SimpleNamespace(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=frozenset({'orchestration:manage'}) if has_perm else frozenset(),
        app_access=frozenset({app}),
        is_owner=False,
    )


_VALID_MINIMAL_DEFINITION = {
    'nodes': [
        {
            'id': 'src',
            'type': 'source.event_trigger',
            'position': {'x': 0, 'y': 0},
            'data': {},
            'config': {},
        },
        {
            'id': 'sink',
            'type': 'sink.complete',
            'position': {'x': 200, 'y': 0},
            'data': {},
            'config': {},
        },
    ],
    'edges': [
        {
            'id': 'e1',
            'source': 'src',
            'target': 'sink',
            'output_id': 'default',
        },
    ],
}


def _make_snapshot(*, app: str = 'inside-sales',
                    definition: dict | None = None,
                    view_mode: str = 'edit') -> BuilderSnapshot:
    return BuilderSnapshot(
        workflow_id=uuid.uuid4(),
        version_id=None,
        workflow_type='crm',
        app_id=app,
        definition=definition if definition is not None else dict(_VALID_MINIMAL_DEFINITION),
        data_hash='hash-1',
        selected_node_id=None,
        view_mode=view_mode,
    )


def _make_ctx(*, builder: Any = None, auth: Any = None) -> SimpleNamespace:
    return SimpleNamespace(
        context=SimpleNamespace(
            builder_context=builder,
            auth=auth,
            scratch={},
        ),
    )


def _ops(*ops: dict[str, Any]) -> str:
    return json.dumps(list(ops))


def _wrap(*, ops_json: str, rationale: str = 'test') -> str:
    return json.dumps({'ops_json': ops_json, 'rationale': rationale})


async def _call_owned(ctx: SimpleNamespace, args: str) -> dict:
    app_id = ctx.context.builder_context.app_id
    with patch(
        'app.services.orchestration_authoring.orchestration_authoring_pack.'
        '_assert_builder_workflow_still_owned',
        new=AsyncMock(return_value=app_id),
    ):
        return json.loads(await _apply_patch_handler(ctx, args))


class ApplyPatchReasonCodeTests(unittest.IsolatedAsyncioTestCase):
    async def _call(self, *, args: str, builder: Any = None, auth: Any = None) -> dict:
        b = builder or _make_snapshot()
        a = auth or _make_auth()
        return await _call_owned(_make_ctx(builder=b, auth=a), args)

    async def test_no_builder_context(self) -> None:
        result = await _apply_patch_handler(
            _make_ctx(builder=None, auth=_make_auth()),
            _wrap(ops_json='[]'),
        )
        decoded = json.loads(result)
        self.assertEqual(decoded['status'], 'error')
        self.assertEqual(decoded['meta']['reason_code'], 'NO_BUILDER_CONTEXT')

    async def test_permission_denied(self) -> None:
        decoded = await self._call(
            args=_wrap(ops_json='[]'),
            auth=_make_auth(has_perm=False),
        )
        self.assertEqual(decoded['meta']['reason_code'], 'PERMISSION_DENIED')

    async def test_app_forbidden(self) -> None:
        # auth gives access to a different app than the snapshot
        auth = _make_auth(app='voice-rx')
        decoded = await self._call(
            args=_wrap(ops_json='[]'),
            builder=_make_snapshot(app='inside-sales'),
            auth=auth,
        )
        self.assertEqual(decoded['meta']['reason_code'], 'APP_FORBIDDEN')

    async def test_view_mode_is_read_only(self) -> None:
        decoded = await self._call(
            args=_wrap(ops_json='[]'),
            builder=_make_snapshot(view_mode='view'),
        )
        self.assertEqual(decoded['meta']['reason_code'], 'PERMISSION_DENIED')
        self.assertIn('read-only', decoded['summary'])

    async def test_patch_ops_empty_when_blank(self) -> None:
        decoded = await self._call(args=_wrap(ops_json=''))
        self.assertEqual(decoded['meta']['reason_code'], 'PATCH_OPS_EMPTY')

    async def test_patch_ops_empty_when_array_empty(self) -> None:
        decoded = await self._call(args=_wrap(ops_json='[]'))
        self.assertEqual(decoded['meta']['reason_code'], 'PATCH_OPS_EMPTY')

    async def test_patch_too_large(self) -> None:
        big = [
            {'op': 'remove_node', 'node_id': f'n{i}', 'payload': {}}
            for i in range(MAX_PATCH_OPS + 1)
        ]
        decoded = await self._call(args=_wrap(ops_json=_ops(*big)))
        self.assertEqual(decoded['meta']['reason_code'], 'PATCH_TOO_LARGE')

    async def test_unknown_node_type(self) -> None:
        ops = _ops({
            'op': 'add_node',
            'node_id': 'n1',
            'payload': {'node_type': 'made.up.node', 'config': {}},
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['meta']['reason_code'], 'UNKNOWN_NODE_TYPE')

    async def test_node_config_invalid_when_config_is_not_object(self) -> None:
        ops = _ops({
            'op': 'add_node',
            'node_id': 'n1',
            'payload': {'node_type': 'core.webhook_out', 'config': 'not an object'},
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['meta']['reason_code'], 'NODE_CONFIG_INVALID')

    async def test_incomplete_draft_node_is_allowed(self) -> None:
        ops = _ops({
            'op': 'add_node',
            'node_id': 'wh1',
            'payload': {'node_type': 'core.webhook_out', 'config': {}},
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['status'], 'ok', msg=decoded)
        artifact = decoded['artifacts'][0]
        self.assertEqual(artifact['kind'], CANVAS_PATCH_CONTRACT_ID)
        self.assertEqual(artifact['payload']['ops'][0]['node_id'], 'wh1')

    async def test_can_build_draft_canvas_from_empty_registry_nodes(self) -> None:
        ops = _ops(
            {
                'op': 'add_node',
                'node_id': 'src',
                'payload': {'node_type': 'source.event_trigger', 'config': {}},
            },
            {
                'op': 'add_node',
                'node_id': 'wh1',
                'payload': {'node_type': 'core.webhook_out', 'config': {}},
            },
            {
                'op': 'add_node',
                'node_id': 'done',
                'payload': {'node_type': 'sink.complete', 'config': {}},
            },
            {
                'op': 'connect',
                'node_id': 'src',
                'payload': {
                    'source_node_id': 'src',
                    'output_id': 'default',
                    'target_node_id': 'wh1',
                    'edge_id': 'e-src-wh1',
                },
            },
            {
                'op': 'connect',
                'node_id': 'wh1',
                'payload': {
                    'source_node_id': 'wh1',
                    'output_id': 'success',
                    'target_node_id': 'done',
                    'edge_id': 'e-wh1-done',
                },
            },
        )
        decoded = await self._call(
            args=_wrap(ops_json=ops),
            builder=_make_snapshot(definition={'nodes': [], 'edges': []}),
        )
        self.assertEqual(decoded['status'], 'ok', msg=decoded)
        self.assertEqual(len(decoded['artifacts'][0]['payload']['ops']), 5)

    async def test_node_config_invalid_when_ops_json_malformed(self) -> None:
        decoded = await self._call(
            args=_wrap(ops_json='{not valid json'),
        )
        self.assertEqual(decoded['meta']['reason_code'], 'NODE_CONFIG_INVALID')

    async def test_apply_patch_happy_path_emits_artifact(self) -> None:
        # Update the existing sink node's config patch — graph preflight
        # passes because the resulting graph is still a valid src→sink chain.
        ops = _ops({
            'op': 'update_node_config',
            'node_id': 'sink',
            'payload': {'config_patch': {'reason': 'demo done'}},
        })
        decoded = await self._call(args=_wrap(ops_json=ops, rationale='clean up'))
        self.assertEqual(decoded['status'], 'ok', msg=decoded)
        self.assertEqual(len(decoded['artifacts']), 1)
        artifact = decoded['artifacts'][0]
        self.assertEqual(artifact['kind'], CANVAS_PATCH_CONTRACT_ID)
        self.assertEqual(len(artifact['payload']['ops']), 1)
        self.assertEqual(artifact['payload']['rationale'], 'clean up')

    async def test_connect_op_validates_required_fields(self) -> None:
        ops = _ops({
            'op': 'connect',
            'node_id': 'n1',
            'payload': {
                'source_node_id': 'n1',
                'output_id': 'default',
                'target_node_id': 'n2',
                # missing edge_id
            },
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['meta']['reason_code'], 'NODE_CONFIG_INVALID')


class ApplyPatchToolSpecTests(unittest.TestCase):
    def test_apply_patch_spec_has_strict_schema(self) -> None:
        from app.services.orchestration_authoring.orchestration_authoring_pack import (
            OrchestrationAuthoringPack,
        )

        pack = OrchestrationAuthoringPack()
        specs = {s['name']: s for s in pack.tool_specs()}
        self.assertIn('apply_patch', specs)
        schema = specs['apply_patch']['params_json_schema']
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(set(schema['required']), {'ops_json', 'rationale'})


class ClassifyReasonCodeTests(unittest.TestCase):
    """The pack's reason-code classifier must inspect only the structured
    ``field`` value — never error-message text — so validator wording
    changes don't silently demote codes."""

    def _classify(self, errors: list[dict]) -> str:
        from app.services.orchestration_authoring.orchestration_authoring_pack import (
            _classify_reason_code,
        )
        return _classify_reason_code(errors)

    def test_field_type_wins_over_config_and_graph(self) -> None:
        result = self._classify([
            {'node_id': 'a', 'field': 'edges', 'message': 'cycle'},
            {'node_id': 'b', 'field': 'config', 'message': 'extra'},
            {'node_id': 'c', 'field': 'type', 'message': 'unknown node type x'},
        ])
        self.assertEqual(result, 'UNKNOWN_NODE_TYPE')

    def test_config_wins_over_graph(self) -> None:
        result = self._classify([
            {'node_id': 'a', 'field': 'edges', 'message': 'cycle'},
            {'node_id': 'b', 'field': 'config.foo', 'message': 'extra'},
        ])
        self.assertEqual(result, 'NODE_CONFIG_INVALID')

    def test_graph_default(self) -> None:
        result = self._classify([
            {'node_id': 'a', 'field': 'edges.e1.target', 'message': 'missing'},
        ])
        self.assertEqual(result, 'GRAPH_INVALID')

    def test_field_type_priority_independent_of_message_wording(self) -> None:
        # Plan invariant: classifier must not depend on validator's
        # message text. Even with a non-standard message, field='type'
        # still wins.
        result = self._classify([
            {'node_id': 'a', 'field': 'type', 'message': 'totally different text'},
        ])
        self.assertEqual(result, 'UNKNOWN_NODE_TYPE')


class ApplyPatchCanonicalValidationTests(unittest.IsolatedAsyncioTestCase):
    """Section 2 — apply_patch routes every candidate through
    validate_definition(..., mode='draft'). These cases assert the bypassed
    paths (update_node_config on existing nodes, ops on missing nodes) are
    rejected with the right reason code."""

    async def _call(self, *, args: str) -> dict:
        return await _call_owned(_make_ctx(builder=_make_snapshot(), auth=_make_auth()), args)

    async def test_update_node_config_after_merge_rejects_fabricated_field(self) -> None:
        good_uuid = '11111111-1111-1111-1111-111111111111'
        ops = _ops(
            {
                'op': 'add_node',
                'node_id': 'wh1',
                'payload': {
                    'node_type': 'core.webhook_out',
                    'config': {'connection_id': good_uuid, 'url': 'https://x/y'},
                },
            },
            {
                'op': 'update_node_config',
                'node_id': 'wh1',
                'payload': {'config_patch': {'fabricated_key': 'oops'}},
            },
        )
        ctx = SimpleNamespace(
            context=SimpleNamespace(
                builder_context=_make_snapshot(),
                auth=_make_auth(),
                scratch={'authorized_uuids': {good_uuid}},
            ),
        )
        decoded = await _call_owned(ctx, _wrap(ops_json=ops))
        self.assertEqual(decoded['status'], 'error', msg=decoded)
        self.assertEqual(decoded['meta']['reason_code'], 'NODE_CONFIG_INVALID')

    async def test_update_node_config_on_missing_node_rejects_graph_invalid(self) -> None:
        ops = _ops({
            'op': 'update_node_config',
            'node_id': 'ghost',
            'payload': {'config_patch': {'reason': 'stale'}},
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['status'], 'error', msg=decoded)
        self.assertEqual(decoded['meta']['reason_code'], 'GRAPH_INVALID')

    async def test_remove_node_on_missing_node_rejects_graph_invalid(self) -> None:
        ops = _ops({'op': 'remove_node', 'node_id': 'ghost', 'payload': {}})
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['meta']['reason_code'], 'GRAPH_INVALID')

    async def test_add_node_with_fabricated_key_rejects_node_config_invalid(self) -> None:
        ops = _ops({
            'op': 'add_node',
            'node_id': 'sk2',
            'payload': {
                'node_type': 'sink.complete',
                'config': {'fabricated_key': 1},
            },
        })
        decoded = await self._call(args=_wrap(ops_json=ops))
        self.assertEqual(decoded['meta']['reason_code'], 'NODE_CONFIG_INVALID')


if __name__ == '__main__':
    unittest.main()
