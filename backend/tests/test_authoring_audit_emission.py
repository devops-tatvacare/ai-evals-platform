"""Phase 3 Step 2 — every authoring tool invocation emits exactly ONE
`sherlock_v3.authoring` log line, with the R10 schema fully populated.

The tests exercise both the apply_patch handler (covering the full
reason_code surface) and one lookup handler so the wiring stays uniform.
The fixtures mirror `test_authoring_apply_patch_handler.py`'s
SimpleNamespace-based ctx so we never need a live SDK or DB.
"""
from __future__ import annotations

import json
import logging
import unittest
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from app.services.orchestration_authoring.audit import authoring_logger
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.orchestration_authoring.orchestration_authoring_pack import (
    MAX_PATCH_OPS,
    _apply_patch_handler,
    _list_node_types_handler,
)


_REQUIRED_FIELDS = {
    'event',
    'tool',
    'app_id',
    'tenant_id',
    'user_id',
    'workflow_id',
    'patch_op_count',
    'validation_result',
    'permission_denied',
    'duration_ms',
}


class _Capturing(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def _make_auth(*, has_perm: bool = True, app: str = 'inside-sales') -> SimpleNamespace:
    return SimpleNamespace(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=frozenset({'orchestration:manage'}) if has_perm else frozenset(),
        app_access=frozenset({app}),
        is_owner=False,
    )


_VALID_DEFINITION = {
    'nodes': [
        {
            'id': 'src',
            'type': 'source.event_trigger',
            'position': {'x': 0, 'y': 0},
            'data': {},
            'config': {'event_name': 'demo'},
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
        {'id': 'e1', 'source': 'src', 'target': 'sink', 'output_id': 'default'},
    ],
}


def _make_snapshot(app: str = 'inside-sales') -> BuilderSnapshot:
    return BuilderSnapshot(
        workflow_id=uuid.uuid4(),
        version_id=None,
        workflow_type='crm',
        app_id=app,
        definition=dict(_VALID_DEFINITION),
        data_hash='hash-1',
        selected_node_id=None,
        view_mode='edit',
    )


def _make_ctx(*, builder: Any = None, auth: Any = None) -> SimpleNamespace:
    return SimpleNamespace(
        context=SimpleNamespace(
            builder_context=builder,
            auth=auth,
            scratch={},
        ),
    )


def _wrap(*, ops_json: str, rationale: str = 'test') -> str:
    return json.dumps({'ops_json': ops_json, 'rationale': rationale})


def _payloads(handler: _Capturing) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for record in handler.records:
        candidate = record.args
        if isinstance(candidate, dict) and candidate.get('event') == 'authoring_tool_call':
            out.append(candidate)
    return out


class AuditEmissionShapeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.handler = _Capturing()
        authoring_logger.addHandler(self.handler)
        self._prev_level = authoring_logger.level
        authoring_logger.setLevel(logging.DEBUG)

    def tearDown(self) -> None:
        authoring_logger.removeHandler(self.handler)
        authoring_logger.setLevel(self._prev_level)

    def _assert_one_full_record(self, *, tool: str) -> dict[str, Any]:
        emitted = _payloads(self.handler)
        self.assertEqual(
            len(emitted), 1, f'expected exactly one audit line for {tool}, got {len(emitted)}',
        )
        payload = emitted[0]
        missing = _REQUIRED_FIELDS - set(payload.keys())
        self.assertFalse(missing, f'audit line missing fields: {missing}')
        self.assertEqual(payload['tool'], tool)
        self.assertIsInstance(payload['duration_ms'], int)
        self.assertIsInstance(payload['patch_op_count'], int)
        self.assertIsInstance(payload['permission_denied'], bool)
        return payload

    async def test_no_builder_context_emits_permission_denied(self) -> None:
        await _apply_patch_handler(
            _make_ctx(builder=None, auth=_make_auth()),
            _wrap(ops_json='[]'),
        )
        payload = self._assert_one_full_record(tool='apply_patch')
        self.assertTrue(payload['permission_denied'])
        # validation_result stays 'ok' for permission-class failures.
        self.assertEqual(payload['validation_result'], 'ok')
        self.assertEqual(payload['workflow_id'], '')

    async def test_permission_denied_sets_flag(self) -> None:
        await _apply_patch_handler(
            _make_ctx(builder=_make_snapshot(), auth=_make_auth(has_perm=False)),
            _wrap(ops_json='[]'),
        )
        payload = self._assert_one_full_record(tool='apply_patch')
        self.assertTrue(payload['permission_denied'])

    async def test_node_config_invalid_validation_result(self) -> None:
        # Empty add_node config trips the per-node Pydantic validator.
        ops = json.dumps([{
            'op': 'add_node',
            'node_id': 'n1',
            'payload': {'node_type': 'crm.send_wati', 'config': {'foo': 'bar'}},
        }])
        await _apply_patch_handler(
            _make_ctx(builder=_make_snapshot(), auth=_make_auth()),
            _wrap(ops_json=ops),
        )
        payload = self._assert_one_full_record(tool='apply_patch')
        self.assertFalse(payload['permission_denied'])
        self.assertEqual(payload['validation_result'], 'node_config_invalid')

    async def test_patch_too_large_validation_result(self) -> None:
        big_ops = json.dumps([
            {'op': 'remove_node', 'node_id': f'n{i}', 'payload': {}}
            for i in range(MAX_PATCH_OPS + 1)
        ])
        await _apply_patch_handler(
            _make_ctx(builder=_make_snapshot(), auth=_make_auth()),
            _wrap(ops_json=big_ops),
        )
        payload = self._assert_one_full_record(tool='apply_patch')
        self.assertEqual(payload['validation_result'], 'node_config_invalid')
        self.assertEqual(payload['patch_op_count'], MAX_PATCH_OPS + 1)

    async def test_happy_path_audit_records_op_count_and_ok(self) -> None:
        ops = json.dumps([{
            'op': 'update_node_config',
            'node_id': 'sink',
            'payload': {'config_patch': {'reason': 'demo done'}},
        }])
        await _apply_patch_handler(
            _make_ctx(builder=_make_snapshot(), auth=_make_auth()),
            _wrap(ops_json=ops, rationale='cleanup'),
        )
        payload = self._assert_one_full_record(tool='apply_patch')
        self.assertEqual(payload['validation_result'], 'ok')
        self.assertFalse(payload['permission_denied'])
        self.assertEqual(payload['patch_op_count'], 1)

    async def test_lookup_handler_emits_one_line(self) -> None:
        # list_node_types reads NODE_REGISTRY only — no DB session.
        await _list_node_types_handler(
            _make_ctx(builder=_make_snapshot(), auth=_make_auth()),
            json.dumps({}),
        )
        payload = self._assert_one_full_record(tool='list_node_types')
        self.assertEqual(payload['validation_result'], 'ok')
        self.assertEqual(payload['patch_op_count'], 0)
        self.assertFalse(payload['permission_denied'])

    async def test_audit_fires_even_on_unexpected_exception(self) -> None:
        # Force a crash in the hot path by patching a downstream parser.
        # The `try/finally` in the handler must still emit the audit line
        # so the security trail isn't dropped on bugs.
        target = (
            'app.services.orchestration_authoring.'
            'orchestration_authoring_pack._validate_op_shape'
        )
        with patch(target, side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                await _apply_patch_handler(
                    _make_ctx(builder=_make_snapshot(), auth=_make_auth()),
                    _wrap(ops_json=json.dumps([{
                        'op': 'remove_node', 'node_id': 'src', 'payload': {},
                    }])),
                )
        # finally-emit ensures one audit line landed despite the crash.
        emitted = _payloads(self.handler)
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]['tool'], 'apply_patch')


if __name__ == '__main__':
    unittest.main()
