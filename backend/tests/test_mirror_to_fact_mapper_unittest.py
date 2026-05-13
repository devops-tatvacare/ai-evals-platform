"""Phase 2 unit tests for MirrorToFactMapper.

Covers:
  * loading the bundled crm_call_record__call.yaml
  * duplicate (app_id, source_table, target_fact, activity_type) detection
  * disabled state read from a stubbed AsyncSession
  * project() output shape for a representative mirror row
  * missing required attribute raises MappingProjectionError
  * manifest cross-check (validate_against_manifest) with a fixture schema
"""
from __future__ import annotations

import tempfile
import textwrap
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

from app.services.analytics.mirror_to_fact_mapper import (
    MappingDefinitionError,
    MappingProjectionError,
    MirrorToFactMapper,
    load_mappings,
    validate_against_manifest,
)


_BUNDLED_MAPPINGS_DIR = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "analytics"
    / "mirror_to_fact_mappings"
)


def _sample_mirror_row() -> dict[str, Any]:
    """Representative crm_call_record row using post-Phase-1 column names."""
    return {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "app_id": "inside-sales",
        "activity_id": "act-12345",
        "lead_id": "lead-9001",
        "rep_id": "rep-42",
        "rep_name": "Asha Rao",
        "rep_email": "asha@example.com",
        "event_code": 12,
        "direction": "outbound",
        "status": "answered",
        "call_started_at": datetime(2026, 5, 13, 9, 0, tzinfo=timezone.utc),
        "duration_seconds": 312,
        "has_recording": True,
        "recording_url": "https://example.com/r.mp3",
        "phone_number": "+919900112233",
        "display_number": "9900112233",
        "call_notes": "Discussed pricing.",
        "call_session_id": "sess-7",
    }


class LoadBundledMappingTests(unittest.TestCase):
    def test_loads_call_mapping_from_bundled_dir(self) -> None:
        mappings = load_mappings(_BUNDLED_MAPPINGS_DIR)
        keys = [m.key for m in mappings]
        self.assertIn(
            (
                "inside-sales",
                "analytics.crm_call_record",
                "analytics.fact_lead_activity",
                "call",
            ),
            keys,
        )

    def test_mapper_for_table_returns_mapping(self) -> None:
        # Use an isolated mapper so a stale cached default doesn't affect us.
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        mapping = mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )
        self.assertEqual(mapping.target_fact, "analytics.fact_lead_activity")
        self.assertEqual(mapping.activity_subtype_from, "direction")
        self.assertEqual(
            mapping.required_attributes,
            ("duration_seconds", "direction", "status", "rep_email"),
        )

    def test_mapper_for_table_unknown_raises_key_error(self) -> None:
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        with self.assertRaises(KeyError):
            mapper.for_table("inside-sales", "analytics.crm_call_record", "email")


class DuplicateDetectionTests(unittest.TestCase):
    _YAML = textwrap.dedent(
        """\
        source_table: analytics.crm_call_record
        target_fact:  analytics.fact_lead_activity
        app_id: inside-sales
        activity_type: call
        structural_mapping:
          lead_id: lead_id
        attributes_mapping:
          duration_seconds: duration_seconds
        required_attributes: [duration_seconds]
        """
    )

    _YAML_ALT_TARGET = textwrap.dedent(
        """\
        source_table: analytics.crm_call_record
        target_fact:  analytics.fact_call_recording
        app_id: inside-sales
        activity_type: call
        structural_mapping:
          lead_id: lead_id
        attributes_mapping:
          duration_seconds: duration_seconds
        required_attributes: [duration_seconds]
        """
    )

    def test_two_files_same_key_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "a.yaml").write_text(self._YAML)
            (tmp_path / "b.yaml").write_text(self._YAML)
            with self.assertRaises(MappingDefinitionError) as cm:
                load_mappings(tmp_path)
            self.assertIn("duplicate mapping registration", str(cm.exception))

    def test_two_mappings_same_lookup_different_target_raises(self) -> None:
        # Distinct full keys (different target_fact) but identical
        # (app_id, source_table, activity_type) — for_table can't tell them
        # apart, so MirrorToFactMapper(...) refuses to construct.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "a.yaml").write_text(self._YAML)
            (tmp_path / "b.yaml").write_text(self._YAML_ALT_TARGET)
            with self.assertRaises(MappingDefinitionError) as cm:
                MirrorToFactMapper(tmp_path)
            self.assertIn("different fact tables", str(cm.exception))


class ProjectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        self.mapping = self.mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )

    def test_project_fact_row_shape(self) -> None:
        row = _sample_mirror_row()
        sync_run_id = uuid.uuid4()
        fact = self.mapping.project(row, sync_run_id=sync_run_id)

        # Structural columns mapped via column refs / literal:
        self.assertEqual(fact["lead_id"], "lead-9001")
        self.assertEqual(fact["source_activity_id"], "act-12345")
        self.assertEqual(fact["source_event_code"], 12)
        self.assertEqual(fact["occurred_at"], row["call_started_at"])
        self.assertEqual(fact["actor_type"], "rep")  # literal
        self.assertEqual(fact["actor_id"], "rep-42")
        self.assertEqual(fact["actor_label"], "Asha Rao")

        # Discriminator + provenance:
        self.assertEqual(fact["activity_type"], "call")
        self.assertEqual(fact["activity_subtype"], "outbound")
        self.assertEqual(fact["sync_run_id"], sync_run_id)

        # Attributes mapping:
        self.assertEqual(fact["attributes"]["duration_seconds"], 312)
        self.assertEqual(fact["attributes"]["direction"], "outbound")
        self.assertEqual(fact["attributes"]["status"], "answered")
        self.assertEqual(fact["attributes"]["phone_number"], "+919900112233")
        self.assertEqual(fact["attributes"]["recording_url"], "https://example.com/r.mp3")
        self.assertEqual(fact["attributes"]["rep_email"], "asha@example.com")
        self.assertTrue(fact["attributes"]["has_recording"])
        self.assertEqual(fact["attributes"]["call_notes"], "Discussed pricing.")
        self.assertEqual(fact["attributes"]["event_code"], 12)
        self.assertEqual(fact["attributes"]["call_session_id"], "sess-7")
        self.assertEqual(fact["attributes"]["display_number"], "9900112233")

    def test_project_raises_on_missing_required_attribute(self) -> None:
        row = _sample_mirror_row()
        row["rep_email"] = None  # required per the YAML
        with self.assertRaises(MappingProjectionError) as cm:
            self.mapping.project(row, sync_run_id=uuid.uuid4())
        self.assertIn("rep_email", str(cm.exception))

    def test_project_raises_on_missing_source_column(self) -> None:
        row = _sample_mirror_row()
        del row["call_started_at"]
        with self.assertRaises(MappingProjectionError) as cm:
            self.mapping.project(row, sync_run_id=uuid.uuid4())
        self.assertIn("call_started_at", str(cm.exception))

    def test_project_accepts_orm_style_object(self) -> None:
        # Phase 3's caller passes ``CrmCallRecord`` ORM instances, not dicts.
        # ``SimpleNamespace`` is the stdlib stand-in: dot-access only,
        # no __getitem__. The mapper's accessor must transparently support
        # both shapes or the wire-in will silently break.
        from types import SimpleNamespace

        row = SimpleNamespace(**_sample_mirror_row())
        fact = self.mapping.project(row, sync_run_id=uuid.uuid4())
        self.assertEqual(fact["lead_id"], "lead-9001")
        self.assertEqual(fact["actor_type"], "rep")
        self.assertEqual(fact["activity_subtype"], "outbound")

    def test_project_raises_on_missing_activity_subtype_from_column(self) -> None:
        # If activity_subtype_from points at a column the mirror row doesn't
        # carry (typo in YAML, schema drift), project() must raise — the
        # silent-NULL behavior is the exact bug class this plan is closing.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "m.yaml").write_text(
                textwrap.dedent(
                    """\
                    source_table: analytics.crm_call_record
                    target_fact:  analytics.fact_lead_activity
                    app_id: inside-sales
                    activity_type: call
                    activity_subtype_from: directiom   # typo
                    structural_mapping:
                      lead_id: lead_id
                    attributes_mapping:
                      duration_seconds: duration_seconds
                    required_attributes: [duration_seconds]
                    """
                )
            )
            mapping = load_mappings(tmp_path)[0]
            with self.assertRaises(MappingProjectionError) as cm:
                mapping.project(
                    {"lead_id": "L", "duration_seconds": 1, "activity_id": "X"},
                    sync_run_id=None,
                )
            self.assertIn("directiom", str(cm.exception))


class EnabledStateTests(unittest.IsolatedAsyncioTestCase):
    def _build_session(self, return_value: Any) -> Any:
        scalar_result = AsyncMock()
        scalar_result.scalar_one_or_none = lambda: return_value
        session = AsyncMock()
        session.execute = AsyncMock(return_value=scalar_result)
        return session

    async def test_enabled_returns_true_when_no_row(self) -> None:
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        mapping = mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )
        session = self._build_session(None)
        self.assertTrue(await mapping.enabled(session))
        # The call must hit the DB once — guards against silent shorting
        # back to ``True`` when the model import fails.
        session.execute.assert_awaited_once()

    async def test_enabled_returns_false_when_row_disabled(self) -> None:
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        mapping = mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )
        session = self._build_session(False)
        self.assertFalse(await mapping.enabled(session))

    async def test_enabled_sql_filters_by_full_key(self) -> None:
        # Compile the SELECT issued by ``enabled`` and assert the WHERE
        # clause mentions all four discriminator columns. Catches a future
        # rename that drops one of them from the filter.
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        mapping = mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )
        session = self._build_session(True)
        await mapping.enabled(session)
        stmt = session.execute.await_args.args[0]
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("mapping_state.app_id", compiled)
        self.assertIn("mapping_state.source_table", compiled)
        self.assertIn("mapping_state.target_fact", compiled)
        self.assertIn("mapping_state.activity_type", compiled)
        self.assertIn("'inside-sales'", compiled)
        self.assertIn("'analytics.crm_call_record'", compiled)
        self.assertIn("'analytics.fact_lead_activity'", compiled)
        self.assertIn("'call'", compiled)


