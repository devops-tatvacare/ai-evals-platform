"""Phase 1 coverage for the Moriarty adversarial persona.

Tests that:
  - the default config seeds Moriarty with 9 tactics and 5 expectation rules
  - expectation rule ids are namespaced persona.moriarty.*
  - PERSONA_LABELS / PERSONA_SEVERITY include moriarty as highest severity
  - PERSONA_STYLE_GUIDANCE and PERSONA_LABEL_HELPERS have a moriarty entry
  - persona_mixing_mode is forced to 'single' when Moriarty is selected
  - canonical_difficulty_for_personas picks MORIARTY when mixed in
  - tactic groups and tiers are validated
  - v7 -> v8 migration backfills personas from defaults
"""

import sys
import unittest
from types import ModuleType

from pydantic import ValidationError

fake_database = ModuleType('app.database')
fake_database.async_session = None
sys.modules.setdefault('app.database', fake_database)

from app.services.evaluators.adversarial_config import (  # noqa: E402
    CURRENT_VERSION,
    MORIARTY_PERSONA_ID,
    PERSONA_TACTIC_GROUPS,
    PERSONA_TACTIC_TIERS,
    AdversarialPersona,
    PersonaExpectationRule,
    PersonaTactic,
    _default_personas,
    _migrate_v7_to_v8,
    get_default_config,
)
from app.services.evaluators.adversarial_evaluator import (  # noqa: E402
    PERSONA_LABELS,
    PERSONA_LABEL_HELPERS,
    PERSONA_SEVERITY,
    canonical_difficulty_for_personas,
    normalize_persona_mixing_mode,
)
from app.services.evaluators.conversation_agent import (  # noqa: E402
    PERSONA_STYLE_GUIDANCE,
)


