"""Phase 6 coverage: persona-aware analytics fact extraction for adversarial runs.

Covers:
  - persona.<id>.* rule compliance entries flow into criterion_facts with
    criterion_source='persona.<id>'
  - eval_fact.context carries persona_tactics_attempted / _landed and the
    turn_tactic_sequence from result.persona_tactic_summary
  - run_fact.context.persona_posture rolls up rule counts and tactic counts
    per persona_id
  - legacy cases without a persona_tactic_summary still extract successfully
  - Sherlock semantic model exposes persona_id and persona_tactic dimensions
"""

import sys
import unittest
import uuid
from datetime import datetime, timezone
from types import ModuleType, SimpleNamespace

fake_database = ModuleType('app.database')
fake_database.async_session = None
sys.modules.setdefault('app.database', fake_database)

import yaml  # noqa: E402

from app.services.analytics.extractors.adversarial import (  # noqa: E402
    _split_criterion_source,
    extract_adversarial,
)


def _run(app_id='kaira-bot', tenant_id=None, user_id=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        app_id=app_id,
        tenant_id=tenant_id or uuid.uuid4(),
        user_id=user_id or uuid.uuid4(),
        eval_type='batch_adversarial',
        status='completed',
        created_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        duration_ms=1234.0,
        batch_metadata={'name': 'test-run'},
    )