class ExpressionGrammarTests(unittest.TestCase):
    def _write(self, body: str) -> Path:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "m.yaml").write_text(body)
        return tmp

    def test_unsupported_expression_raises(self) -> None:
        body = textwrap.dedent(
            """\
            source_table: analytics.crm_call_record
            target_fact:  analytics.fact_lead_activity
            app_id: inside-sales
            activity_type: call
            structural_mapping:
              lead_id: "concat(lead_id, '-x')"
            attributes_mapping:
              duration_seconds: duration_seconds
            required_attributes: [duration_seconds]
            """
        )
        tmp = self._write(body)
        with self.assertRaises(MappingDefinitionError) as cm:
            load_mappings(tmp)
        self.assertIn("unsupported expression", str(cm.exception))

    def test_null_expression_accepted(self) -> None:
        body = textwrap.dedent(
            """\
            source_table: analytics.crm_call_record
            target_fact:  analytics.fact_lead_activity
            app_id: inside-sales
            activity_type: call
            structural_mapping:
              lead_id: lead_id
              actor_id: null
            attributes_mapping:
              duration_seconds: duration_seconds
            required_attributes: [duration_seconds]
            """
        )
        tmp = self._write(body)
        mappings = load_mappings(tmp)
        self.assertEqual(len(mappings), 1)
        fact = mappings[0].project(
            {"lead_id": "L", "duration_seconds": 1, "activity_id": "X"},
            sync_run_id=None,
        )
        self.assertIsNone(fact["actor_id"])

    def test_required_attribute_must_be_declared(self) -> None:
        body = textwrap.dedent(
            """\
            source_table: analytics.crm_call_record
            target_fact:  analytics.fact_lead_activity
            app_id: inside-sales
            activity_type: call
            structural_mapping:
              lead_id: lead_id
            attributes_mapping:
              duration_seconds: duration_seconds
            required_attributes: [duration_seconds, rep_email]
            """
        )
        tmp = self._write(body)
        with self.assertRaises(MappingDefinitionError) as cm:
            load_mappings(tmp)
        self.assertIn("required_attributes", str(cm.exception))
        self.assertIn("rep_email", str(cm.exception))


class ManifestCrossCheckTests(unittest.TestCase):
    """validate_against_manifest is the Phase-2 callable validator.

    Phase 7 wires it into boot; until then it runs against a fixture
    schema in tests only, so production manifests can ship without
    ``attribute_schemas`` declared.
    """

    def setUp(self) -> None:
        mapper = MirrorToFactMapper(_BUNDLED_MAPPINGS_DIR)
        self.mapping = mapper.for_table(
            "inside-sales", "analytics.crm_call_record", "call"
        )

    def _full_fixture_schema(self) -> dict:
        # Declares every key the call mapping writes.
        return {
            "call": {
                "duration_seconds": {"role": "measure"},
                "direction": {"role": "dimension"},
                "status": {"role": "dimension"},
                "phone_number": {"role": "dimension"},
                "recording_url": {"role": "identifier"},
                "rep_email": {"role": "dimension"},
                "has_recording": {"role": "dimension"},
                "call_notes": {"role": "dimension"},
                "event_code": {"role": "dimension"},
                "call_session_id": {"role": "identifier"},
                "display_number": {"role": "dimension"},
            }
        }

    def test_no_errors_when_schema_declares_all_keys(self) -> None:
        errors = validate_against_manifest(self.mapping, self._full_fixture_schema())
        self.assertEqual(errors, [])

    def test_errors_when_attribute_schemas_missing(self) -> None:
        errors = validate_against_manifest(self.mapping, None)
        self.assertEqual(len(errors), 1)
        self.assertIn("does not declare attribute_schemas", errors[0])

    def test_errors_when_activity_type_not_in_schema(self) -> None:
        errors = validate_against_manifest(self.mapping, {"email": {}})
        self.assertEqual(len(errors), 1)
        self.assertIn("no entry for activity_type 'call'", errors[0])

    def test_errors_on_undeclared_written_key(self) -> None:
        schema = self._full_fixture_schema()
        del schema["call"]["call_notes"]
        errors = validate_against_manifest(self.mapping, schema)
        self.assertEqual(len(errors), 1)
        self.assertIn("call_notes", errors[0])
        self.assertIn("does not declare", errors[0])

    def test_errors_on_undeclared_required_key(self) -> None:
        schema = self._full_fixture_schema()
        del schema["call"]["rep_email"]
        errors = validate_against_manifest(self.mapping, schema)
        # Both "writes key rep_email" and "required attribute rep_email" fire.
        self.assertEqual(len(errors), 2)
        self.assertTrue(any("required attribute 'rep_email'" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
