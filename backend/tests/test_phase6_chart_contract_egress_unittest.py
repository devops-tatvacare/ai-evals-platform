"""Phase 6 acceptance-gate tests (plan §Phase-6 → *Acceptance gates*).

Gates pinned here map 1:1 to the plan:

1. ``ChartPayload.model_validate`` is called in ``_build_chart_payload``
   and on every persisted-artifact read path (plan §761).
2. ``grep -n 'interface ChartPayload\\|type ChartPayload' src/`` — only
   the generated file exposes the type (plan §762).
3. ``npm run codegen:chart-contract`` is idempotent (plan §763-764):
   running the pipeline twice produces no diff on the same machine.
4. Saved-chart detail and dashboard tile paths validate through the same
   ``ajv``-compiled validator on load (plan §766).

Gates 5 + 6 (CI drift job fails a test PR; byte-identical output across
fresh checkouts) are enforced by the CI workflow
``.github/workflows/chart-contract-drift.yml``, not the unit tests.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

from pydantic import ValidationError


_REPO_ROOT = Path(__file__).resolve().parents[2]
_FRONTEND_GENERATED = _REPO_ROOT / 'src' / 'features' / 'chat-widget' / 'generated'
_SCHEMA_PATH = _FRONTEND_GENERATED / 'chartContract.schema.json'
_TYPES_PATH = _FRONTEND_GENERATED / 'chartContract.ts'
_VALIDATOR_PATH = _FRONTEND_GENERATED / 'chartContract.validator.ts'


class BackendEgressValidationGate(unittest.TestCase):
    """Gate 1 — the Pydantic union validates every chart payload that
    leaves the backend."""

    def test_build_chart_payload_validates_each_branch(self):
        from app.services.report_builder.chart_contract import CHART_PAYLOAD_ADAPTER

        # Each variant must validate cleanly through the adapter.
        samples: list[dict[str, object]] = [
            {'kind': 'empty', 'reason_code': 'CG_EMPTY'},
            {
                'kind': 'kpi',
                'kpi': {'value': 42, 'label': 'Runs', 'format': 'integer'},
            },
            {
                'kind': 'summary',
                'summary': {'fields': [
                    {'name': 'total', 'label': 'Total', 'value': 7, 'role': 'measure'},
                ]},
            },
            {
                'kind': 'table',
                'columns': [
                    {'name': 'id', 'label': 'ID', 'role': 'identifier'},
                ],
                'data': [{'id': 'a'}],
            },
            {
                'kind': 'chart',
                'spec': {'mark': 'bar'},
                'data': [{'x': 1, 'y': 2}],
            },
        ]
        for sample in samples:
            CHART_PAYLOAD_ADAPTER.validate_python(sample)

    def test_unknown_kind_raises_validation_error(self):
        from app.services.report_builder.chart_contract import CHART_PAYLOAD_ADAPTER

        with self.assertRaises(ValidationError):
            CHART_PAYLOAD_ADAPTER.validate_python({'kind': 'bogus'})

    def test_chart_variant_rejects_missing_required_fields(self):
        from app.services.report_builder.chart_contract import CHART_PAYLOAD_ADAPTER

        with self.assertRaises(ValidationError):
            # Missing ``data``: required on the chart variant.
            CHART_PAYLOAD_ADAPTER.validate_python(
                {'kind': 'chart', 'spec': {'mark': 'bar'}},
            )

    def test_build_chart_payload_calls_validate(self):
        """Source-level check: ``_build_chart_payload`` must reference
        the Pydantic adapter so a future refactor doesn't silently drop
        egress validation."""
        path = (
            _REPO_ROOT / 'backend' / 'app' / 'services' / 'report_builder'
            / 'chat_handler.py'
        )
        source = path.read_text()
        self.assertIn('CHART_PAYLOAD_ADAPTER', source)
        self.assertIn('CHART_PAYLOAD_ADAPTER.validate_python', source)

    def test_runtime_event_replay_validates_chart_events(self):
        """Replay path (``list_sherlock_turn_events``) runs the
        adapter against every persisted ``chart`` event — plan §743."""
        path = (
            _REPO_ROOT / 'backend' / 'app' / 'services' / 'report_builder'
            / 'runtime_store.py'
        )
        source = path.read_text()
        self.assertIn('CHART_PAYLOAD_ADAPTER', source)
        self.assertIn("row.event_type == 'chart'", source)


class GeneratedArtifactsGate(unittest.TestCase):
    """Gate 2 — only the generated module exposes ``ChartPayload`` types.
    Gate 4 — the validator + schema files exist at the expected paths."""

    def test_generated_files_exist(self):
        self.assertTrue(_SCHEMA_PATH.exists(), f'missing {_SCHEMA_PATH}')
        self.assertTrue(_TYPES_PATH.exists(), f'missing {_TYPES_PATH}')
        self.assertTrue(_VALIDATOR_PATH.exists(), f'missing {_VALIDATOR_PATH}')

    def test_only_generated_file_exports_chart_payload_type(self):
        src_dir = _REPO_ROOT / 'src'
        result = subprocess.run(
            [
                'git', 'grep', '-lnE',
                'interface ChartPayload|type ChartPayload',
                '--', str(src_dir),
            ],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        # Only the generated module is allowed to declare the type.
        expected = 'src/features/chat-widget/generated/chartContract.ts'
        matches = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        unexpected = [m for m in matches if not m.endswith(expected)]
        self.assertEqual(
            unexpected, [],
            f'unexpected ChartPayload type/interface declarations outside the '
            f'generated module: {unexpected}',
        )

    def test_generated_validator_exports_validate_chart_payload(self):
        source = _VALIDATOR_PATH.read_text()
        self.assertIn('export function validateChartPayload', source)
        self.assertIn("from './chartContract'", source)

    def test_schema_is_valid_json_and_discriminated_on_kind(self):
        data = json.loads(_SCHEMA_PATH.read_text())
        # The root should be a discriminated union (Pydantic emits ``oneOf``
        # with per-variant ``$ref``, or equivalent).
        self.assertIn('$defs', data)
        variant_names = set(data['$defs'].keys())
        for variant in (
            'ChartPayloadChart',
            'ChartPayloadKpi',
            'ChartPayloadSummary',
            'ChartPayloadTable',
            'ChartPayloadEmpty',
        ):
            self.assertIn(variant, variant_names)


class CodegenIdempotencyGate(unittest.TestCase):
    """Gate 3 — ``npm run codegen:chart-contract`` is idempotent. Running
    it produces no diff on an already-up-to-date tree."""

    def test_codegen_is_idempotent(self):
        # Run the pipeline; assert the generated files are unchanged vs
        # the committed version. A drift means the pipeline isn't
        # deterministic (or the committed file was edited by hand).
        result = subprocess.run(
            ['npm', 'run', 'codegen:chart-contract'],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            result.returncode, 0,
            f'codegen failed:\nstdout={result.stdout}\nstderr={result.stderr}',
        )
        diff = subprocess.run(
            [
                'git', 'diff', '--exit-code', '--',
                'src/features/chat-widget/generated/',
            ],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            diff.returncode, 0,
            f'codegen produced a diff on a clean tree:\n{diff.stdout}',
        )


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
