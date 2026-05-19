"""Backend contract-boundary tests for Sherlock v3 chart payload egress.

The data_specialist must only emit ``analytics.chart.v1`` artifacts that pass
``CHART_PAYLOAD_ADAPTER.validate_python``. These tests pin the contract for
chart / kpi / summary / table / empty payloads, the spec/data field guard,
and the chart-payload adapter idempotency that ``runtime_store.list_sherlock_parts`` relies on.
"""
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from app.services.chat_engine.vega_lite_emitter import (
    SpecDataMismatchError,
    assert_spec_fields_exist_in_rows,
)
from app.services.report_builder.chart_contract import CHART_PAYLOAD_ADAPTER
from app.services.sherlock_v3.data_specialist import (
    _build_artifact_list,
    build_chart_payload_from_rows,
)


_BASE_KW: dict[str, Any] = {
    'question': 'how many runs per agent',
    'sql_used': 'SELECT 1',
    'chart_title': 'Runs per agent',
    'app_id': 'voice-rx',
}


# ─────────────────────── 1. Chart happy-path ───────────────────────


class ChartPayloadValidatesTests(unittest.TestCase):
    def test_category_count_chart_is_valid(self) -> None:
        rows = [
            {'agent': 'A1', 'run_count': 10},
            {'agent': 'A2', 'run_count': 7},
            {'agent': 'A3', 'run_count': 3},
        ]
        output_columns = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]
        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0]['kind'], 'chart')
        payload = artifacts[0]['payload']
        # Round-trip the contract — raises if invalid.
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        self.assertEqual(payload['data'], rows)
        # Fields the spec references must exist in the rows.
        assert_spec_fields_exist_in_rows(payload['spec'], payload['data'])


# ─────────────────────── 2-4. Fallback shapes ───────────────────────


