"""The typed Artifact must accept every chart payload the data specialist emits
and reject smuggled extra keys.

Regression: ``_attach_bouncer_result_metadata`` used to inject a
``result_metadata`` dict into the chart payload. Once ``Artifact.payload`` was
typed as the ``extra='forbid'`` ChartPayload union, that smuggled key raised a
ValidationError inside ``submit_sql`` — the OpenAI Agents SDK swallowed it as a
tool error, so the ToolPart was stuck ``pending``, no ChartPart was emitted, and
the supervisor retried until it gave up. This test pins the contract so a future
edit cannot reintroduce a non-contract field on the payload.
"""
from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.services.sherlock_v3.contracts.artifact import Artifact


def _kpi_payload() -> dict:
    return {
        'kind': 'kpi',
        'title': 'Calls last week',
        'source_question': 'How many calls were made last week?',
        'sql_query': 'SELECT COUNT(*) FROM analytics.fact_lead_activity',
        'kpi': {'label': 'calls', 'value': 0, 'format': 'integer'},
    }


def _empty_payload() -> dict:
    return {
        'kind': 'empty',
        'title': '',
        'source_question': 'q',
        'sql_query': 'SELECT 1',
        'reason_code': 'CG_EMPTY',
    }


class ArtifactContractTests(unittest.TestCase):
    def test_kpi_artifact_validates(self) -> None:
        art = Artifact.model_validate({'kind': 'kpi', 'payload': _kpi_payload()})
        self.assertEqual(art.kind, 'kpi')
        self.assertEqual(art.payload.kind, 'kpi')

    def test_empty_artifact_validates(self) -> None:
        art = Artifact.model_validate({'kind': 'empty', 'payload': _empty_payload()})
        self.assertEqual(art.payload.kind, 'empty')

    def test_smuggled_result_metadata_is_rejected(self) -> None:
        payload = _kpi_payload()
        payload['result_metadata'] = {'more_rows_exist': False, 'row_cap': 1}
        with self.assertRaises(ValidationError):
            Artifact.model_validate({'kind': 'kpi', 'payload': payload})

    def test_citation_set_kind_is_gone(self) -> None:
        from typing import get_args
        from app.services.sherlock_v3.contracts.artifact import ArtifactKind
        self.assertNotIn('citation_set', get_args(ArtifactKind))


if __name__ == '__main__':
    unittest.main()
