"""Phase 7 tests — manifest model extensions, attribute_schemas,
relationships, and bouncer R4 JSONB-key grammar.

Covers:
  - Manifest loader still accepts every shipped manifest (inside-sales,
    kaira-bot, voice-rx) post-extension.
  - inside-sales: crm_call_record / crm_lead_record are NOT in the
    Sherlock-visible catalog.
  - inside-sales: fact_lead_activity declares an attribute_schemas.call
    block with at least the keys carried by the mirror-to-fact mapping
    (no drift between mapper YAML and manifest YAML).
  - inside-sales: declared relationships point at real tables and real
    columns, and every lead-grain fact joins many_to_one to dim_lead.
  - PII flag is plumbed end-to-end (manifest → attribute_schemas → key).
  - Supervisor prompt contains the hidden-mirror recovery instruction.
  - Bouncer R4 JSONB grammar accepts declared keys under an activity_type
    filter and rejects undeclared keys / meta-introspection.
"""
from __future__ import annotations

import unittest
from pathlib import Path

import yaml

from app.services.chat_engine.manifest import (
    _clear_manifest_cache_for_tests,
    load_all_manifests,
)
from app.services.chat_engine.sql_bouncer import (
    _flatten_select,
    _parse,
    _r4_jsonb_keys,
    _r4_pii_visibility,
)
from app.services.sherlock_v3.supervisor import _SUPERVISOR_PROMPT


_MAPPER_YAML = (
    Path(__file__).resolve().parents[1]
    / "app/services/analytics/mirror_to_fact_mappings"
    / "crm_call_record__call.yaml"
)


class ManifestLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()

    def test_every_shipped_manifest_loads(self) -> None:
        manifests = load_all_manifests()
        for app_id in ("inside-sales", "kaira-bot", "voice-rx"):
            self.assertIn(app_id, manifests)

    def test_inside_sales_drops_raw_crm_mirrors(self) -> None:
        m = load_all_manifests()["inside-sales"]
        self.assertNotIn("crm_call_record", m.catalog_tables)
        self.assertNotIn("crm_lead_record", m.catalog_tables)


class AttributeSchemasTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()

    def test_fact_lead_activity_declares_call_schema(self) -> None:
        m = load_all_manifests()["inside-sales"]
        table = m.catalog_tables["fact_lead_activity"]
        self.assertIn("call", table.attribute_schemas)
        keys = set(table.attribute_schemas["call"].keys())
        # Must cover every key the call mapper writes into attributes.
        mapper = yaml.safe_load(_MAPPER_YAML.read_text())
        mapper_keys = set(mapper.get("attributes_mapping", {}).keys())
        missing = mapper_keys - keys
        self.assertFalse(
            missing,
            f"manifest attribute_schemas.call is missing keys produced "
            f"by the mapper: {sorted(missing)}",
        )

    def test_phone_number_is_marked_pii(self) -> None:
        m = load_all_manifests()["inside-sales"]
        call_schema = m.catalog_tables["fact_lead_activity"].attribute_schemas["call"]
        self.assertTrue(call_schema["phone_number"].pii)
        self.assertTrue(call_schema["call_notes"].pii)
        self.assertFalse(call_schema["duration_seconds"].pii)

    def test_signal_and_stage_default_schema_present(self) -> None:
        # _default reserves the surface for future per-discriminator keys.
        m = load_all_manifests()["inside-sales"]
        self.assertIn(
            "_default",
            m.catalog_tables["fact_lead_signal"].attribute_schemas,
        )
        self.assertIn(
            "_default",
            m.catalog_tables["fact_lead_stage_transition"].attribute_schemas,
        )


class RelationshipsTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()

    def test_three_lead_grain_facts_join_many_to_one_to_dim_lead(self) -> None:
        m = load_all_manifests()["inside-sales"]
        edges = {(r.left_table, r.right_table, r.relationship_type) for r in m.relationships}
        for left in ("fact_lead_activity", "fact_lead_signal", "fact_lead_stage_transition"):
            self.assertIn(
                (left, "dim_lead", "many_to_one"),
                edges,
                f"missing {left} → dim_lead many_to_one relationship",
            )


class SupervisorPromptTests(unittest.TestCase):
    def test_hidden_mirror_recovery_instruction_present(self) -> None:
        # The supervisor must translate crm_call_record / crm_lead_record
        # mentions and acknowledge the translation in its answer.
        self.assertIn("Hidden-mirror recovery", _SUPERVISOR_PROMPT)
        self.assertIn("crm_call_record", _SUPERVISOR_PROMPT)
        self.assertIn("crm_lead_record", _SUPERVISOR_PROMPT)
        self.assertIn("fact_lead_activity", _SUPERVISOR_PROMPT)
        self.assertIn("dim_lead", _SUPERVISOR_PROMPT)