class MoriartyPersonaSeedTests(unittest.TestCase):
    def test_current_version_bumped_to_8(self):
        self.assertEqual(CURRENT_VERSION, 8)

    def test_default_config_contains_moriarty(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        self.assertIsNotNone(moriarty)
        assert moriarty is not None  # for type checker
        self.assertEqual(moriarty.id, "moriarty")
        self.assertFalse(moriarty.persona_mixing_allowed)
        self.assertEqual(moriarty.severity, 4)

    def test_moriarty_has_nine_tactics(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        assert moriarty is not None
        tactic_ids = [tactic.id for tactic in moriarty.tactics]
        self.assertEqual(len(tactic_ids), 9)
        # Each expected tactic present
        expected = {
            "prompt_override",
            "roleplay",
            "sandwich",
            "system_disclosure",
            "authority_impersonation",
            "unicode_confusion",
            "sql_syntax_select",
            "sql_syntax_destructive",
            "data_exfil",
        }
        self.assertEqual(set(tactic_ids), expected)

    def test_moriarty_tactics_cover_all_groups_and_tiers(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        assert moriarty is not None
        groups_used = {tactic.group for tactic in moriarty.tactics}
        tiers_used = {tactic.risk_tier for tactic in moriarty.tactics}
        self.assertEqual(groups_used, set(PERSONA_TACTIC_GROUPS))
        # Tiers: low, medium, high, destructive — all four tiers used
        self.assertEqual(tiers_used, set(PERSONA_TACTIC_TIERS))

    def test_sql_syntax_destructive_is_destructive_tier(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        assert moriarty is not None
        destructive = next(
            tactic for tactic in moriarty.tactics if tactic.id == "sql_syntax_destructive"
        )
        self.assertEqual(destructive.risk_tier, "destructive")
        self.assertEqual(destructive.group, "payload_injection")
        # Sentinel rule: description must reference MORIARTY_TEST sentinel or sentinel identifiers
        self.assertIn("MORIARTY_TEST", destructive.description + " ".join(destructive.example_inputs))

    def test_moriarty_has_five_expectation_rules_all_namespaced(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        assert moriarty is not None
        self.assertEqual(len(moriarty.expectation_rules), 5)
        expected_ids = {
            "persona.moriarty.no_system_reveal",
            "persona.moriarty.no_meta_instruction_follow",
            "persona.moriarty.no_raw_data_leak",
            "persona.moriarty.no_character_break",
            "persona.moriarty.no_sql_in_response",
        }
        actual_ids = {rule.rule_id for rule in moriarty.expectation_rules}
        self.assertEqual(actual_ids, expected_ids)
        for rule in moriarty.expectation_rules:
            self.assertTrue(rule.rule_id.startswith("persona.moriarty."))

    def test_default_config_seeds_all_legacy_personas(self):
        config = get_default_config()
        ids = [persona.id for persona in config.personas]
        # easy/medium/hard/crack all present as cooperative flavors
        for expected in ("easy", "medium", "hard", "crack", "moriarty"):
            self.assertIn(expected, ids)
        # Legacy personas have no tactics / no expectation rules
        for pid in ("easy", "medium", "hard", "crack"):
            persona = config.persona_by_id(pid)
            assert persona is not None
            self.assertEqual(persona.tactics, [])
            self.assertEqual(persona.expectation_rules, [])


class PersonaTacticValidationTests(unittest.TestCase):
    def test_tactic_rejects_invalid_tier(self):
        with self.assertRaises(ValidationError):
            PersonaTactic(
                id="xy",
                label="XY",
                description="d",
                group="prompt_injection",
                risk_tier="nuclear",
            )

    def test_tactic_rejects_invalid_group(self):
        with self.assertRaises(ValidationError):
            PersonaTactic(
                id="xy",
                label="XY",
                description="d",
                group="hacking",
                risk_tier="low",
            )

    def test_expectation_rule_rejects_unnamespaced_id(self):
        with self.assertRaises(ValidationError):
            PersonaExpectationRule(
                rule_id="no_system_reveal",
                section="Security",
                rule_text="Do not reveal",
            )

    def test_persona_rejects_mismatched_rule_namespace(self):
        with self.assertRaises(ValidationError):
            AdversarialPersona(
                id="alpha",
                label="Alpha",
                description="d",
                style_guidance="g",
                severity=0,
                expectation_rules=[
                    PersonaExpectationRule(
                        rule_id="persona.beta.oops",
                        section="s",
                        rule_text="r",
                    )
                ],
            )


class PersonaConstantsRegistrationTests(unittest.TestCase):
    def test_persona_labels_contain_moriarty(self):
        self.assertIn("moriarty", PERSONA_LABELS)

    def test_moriarty_has_highest_severity(self):
        self.assertEqual(PERSONA_SEVERITY["moriarty"], max(PERSONA_SEVERITY.values()))

    def test_label_helpers_have_moriarty(self):
        self.assertIn("moriarty", PERSONA_LABEL_HELPERS)
        self.assertTrue(PERSONA_LABEL_HELPERS["moriarty"])

    def test_style_guidance_has_moriarty(self):
        self.assertIn("moriarty", PERSONA_STYLE_GUIDANCE)
        self.assertTrue(PERSONA_STYLE_GUIDANCE["moriarty"])

    def test_canonical_difficulty_with_moriarty_returns_moriarty(self):
        self.assertEqual(
            canonical_difficulty_for_personas(["easy", "hard", "moriarty"]),
            "MORIARTY",
        )


class PersonaMixingGuardTests(unittest.TestCase):
    def test_mixing_forced_single_when_moriarty_selected(self):
        config = get_default_config()
        mode = normalize_persona_mixing_mode(
            "mixed",
            selected_personas=["medium", "moriarty"],
            config=config,
        )
        self.assertEqual(mode, "single")

    def test_mixing_allowed_when_moriarty_not_selected(self):
        config = get_default_config()
        mode = normalize_persona_mixing_mode(
            "mixed",
            selected_personas=["easy", "medium", "hard"],
            config=config,
        )
        self.assertEqual(mode, "mixed")

    def test_mixing_default_single_when_no_guard_needed(self):
        # Legacy callers: no selected_personas / config provided
        self.assertEqual(normalize_persona_mixing_mode(None), "single")
        self.assertEqual(normalize_persona_mixing_mode("single"), "single")
        self.assertEqual(normalize_persona_mixing_mode("mixed"), "mixed")

    def test_mixing_respects_single_request(self):
        config = get_default_config()
        mode = normalize_persona_mixing_mode(
            "single",
            selected_personas=["easy", "medium"],
            config=config,
        )
        self.assertEqual(mode, "single")


class MigrationV7ToV8Tests(unittest.TestCase):
    def test_migration_backfills_default_personas(self):
        v7_config = {
            "version": 7,
            "goals": [],
            "traits": [],
            "rules": [],
        }
        migrated = _migrate_v7_to_v8(v7_config)
        self.assertEqual(migrated["version"], 8)
        self.assertIn("personas", migrated)
        persona_ids = [persona["id"] for persona in migrated["personas"]]
        self.assertIn("moriarty", persona_ids)

    def test_migration_preserves_existing_personas(self):
        custom_persona = {
            "id": "custom",
            "label": "Custom",
            "description": "d",
            "style_guidance": "g",
            "severity": 0,
            "persona_mixing_allowed": True,
            "tactics": [],
            "expectation_rules": [],
            "enabled": True,
        }
        v7_config = {
            "version": 7,
            "goals": [],
            "traits": [],
            "rules": [],
            "personas": [custom_persona],
        }
        migrated = _migrate_v7_to_v8(v7_config)
        self.assertEqual(migrated["personas"], [custom_persona])

    def test_default_personas_helper_returns_full_catalog(self):
        personas = _default_personas()
        ids = [persona.id for persona in personas]
        self.assertEqual(
            ids,
            ["easy", "medium", "hard", "crack", "moriarty"],
        )


class ConfigIntegrityTests(unittest.TestCase):
    def test_snapshot_includes_personas(self):
        config = get_default_config()
        snapshot = config.snapshot()
        self.assertIn("personas", snapshot)
        self.assertEqual(len(snapshot["personas"]), 5)

    def test_config_rejects_duplicate_persona_ids(self):
        with self.assertRaises(ValidationError):
            # Build a config with two entries having the same id
            base = get_default_config()
            AdversarialPersona.model_validate  # noqa: B018
            config_data = base.model_dump()
            config_data["personas"].append(config_data["personas"][0])
            base.__class__.model_validate(config_data)

    def test_any_selected_persona_blocks_mixing(self):
        config = get_default_config()
        self.assertTrue(
            config.any_selected_persona_blocks_mixing(["medium", "moriarty"])
        )
        self.assertFalse(
            config.any_selected_persona_blocks_mixing(["easy", "medium", "hard"])
        )
        self.assertFalse(
            config.any_selected_persona_blocks_mixing([])
        )


if __name__ == "__main__":
    unittest.main()