class KpiFallbackTests(unittest.TestCase):
    def test_kpi_fallback_validates(self) -> None:
        rows = [{'count': 42}]
        output_columns = [
            {
                'alias': 'count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            }
        ]
        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        self.assertEqual(artifacts[0]['kind'], 'kpi')
        payload = artifacts[0]['payload']
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        self.assertEqual(payload['kpi']['format'], 'integer')
        self.assertEqual(payload['kpi']['value'], 42)
        self.assertEqual(payload['kpi']['label'], 'count')

    def test_kpi_format_mapping(self) -> None:
        cases = [
            ('count', 1, 'integer'),
            ('currency', 12.5, 'currency'),
            ('percent', 0.42, 'percent'),
            ('duration', 300, 'duration_ms'),
            (None, 7, 'integer'),  # whole number, no semantic type
            (None, 7.5, 'decimal'),  # non-whole number, no semantic type
        ]
        for semantic_type, value, expected_format in cases:
            with self.subTest(semantic_type=semantic_type, value=value):
                hint: dict[str, Any] = {
                    'alias': 'metric',
                    'role_hint': 'measure',
                    'type_hint': 'quantitative',
                }
                if semantic_type is not None:
                    hint['semantic_type_hint'] = semantic_type
                artifacts = _build_artifact_list(
                    rows=[{'metric': value}],
                    output_columns=[hint],
                    **_BASE_KW,
                )
                payload = artifacts[0]['payload']
                self.assertEqual(payload['kind'], 'kpi')
                self.assertEqual(payload['kpi']['format'], expected_format)
                CHART_PAYLOAD_ADAPTER.validate_python(payload)


class SummaryFallbackTests(unittest.TestCase):
    def test_summary_fallback_validates(self) -> None:
        # 1 row, multiple columns -> CG_FIELD_CARD -> summary fallback.
        rows = [{'agent_name': 'Alice', 'run_count': 12}]
        output_columns = [
            {'alias': 'agent_name', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]
        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        self.assertEqual(artifacts[0]['kind'], 'summary')
        payload = artifacts[0]['payload']
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        # Every field has the contract-required keys.
        for field in payload['summary']['fields']:
            for key in ('name', 'label', 'role', 'value'):
                self.assertIn(key, field)
            self.assertIn('semantic_type', field)


class TableFallbackTests(unittest.TestCase):
    def test_table_fallback_uses_name_not_key(self) -> None:
        # No measures -> CG_NO_MEASURE -> table fallback.
        rows = [
            {'session_id': 'sess-a'},
            {'session_id': 'sess-b'},
        ]
        output_columns = [
            {'alias': 'session_id', 'role_hint': 'identifier', 'type_hint': 'nominal'},
        ]
        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        self.assertEqual(artifacts[0]['kind'], 'table')
        payload = artifacts[0]['payload']
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        for column in payload['columns']:
            self.assertIn('name', column)
            self.assertNotIn('key', column)
            self.assertIn('label', column)
            self.assertIn('role', column)


# ─────────────────────── 5. Validation failure -> table fallback ───────────────────────


class InvalidPayloadFallbackTests(unittest.TestCase):
    def test_validation_failure_yields_valid_table(self) -> None:
        rows = [
            {'agent': 'A1', 'run_count': 10},
            {'agent': 'A2', 'run_count': 7},
        ]
        output_columns = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]

        # Force the inner builder to return an invalid shape so we can prove
        # the egress validator catches it and rewrites it to a valid table.
        broken: dict[str, Any] = {
            'kind': 'chart',
            # Missing required ``spec`` and ``data`` -> contract validation fails.
            'title': 'broken',
        }
        with patch(
            'app.services.sherlock_v3.data_specialist.build_chart_payload_from_rows',
            return_value=broken,
        ):
            artifacts = _build_artifact_list(
                rows=rows,
                output_columns=output_columns,
                **_BASE_KW,
            )

        self.assertEqual(artifacts[0]['kind'], 'table')
        payload = artifacts[0]['payload']
        # Re-validate to prove the fallback is contract-conformant.
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        self.assertEqual(payload['reason_code'], 'CG_EMIT_FAILED')


# ─────────────────────── 6. Spec-vs-data guard ───────────────────────


class SpecDataGuardTests(unittest.TestCase):
    def test_missing_encoding_field_raises(self) -> None:
        spec = {
            '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
            'mark': 'bar',
            'encoding': {
                'x': {'field': 'agent', 'type': 'nominal'},
                'y': {'field': 'count', 'type': 'quantitative'},
            },
        }
        rows = [{'agent': 'A1', 'value': 10}]  # ``count`` missing
        with self.assertRaises(SpecDataMismatchError):
            assert_spec_fields_exist_in_rows(spec, rows)

    def test_fold_field_missing_in_rows_raises(self) -> None:
        spec = {
            'mark': 'line',
            'transform': [{'fold': ['pass_count', 'fail_count'], 'as': ['measure', 'value']}],
            'encoding': {
                'x': {'field': 'day', 'type': 'temporal'},
                'y': {'field': 'value', 'type': 'quantitative'},
                'color': {'field': 'measure', 'type': 'nominal'},
            },
        }
        # ``fail_count`` is referenced by the fold but not present in rows.
        rows = [{'day': '2026-05-01', 'pass_count': 3}]
        with self.assertRaises(SpecDataMismatchError):
            assert_spec_fields_exist_in_rows(spec, rows)

    def test_fold_synthetic_fields_are_ignored(self) -> None:
        # ``measure`` and ``value`` are produced by the fold; they should not
        # need to exist in the rows for the guard to pass.
        spec = {
            'mark': 'line',
            'transform': [{'fold': ['pass_count'], 'as': ['measure', 'value']}],
            'encoding': {
                'x': {'field': 'day', 'type': 'temporal'},
                'y': {'field': 'value', 'type': 'quantitative'},
                'color': {'field': 'measure', 'type': 'nominal'},
            },
        }
        rows = [{'day': '2026-05-01', 'pass_count': 3}]
        # Should not raise.
        assert_spec_fields_exist_in_rows(spec, rows)

    def test_field_mismatch_via_artifact_list_becomes_table(self) -> None:
        rows = [
            {'agent': 'A1', 'run_count': 10},
            {'agent': 'A2', 'run_count': 7},
        ]
        output_columns = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]

        def _bad_emit(_rs: Any, _picked: Any) -> dict[str, Any]:
            return {
                'spec': {
                    '$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
                    'mark': 'bar',
                    'encoding': {
                        'x': {'field': 'agent', 'type': 'nominal'},
                        'y': {'field': 'never_in_rows', 'type': 'quantitative'},
                    },
                },
                'data': [{'agent': 'A1', 'run_count': 10}],
            }

        with patch(
            'app.services.chat_engine.vega_lite_emitter.emit',
            side_effect=_bad_emit,
        ):
            artifacts = _build_artifact_list(
                rows=rows,
                output_columns=output_columns,
                **_BASE_KW,
            )
        self.assertEqual(artifacts[0]['kind'], 'table')
        payload = artifacts[0]['payload']
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        self.assertEqual(payload['reason_code'], 'CG_EMIT_FAILED')