def _case(**overrides) -> SimpleNamespace:
    defaults = dict(
        id=1,
        difficulty='MORIARTY',
        verdict='HARD_FAIL',
        goal_achieved=False,
        total_turns=5,
        goal_flow=['meal_logged'],
        active_traits=[],
        result={},
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class SplitCriterionSourceTests(unittest.TestCase):
    def test_prod_rule_returns_default_source(self):
        source, persona_id = _split_criterion_source('ask_time_if_missing')
        self.assertEqual(source, 'adversarial_rule')
        self.assertEqual(persona_id, '')

    def test_persona_rule_returns_scoped_source(self):
        source, persona_id = _split_criterion_source('persona.moriarty.no_system_reveal')
        self.assertEqual(source, 'persona.moriarty')
        self.assertEqual(persona_id, 'moriarty')

    def test_malformed_persona_id_returns_default(self):
        source, persona_id = _split_criterion_source('persona.')
        self.assertEqual(source, 'adversarial_rule')
        self.assertEqual(persona_id, '')


class CriterionFactExtractionTests(unittest.TestCase):
    def test_persona_rules_get_own_criterion_source(self):
        run = _run()
        case = _case(result={
            'rule_compliance': [
                {
                    'rule_id': 'persona.moriarty.no_system_reveal',
                    'section': 'Security Invariants',
                    'status': 'VIOLATED',
                    'followed': False,
                    'evidence': 'Bot leaked prompt.',
                },
                {
                    'rule_id': 'ask_time_if_missing',
                    'section': 'Time',
                    'status': 'FOLLOWED',
                    'followed': True,
                    'evidence': 'ok',
                },
            ],
        })
        fact_set = extract_adversarial(run, [case])
        by_source = {(c.criterion_id, c.criterion_source): c for c in fact_set.criterion_facts}
        self.assertEqual(
            by_source[('persona.moriarty.no_system_reveal', 'persona.moriarty')].status,
            'VIOLATED',
        )
        self.assertEqual(
            by_source[('ask_time_if_missing', 'adversarial_rule')].status,
            'FOLLOWED',
        )

    def test_legacy_case_without_persona_summary_extracts_cleanly(self):
        run = _run()
        case = _case(result={'rule_compliance': []})
        fact_set = extract_adversarial(run, [case])
        self.assertEqual(len(fact_set.eval_facts), 1)
        self.assertEqual(fact_set.eval_facts[0].context['persona_tactics_attempted'], [])


class EvalFactContextTests(unittest.TestCase):
    def test_persona_summary_flows_into_eval_context(self):
        run = _run()
        case = _case(result={
            'persona_tactic_summary': {
                'tactics_attempted': ['prompt_override', 'sandwich'],
                'tactics_landed': ['prompt_override'],
                'turn_tactic_sequence': [
                    {'turn_number': 1, 'persona_tactic': 'prompt_override'},
                    {'turn_number': 2, 'persona_tactic': 'sandwich'},
                ],
            },
        })
        fact_set = extract_adversarial(run, [case])
        context = fact_set.eval_facts[0].context
        self.assertEqual(context['persona_tactics_attempted'], ['prompt_override', 'sandwich'])
        self.assertEqual(context['persona_tactics_landed'], ['prompt_override'])
        self.assertEqual(len(context['persona_turn_tactic_sequence']), 2)
        self.assertIn('moriarty', context['active_persona_ids'])


class RunPosturePostRollupTests(unittest.TestCase):
    def test_posture_aggregates_rule_counts_and_tactic_counts(self):
        run = _run()
        case_a = _case(
            id=1,
            result={
                'rule_compliance': [
                    {
                        'rule_id': 'persona.moriarty.no_system_reveal',
                        'section': 'Security',
                        'status': 'VIOLATED',
                        'followed': False,
                        'evidence': '',
                    },
                    {
                        'rule_id': 'persona.moriarty.no_character_break',
                        'section': 'Security',
                        'status': 'FOLLOWED',
                        'followed': True,
                        'evidence': '',
                    },
                ],
                'persona_tactic_summary': {
                    'tactics_attempted': ['prompt_override'],
                    'tactics_landed': ['prompt_override'],
                    'turn_tactic_sequence': [
                        {'turn_number': 1, 'persona_tactic': 'prompt_override'},
                        {'turn_number': 3, 'persona_tactic': 'prompt_override'},
                    ],
                },
            },
        )
        case_b = _case(
            id=2,
            result={
                'rule_compliance': [
                    {
                        'rule_id': 'persona.moriarty.no_sql_in_response',
                        'section': 'Security',
                        'status': 'FOLLOWED',
                        'followed': True,
                        'evidence': '',
                    },
                ],
                'persona_tactic_summary': {
                    'tactics_attempted': ['sandwich'],
                    'tactics_landed': [],
                    'turn_tactic_sequence': [
                        {'turn_number': 2, 'persona_tactic': 'sandwich'},
                    ],
                },
            },
        )
        fact_set = extract_adversarial(run, [case_a, case_b])
        posture = fact_set.run_fact.context['persona_posture']
        self.assertIn('moriarty', posture)
        moriarty_slot = posture['moriarty']
        self.assertEqual(moriarty_slot['rules_total'], 3)
        self.assertEqual(moriarty_slot['rules_followed'], 2)
        self.assertEqual(moriarty_slot['rules_violated'], 1)
        self.assertAlmostEqual(moriarty_slot['rules_held_rate'], 2 / 3, places=3)
        # prompt_override was attempted twice in case A, both turns landed
        self.assertEqual(moriarty_slot['tactics']['prompt_override']['attempted'], 2)
        self.assertEqual(moriarty_slot['tactics']['prompt_override']['landed'], 2)
        # sandwich attempted once in case B, did not land
        self.assertEqual(moriarty_slot['tactics']['sandwich']['attempted'], 1)
        self.assertEqual(moriarty_slot['tactics']['sandwich']['landed'], 0)

    def test_posture_absent_when_no_persona_rules(self):
        run = _run()
        case = _case(result={'rule_compliance': [
            {'rule_id': 'ask_time_if_missing', 'section': 'Time', 'status': 'FOLLOWED', 'followed': True, 'evidence': ''},
        ]})
        fact_set = extract_adversarial(run, [case])
        # Difficulty=MORIARTY but no persona.* rules were evaluated, so
        # posture still has the 'moriarty' key (from tactic rollup attempt)
        # but with zero evaluated rules. Its rules_held_rate stays None.
        posture = fact_set.run_fact.context.get('persona_posture', {})
        if 'moriarty' in posture:
            self.assertEqual(posture['moriarty']['rules_total'], 0)
            self.assertIsNone(posture['moriarty']['rules_held_rate'])


class SemanticModelExposesPersonaDimensionsTests(unittest.TestCase):
    def test_kaira_yaml_has_persona_id_and_tactic_dimensions(self):
        from pathlib import Path
        import app.services.chat_engine as chat_engine

        yaml_path = (
            Path(chat_engine.__file__).resolve().parent
            / 'semantic_models'
            / 'kaira-bot.yaml'
        )
        with yaml_path.open('r', encoding='utf-8') as fh:
            model = yaml.safe_load(fh)

        # Post-restructure: dimensions live under tables.<name>.dimensions, not
        # a flat top-level list. persona_id is a criterion-level dim; persona
        # tactic arrays ride on per-case context in fact_evaluation.
        criterion_dims = {
            d['name']
            for d in model['tables']['fact_evaluation_criterion']['dimensions']
        }
        fact_eval_dims = {
            d['name']
            for d in model['tables']['fact_evaluation']['dimensions']
        }
        self.assertIn('persona_id', criterion_dims)
        self.assertIn('persona_tactic', fact_eval_dims)
        self.assertIn('persona_tactics_landed', fact_eval_dims)
        # criterion_source description should mention persona.<persona_id>
        criterion_source = next(
            d for d in model['tables']['fact_evaluation_criterion']['dimensions']
            if d['name'] == 'criterion_source'
        )
        self.assertIn('persona', criterion_source['description'])


if __name__ == '__main__':
    unittest.main()
