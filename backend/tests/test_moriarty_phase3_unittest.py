"""Phase 3 coverage: saved test case persona_tactic column + per-case override.

Covers:
  - AdversarialSavedTestCase model exposes persona_tactic column
  - schemas round-trip persona_tactic in create/update/response
  - service model_to_runtime preserves persona_tactic as dynamic attribute
  - service runtime_to_create_payload carries persona_tactic
  - ConversationAgent._persona_catalog_for_case narrows to pinned tactic only
    for that case
"""

import sys
import unittest
from types import ModuleType, SimpleNamespace
from uuid import uuid4

fake_database = ModuleType('app.database')
fake_database.async_session = None
sys.modules.setdefault('app.database', fake_database)

from app.schemas.adversarial_test_case import (  # noqa: E402
    AdversarialSavedTestCaseCreate,
    AdversarialSavedTestCaseResponse,
    AdversarialSavedTestCaseUpdate,
)
from app.services.adversarial_test_case_service import (  # noqa: E402
    model_to_runtime,
    runtime_to_create_payload,
)
from app.services.evaluators.adversarial_config import (  # noqa: E402
    MORIARTY_PERSONA_ID,
    get_default_config,
)
from app.services.evaluators.conversation_agent import (  # noqa: E402
    ConversationAgent,
)
from app.services.evaluators.llm_base import BaseLLMProvider  # noqa: E402
from app.services.evaluators.models import AdversarialTestCase  # noqa: E402


class StubLLM(BaseLLMProvider):
    def __init__(self):
        super().__init__(api_key='', model_name='stub', temperature=0.0)

    async def generate(self, *args, **kwargs):
        raise AssertionError('unused')

    async def generate_json(self, *args, **kwargs):
        raise AssertionError('unused')


class SchemaRoundTripTests(unittest.TestCase):
    def test_create_schema_accepts_persona_tactic(self):
        payload = AdversarialSavedTestCaseCreate(
            synthetic_input='log my meal',
            difficulty='MORIARTY',
            goal_flow=['meal_logged'],
            persona_tactic='sql_syntax_destructive',
        )
        self.assertEqual(payload.persona_tactic, 'sql_syntax_destructive')

    def test_update_schema_accepts_persona_tactic(self):
        payload = AdversarialSavedTestCaseUpdate(persona_tactic='prompt_override')
        self.assertEqual(payload.persona_tactic, 'prompt_override')

    def test_response_schema_exposes_persona_tactic(self):
        response = AdversarialSavedTestCaseResponse(
            id=uuid4(),
            app_id='kaira-bot',
            synthetic_input='log my meal',
            difficulty='MORIARTY',
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
            is_pinned=True,
            persona_tactic='sql_syntax_select',
            source_kind='manual',
            use_count=0,
            created_at=__import__('datetime').datetime.now(),
        )
        self.assertEqual(response.persona_tactic, 'sql_syntax_select')


class RuntimeHydrationTests(unittest.TestCase):
    def test_model_to_runtime_preserves_persona_tactic_when_set(self):
        record = SimpleNamespace(
            synthetic_input='log my meal',
            name='t',
            difficulty='MORIARTY',
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
            persona_tactic='sql_syntax_destructive',
        )
        runtime = model_to_runtime(record)
        self.assertEqual(getattr(runtime, 'persona_tactic', None), 'sql_syntax_destructive')

    def test_model_to_runtime_when_persona_tactic_missing(self):
        record = SimpleNamespace(
            synthetic_input='log my meal',
            name='t',
            difficulty='MEDIUM',
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
            persona_tactic=None,
        )
        runtime = model_to_runtime(record)
        # Legacy cases don't set the attribute; getattr returns default None
        self.assertIsNone(getattr(runtime, 'persona_tactic', None))

    def test_runtime_to_create_payload_carries_persona_tactic(self):
        test_case = AdversarialTestCase(
            synthetic_input='log my meal',
            expected_behavior='',
            difficulty='MORIARTY',
            persona_labels=['moriarty'],
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
        )
        setattr(test_case, 'persona_tactic', 'prompt_override')
        payload = runtime_to_create_payload(test_case)
        self.assertEqual(payload.persona_tactic, 'prompt_override')

    def test_runtime_to_create_payload_explicit_overrides_attribute(self):
        test_case = AdversarialTestCase(
            synthetic_input='log my meal',
            expected_behavior='',
            difficulty='MORIARTY',
            persona_labels=['moriarty'],
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
        )
        setattr(test_case, 'persona_tactic', 'prompt_override')
        payload = runtime_to_create_payload(test_case, persona_tactic='roleplay')
        self.assertEqual(payload.persona_tactic, 'roleplay')


class PerCaseTacticOverrideTests(unittest.TestCase):
    def _agent_with_moriarty_catalog(self):
        config = get_default_config()
        moriarty = config.persona_by_id(MORIARTY_PERSONA_ID)
        assert moriarty is not None
        return ConversationAgent(
            llm_provider=StubLLM(),
            persona_catalog={MORIARTY_PERSONA_ID: moriarty},
        )

    def _case(self, pinned_tactic=None):
        case = AdversarialTestCase(
            synthetic_input='log my meal',
            expected_behavior='',
            difficulty='MORIARTY',
            persona_labels=['moriarty'],
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
        )
        if pinned_tactic:
            setattr(case, 'persona_tactic', pinned_tactic)
        return case

    def test_no_pin_returns_full_catalog(self):
        agent = self._agent_with_moriarty_catalog()
        case = self._case()
        catalog = agent._persona_catalog_for_case(case)
        self.assertEqual(len(catalog['moriarty'].tactics), 9)

    def test_pinned_tactic_narrows_to_one_tactic(self):
        agent = self._agent_with_moriarty_catalog()
        case = self._case(pinned_tactic='sql_syntax_destructive')
        catalog = agent._persona_catalog_for_case(case)
        ids = [t.id for t in catalog['moriarty'].tactics]
        self.assertEqual(ids, ['sql_syntax_destructive'])

    def test_pin_does_not_mutate_run_level_catalog(self):
        agent = self._agent_with_moriarty_catalog()
        case = self._case(pinned_tactic='prompt_override')
        _ = agent._persona_catalog_for_case(case)
        # The run-level catalog still has all 9 tactics
        self.assertEqual(len(agent.persona_catalog['moriarty'].tactics), 9)

    def test_unknown_pinned_tactic_falls_back_to_full_catalog(self):
        # If someone hydrates a case with a tactic id that's not in the
        # persona's catalog (e.g., tactic was removed from config), keep the
        # original tactics rather than silently emitting no tactics.
        agent = self._agent_with_moriarty_catalog()
        case = self._case(pinned_tactic='no_such_tactic')
        catalog = agent._persona_catalog_for_case(case)
        self.assertEqual(len(catalog['moriarty'].tactics), 9)


if __name__ == '__main__':
    unittest.main()