# ─────────────────────── 7. Real top-N sort ───────────────────────


class HighCardTopNSortsByMeasureTests(unittest.TestCase):
    def test_high_card_chart_sorts_by_measure_before_truncation(self) -> None:
        # 60 distinct dimension values forces CG_HIGH_CARD; counts ascend by
        # row index so a naive head-of-list slice would keep the *smallest*
        # 25 rows. A real top-N keeps the *largest* 25.
        rows = [{'agent': f'A{i:03d}', 'run_count': i} for i in range(60)]
        output_columns = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]
        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        self.assertEqual(artifacts[0]['kind'], 'chart')
        payload = artifacts[0]['payload']
        CHART_PAYLOAD_ADAPTER.validate_python(payload)
        self.assertEqual(payload['reason_code'], 'CG_HIGH_CARD')
        self.assertEqual(len(payload['data']), 25)
        # The largest measures must be present; the smallest must be gone.
        run_counts = [row['run_count'] for row in payload['data']]
        self.assertEqual(max(run_counts), 59)
        self.assertEqual(min(run_counts), 35)
        # And the data is actually sorted desc.
        self.assertEqual(run_counts, sorted(run_counts, reverse=True))


# ─────────────────────── 8. Typer derives from row keys ───────────────────────


class ResultSetTyperRowKeyDerivationTests(unittest.TestCase):
    def test_columns_come_from_actual_row_keys_and_ignore_unknown_aliases(
        self,
    ) -> None:
        from app.services.chat_engine.result_set_typer import type_result_set

        # Real rows have ``agent`` + ``run_count``. The hint list adds an
        # extra alias ``not_in_result`` that does not appear in the rows; the
        # typer must drop it.
        rows = [{'agent': 'A1', 'run_count': 10}]
        declared = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
            {
                'alias': 'not_in_result',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
            },
        ]
        rs = type_result_set(rows, declared_columns=declared, manifest=None)
        names = [c.name for c in rs.columns]
        self.assertEqual(names, ['agent', 'run_count'])

    def test_columns_use_real_row_keys_even_when_hints_alias_differs(
        self,
    ) -> None:
        from app.services.chat_engine.result_set_typer import type_result_set

        rows = [{'agent': 'A1', 'run_count': 10}]
        # Hint alias does not match either real row key — it is advisory and
        # must not graft itself onto the typed columns.
        declared = [
            {'alias': 'completely_different', 'role_hint': 'measure', 'type_hint': 'quantitative'},
        ]
        rs = type_result_set(rows, declared_columns=declared, manifest=None)
        self.assertEqual([c.name for c in rs.columns], ['agent', 'run_count'])


# ─────────────────────── 9. Live-vs-replay parity ───────────────────────


class LiveVsReplayParityTests(unittest.TestCase):
    """Live payload → CHART_PAYLOAD_ADAPTER round-trip — guards Part-stream egress shape."""

    def test_live_payload_survives_replay_validation(self) -> None:
        rows = [
            {'agent': 'A1', 'run_count': 10},
            {'agent': 'A2', 'run_count': 7},
            {'agent': 'A3', 'run_count': 3},
        ]
        output_columns = [
            {'alias': 'agent', 'role_hint': 'dimension', 'type_hint': 'nominal'},
            {
                'alias': 'run_count',
                'role_hint': 'measure',
                'type_hint': 'quantitative',
                'semantic_type_hint': 'count',
            },
        ]
        live_payload = build_chart_payload_from_rows(
            rows=rows,
            output_columns=output_columns,
            **_BASE_KW,
        )
        # Live egress validation:
        live_validated = CHART_PAYLOAD_ADAPTER.validate_python(live_payload)
        # Replay re-validation (same adapter call as runtime_store does):
        replay_validated = CHART_PAYLOAD_ADAPTER.validate_python(live_payload)
        # The validated objects round-trip to the same dict — no field has
        # been silently dropped or renamed between the two calls.
        self.assertEqual(
            live_validated.model_dump(),
            replay_validated.model_dump(),
        )


if __name__ == '__main__':
    unittest.main()