def _r4(sql: str, manifest):
    parsed = _flatten_select(_parse(sql))
    if parsed is None:
        return None
    return _r4_jsonb_keys(parsed, manifest)


class BouncerR4JsonbGrammarTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()
        self.manifest = load_all_manifests()["inside-sales"]

    def test_declared_key_with_activity_type_filter_allowed(self) -> None:
        v = _r4(
            "SELECT attributes->>'duration_seconds' AS d "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNone(v)

    def test_undeclared_key_rejected(self) -> None:
        v = _r4(
            "SELECT attributes->>'undeclared_key' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNotNone(v)
        assert v is not None  # narrow for type checker
        self.assertEqual(v.diagnostic.rule_id, "R4.jsonb_undeclared_key")

    def test_jsonb_object_keys_rejected(self) -> None:
        v = _r4(
            "SELECT jsonb_object_keys(attributes) "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNotNone(v)
        assert v is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.jsonb_meta_introspection")

    def test_in_list_with_declared_key_allowed(self) -> None:
        v = _r4(
            "SELECT attributes->>'status' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type IN ('call')",
            self.manifest,
        )
        self.assertIsNone(v)

    def test_alias_prefixed_access_allowed(self) -> None:
        v = _r4(
            "SELECT la.attributes->>'recording_url' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNone(v)

    def test_no_manifest_means_no_op(self) -> None:
        v = _r4(
            "SELECT attributes->>'anything' FROM analytics.fact_lead_activity la",
            None,
        )
        self.assertIsNone(v)


class ActorSynonymsTests(unittest.TestCase):
    """Audit-fix (b) — actor_label synonyms align with §6.1 spec."""

    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()

    def test_actor_label_carries_full_legacy_synonym_set(self) -> None:
        m = load_all_manifests()["inside-sales"]
        syns = set(m.catalog_tables["fact_lead_activity"].columns["actor_label"].synonyms)
        # §6.1 mandates these on actor_label as well as actor_id.
        for required in ("agent", "salesperson", "rep", "caller"):
            self.assertIn(required, syns)


class BouncerR4CastTypeTests(unittest.TestCase):
    """Audit-fix (a) — cast targets must match declared data_type."""

    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()
        self.manifest = load_all_manifests()["inside-sales"]

    def test_numeric_cast_on_quantitative_key_allowed(self) -> None:
        v = _r4(
            "SELECT (la.attributes->>'duration_seconds')::numeric "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNone(v)

    def test_timestamp_cast_on_quantitative_key_rejected(self) -> None:
        v = _r4(
            "SELECT (la.attributes->>'duration_seconds')::timestamp "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNotNone(v)
        assert v is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.jsonb_cast_mismatch")

    def test_numeric_cast_on_boolean_key_rejected(self) -> None:
        v = _r4(
            "SELECT (la.attributes->>'has_recording')::numeric "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
        )
        self.assertIsNotNone(v)
        assert v is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.jsonb_cast_mismatch")


def _pii(sql: str, manifest, perms):
    parsed = _flatten_select(_parse(sql))
    if parsed is None:
        return None
    return _r4_pii_visibility(parsed, manifest, perms)


class BouncerPIIVisibilityTests(unittest.TestCase):
    """Audit-fix (c) — bouncer rejects PII-tagged access without the
    ``analytics:pii-visibility`` permission."""

    def setUp(self) -> None:
        _clear_manifest_cache_for_tests()
        self.manifest = load_all_manifests()["inside-sales"]
        self.no_pii = frozenset({"analytics:read"})
        self.with_pii = frozenset({"analytics:read", "analytics:pii-visibility"})

    def test_pii_jsonb_key_rejected_without_permission(self) -> None:
        v = _pii(
            "SELECT la.attributes->>'phone_number' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
            self.no_pii,
        )
        self.assertIsNotNone(v)
        assert v is not None
        self.assertEqual(v.diagnostic.rule_id, "R4.pii_jsonb_key")

    def test_pii_jsonb_key_allowed_with_permission(self) -> None:
        v = _pii(
            "SELECT la.attributes->>'phone_number' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
            self.with_pii,
        )
        self.assertIsNone(v)

    def test_non_pii_key_allowed_without_permission(self) -> None:
        v = _pii(
            "SELECT la.attributes->>'duration_seconds' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
            self.no_pii,
        )
        self.assertIsNone(v)

    def test_legacy_callsite_passing_none_permissions_is_no_op(self) -> None:
        v = _pii(
            "SELECT la.attributes->>'phone_number' "
            "FROM analytics.fact_lead_activity la "
            "WHERE la.activity_type = 'call'",
            self.manifest,
            None,
        )
        self.assertIsNone(v)


if __name__ == "__main__":
    unittest.main()
