"""Phase 3 Step 1 — audit logger unit tests.

Asserts the reason_code → validation_result mapping and the
permission_denied semantics defined in Decision §R10. The audit log line
itself is the security team's only durable trace, so the mapping needs
exhaustive coverage.
"""
from __future__ import annotations

import logging
import unittest

from app.services.orchestration_authoring.audit import (
    authoring_logger,
    emit_authoring_event,
    permission_denied_for,
    validation_result_for,
)


class ValidationResultMappingTests(unittest.TestCase):
    def test_none_or_ok_maps_to_ok(self) -> None:
        self.assertEqual(validation_result_for(None), 'ok')

    def test_config_class_codes_map_to_node_config_invalid(self) -> None:
        for code in (
            'NODE_CONFIG_INVALID',
            'UNKNOWN_NODE_TYPE',
            'PREDICATE_INVALID',
            'PATCH_OPS_EMPTY',
            'PATCH_TOO_LARGE',
        ):
            self.assertEqual(
                validation_result_for(code), 'node_config_invalid',
                msg=f'{code} should map to node_config_invalid',
            )

    def test_graph_class_codes_map_to_graph_invalid(self) -> None:
        for code in ('GRAPH_INVALID', 'BASE_HASH_MISMATCH'):
            self.assertEqual(validation_result_for(code), 'graph_invalid')

    def test_uuid_code_maps_to_uuid_not_authorized(self) -> None:
        self.assertEqual(
            validation_result_for('UUID_NOT_AUTHORIZED'), 'uuid_not_authorized',
        )

    def test_credential_leak_maps_distinctly(self) -> None:
        self.assertEqual(
            validation_result_for('CREDENTIAL_LEAK_BLOCKED'),
            'credential_leak_blocked',
        )

    def test_permission_class_codes_keep_validation_ok(self) -> None:
        # Permission-class failures never reached validation; the
        # `permission_denied` boolean carries the signal instead.
        for code in (
            'PERMISSION_DENIED',
            'APP_FORBIDDEN',
            'NO_BUILDER_CONTEXT',
            'WORKFLOW_NOT_FOUND',
        ):
            self.assertEqual(
                validation_result_for(code), 'ok',
                msg=f'{code} should leave validation_result=ok',
            )


class PermissionDeniedFlagTests(unittest.TestCase):
    def test_permission_class_codes_set_flag_true(self) -> None:
        for code in (
            'PERMISSION_DENIED',
            'APP_FORBIDDEN',
            'NO_BUILDER_CONTEXT',
            'WORKFLOW_NOT_FOUND',
        ):
            self.assertTrue(
                permission_denied_for(code),
                msg=f'{code} must set permission_denied=True',
            )

    def test_validation_codes_keep_flag_false(self) -> None:
        for code in (
            None,
            'NODE_CONFIG_INVALID',
            'GRAPH_INVALID',
            'UUID_NOT_AUTHORIZED',
            'CREDENTIAL_LEAK_BLOCKED',
            'PATCH_OPS_EMPTY',
        ):
            self.assertFalse(
                permission_denied_for(code),
                msg=f'{code} must keep permission_denied=False',
            )


class _CapturingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401
        self.records.append(record)


class EmitAuthoringEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self.handler = _CapturingHandler()
        authoring_logger.addHandler(self.handler)
        self._prev_level = authoring_logger.level
        authoring_logger.setLevel(logging.DEBUG)

    def tearDown(self) -> None:
        authoring_logger.removeHandler(self.handler)
        authoring_logger.setLevel(self._prev_level)

    def test_emits_one_record_with_full_schema(self) -> None:
        emit_authoring_event({
            'tool': 'apply_patch',
            'app_id': 'inside-sales',
            'tenant_id': 'tnt-1',
            'user_id': 'usr-1',
            'workflow_id': 'wf-1',
            'patch_op_count': 4,
            'validation_result': 'ok',
            'permission_denied': False,
            'duration_ms': 28,
        })
        self.assertEqual(len(self.handler.records), 1)
        record = self.handler.records[0]
        # When a single dict is passed as positional arg, logging stores
        # it directly on record.args (used for %-named substitution),
        # rather than wrapping in a tuple.
        payload = record.args
        assert isinstance(payload, dict)
        self.assertEqual(payload['event'], 'authoring_tool_call')
        self.assertEqual(payload['tool'], 'apply_patch')
        self.assertEqual(payload['validation_result'], 'ok')
        self.assertFalse(payload['permission_denied'])
        self.assertEqual(payload['patch_op_count'], 4)
        self.assertEqual(payload['duration_ms'], 28)

    def test_unknown_validation_result_is_coerced(self) -> None:
        emit_authoring_event({
            'tool': 'apply_patch',
            'app_id': 'inside-sales',
            'tenant_id': 't',
            'user_id': 'u',
            'workflow_id': 'w',
            'patch_op_count': 0,
            'validation_result': 'wat',
            'permission_denied': False,
            'duration_ms': 1,
        })
        # Coercion still emits one line with validation_result='ok'.
        emitted_payloads: list[dict[str, object]] = []
        for record in self.handler.records:
            candidate = record.args
            if isinstance(candidate, dict) and candidate.get('event') == 'authoring_tool_call':
                emitted_payloads.append(candidate)
        self.assertEqual(len(emitted_payloads), 1)
        self.assertEqual(emitted_payloads[0]['validation_result'], 'ok')


if __name__ == '__main__':
    unittest.main()
