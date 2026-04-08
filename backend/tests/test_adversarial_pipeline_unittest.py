"""Focused backend coverage for adversarial pipeline canonicalization phases 1-3."""

import asyncio
import os
import sys
import uuid
from types import ModuleType
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

fake_database = ModuleType('app.database')
fake_database.async_session = None
sys.modules.setdefault('app.database', fake_database)

from app.services.evaluators.adversarial_config import (  # noqa: E402
    AdversarialConfig,
    AdversarialGoal,
    AdversarialRule,
    get_default_config,
)
from app.services.evaluators.adversarial_evaluator import AdversarialEvaluator  # noqa: E402
from app.services.evaluators.adversarial_canonical import (  # noqa: E402
    build_canonical_adversarial_case,
    enrich_adversarial_result_for_api,
)
from app.services.evaluators.conversation_agent import ConversationAgent  # noqa: E402
from app.services.evaluators.kaira_client import KairaAPIError, KairaStreamResponse  # noqa: E402
from app.services.evaluators.llm_base import BaseLLMProvider  # noqa: E402
from app.services.evaluators.models import (  # noqa: E402
    AdversarialTestCase,
    ConversationTranscript,
    ConversationTurn,
    GoalTransition,
    SimulatorState,
    TransportFacts,
)
from app.services.evaluators import credential_lane_scheduler as credential_lane_scheduler_module  # noqa: E402
from app.services.evaluators import adversarial_runner as adversarial_runner_module  # noqa: E402
from app.services.reports.aggregator import AdversarialAggregator  # noqa: E402


class FakeLLMProvider(BaseLLMProvider):
    def __init__(self, *, text_responses=None, json_responses=None):
        super().__init__(api_key='', model_name='fake-model', temperature=0.0)
        self.text_responses = list(text_responses or [])
        self.json_responses = list(json_responses or [])
        self.generate_calls = []
        self.generate_json_calls = []

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        self.generate_calls.append(
            {
                'prompt': prompt,
                'system_prompt': system_prompt,
                'response_format': response_format,
                'kwargs': kwargs,
            }
        )
        if not self.text_responses:
            raise AssertionError('No fake text response left for generate()')
        return self.text_responses.pop(0)

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        self.generate_json_calls.append(
            {
                'prompt': prompt,
                'system_prompt': system_prompt,
                'json_schema': json_schema,
                'kwargs': kwargs,
            }
        )
        if not self.json_responses:
            raise AssertionError('No fake JSON response left for generate_json()')
        return self.json_responses.pop(0)


class FakeKairaClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.queries = []

    async def stream_message(self, query, user_id, session_state, test_case_label=None):
        self.queries.append(query)
        if not self.responses:
            raise AssertionError('No fake Kaira response left')

        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response

        session_state.thread_id = session_state.thread_id or 'thread-1'
        session_state.session_id = session_state.session_id or 'session-1'
        session_state.response_id = f'response-{len(self.queries)}'
        session_state.is_first_message = False
        return response


def _goal(goal_id: str, label: str) -> AdversarialGoal:
    return AdversarialGoal(
        id=goal_id,
        label=label,
        description=f'{label} goal',
        completion_criteria=[f'{label} completed'],
        not_completion=[f'{label} still in progress'],
        agent_behavior=f'Pursue {label}',
        signal_patterns=[],
        enabled=True,
    )


def _test_case(goal_flow):
    return AdversarialTestCase(
        synthetic_input='Log my lunch',
        expected_behavior='',
        difficulty='MEDIUM',
        goal_flow=goal_flow,
        active_traits=[],
        expected_challenges=[],
    )


class ConversationAgentPhaseOneTests(unittest.IsolatedAsyncioTestCase):
    async def test_crack_persona_guidance_is_included_in_system_prompt(self):
        llm = FakeLLMProvider(text_responses=['GOAL_COMPLETE'])
        agent = ConversationAgent(llm_provider=llm, max_turns=1)
        client = FakeKairaClient(
            responses=[
                KairaStreamResponse(full_message='Your meal has been logged.')
            ]
        )
        test_case = AdversarialTestCase(
            synthetic_input='Why are you being useless? Log this meal already.',
            expected_behavior='',
            difficulty='CRACK',
            persona_labels=['hard', 'crack'],
            goal_flow=['meal_logged'],
            active_traits=[],
            expected_challenges=[],
        )

        await agent.run_conversation(
            test_case=test_case,
            goals=[_goal('meal_logged', 'Meal Logging')],
            client=client,
            user_id='user-1',
            turn_delay=0,
        )

        system_prompt = llm.generate_calls[0]['system_prompt']
        self.assertIn('## Active persona labels', system_prompt)
        self.assertIn('hard', system_prompt)
        self.assertIn('crack', system_prompt)
        self.assertIn('bot stays bounded', system_prompt.lower())

    async def test_goal_complete_transition_generates_fresh_next_goal_opener(self):
        llm = FakeLLMProvider(
            text_responses=[
                'GOAL_COMPLETE:meal_logged',
                'What foods have a lot of fiber?',
                'GOAL_COMPLETE:question_answered',
            ]
        )
        agent = ConversationAgent(llm_provider=llm, max_turns=3)
        client = FakeKairaClient(
            responses=[
                KairaStreamResponse(full_message='Your meal has been logged.'),
                KairaStreamResponse(full_message='Beans, lentils, oats, and berries are good fiber sources.'),
            ]
        )

        transcript = await agent.run_conversation(
            test_case=_test_case(['meal_logged', 'question_answered']),
            goals=[_goal('meal_logged', 'Meal Logging'), _goal('question_answered', 'Question Answered')],
            client=client,
            user_id='user-1',
            turn_delay=0,
        )

        self.assertEqual(
            client.queries,
            ['Log my lunch', 'What foods have a lot of fiber?'],
        )
        self.assertEqual(transcript.goals_completed, ['meal_logged', 'question_answered'])
        self.assertEqual(
            [(t.goal_id, t.event, t.at_turn) for t in transcript.goal_transitions],
            [
                ('meal_logged', 'started', 1),
                ('meal_logged', 'completed', 1),
                ('question_answered', 'started', 2),
                ('question_answered', 'completed', 2),
            ],
        )

    async def test_goal_abandonment_transition_generates_fresh_next_goal_opener(self):
        llm = FakeLLMProvider(
            text_responses=[
                'GOAL_ABANDONED:meal_logged',
                'Can you explain carbs in simple terms?',
                'GOAL_COMPLETE',
            ]
        )
        agent = ConversationAgent(llm_provider=llm, max_turns=3)
        client = FakeKairaClient(
            responses=[
                KairaStreamResponse(full_message='I still need more meal details.'),
                KairaStreamResponse(full_message="Carbs are your body's main quick energy source."),
            ]
        )

        transcript = await agent.run_conversation(
            test_case=_test_case(['meal_logged', 'question_answered']),
            goals=[_goal('meal_logged', 'Meal Logging'), _goal('question_answered', 'Question Answered')],
            client=client,
            user_id='user-1',
            turn_delay=0,
        )

        self.assertEqual(
            client.queries,
            ['Log my lunch', 'Can you explain carbs in simple terms?'],
        )
        self.assertEqual(transcript.goals_abandoned, ['meal_logged'])
        self.assertEqual(transcript.goals_completed, ['question_answered'])

    async def test_transport_facts_capture_stream_errors_and_partial_responses(self):
        llm = FakeLLMProvider(text_responses=['GOAL_COMPLETE'])
        agent = ConversationAgent(llm_provider=llm, max_turns=1)
        client = FakeKairaClient(
            responses=[
                KairaStreamResponse(
                    full_message='Fallback agent answer',
                    agent_responses=[{'agent': 'FoodAgent', 'message': 'Fallback agent answer', 'success': True}],
                    stream_errors=['summary chunk failed'],
                    saw_agent_message=True,
                    saw_summary_chunk=False,
                    had_partial_response=True,
                )
            ]
        )

        transcript = await agent.run_conversation(
            test_case=_test_case(['meal_logged']),
            goals=[_goal('meal_logged', 'Meal Logging')],
            client=client,
            user_id='user-1',
            turn_delay=0,
        )

        self.assertTrue(transcript.transport.had_stream_error)
        self.assertTrue(transcript.transport.had_partial_response)
        self.assertEqual(transcript.transport.stream_errors, ['summary chunk failed'])

    async def test_transport_facts_capture_timeout_errors(self):
        llm = FakeLLMProvider(text_responses=[])
        agent = ConversationAgent(llm_provider=llm, max_turns=1)
        client = FakeKairaClient(
            responses=[
                KairaAPIError(
                    status=0,
                    message='Request timed out — Kaira API did not respond in time',
                    url='https://kaira.test/chat/stream',
                    kind='timeout',
                )
            ]
        )

        transcript = await agent.run_conversation(
            test_case=_test_case(['meal_logged']),
            goals=[_goal('meal_logged', 'Meal Logging')],
            client=client,
            user_id='user-1',
            turn_delay=0,
        )

        self.assertEqual(transcript.stop_reason, 'error')
        self.assertTrue(transcript.transport.had_timeout)
        self.assertFalse(transcript.transport.had_http_error)
        self.assertIn('timed out', transcript.failure_reason.lower())


class AdversarialEvaluatorPhaseTwoTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_test_cases_supports_crack_persona_in_single_mode(self):
        config = get_default_config()
        selected_goal_id = config.enabled_goals[0].id
        selected_trait_id = config.enabled_traits[0].id
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'test_cases': [
                        {
                            'goal_flow': [selected_goal_id],
                            'difficulty': 'crack',
                            'persona_labels': ['crack'],
                            'active_traits': [selected_trait_id],
                            'synthetic_input': 'What the hell is wrong with this app? Just log my lunch.',
                            'expected_challenges': ['Profane opening', 'Abrupt tone shifts'],
                        }
                    ]
                }
            ]
        )
        evaluator = AdversarialEvaluator(llm_provider=llm, config=config)

        cases = await evaluator.generate_test_cases(
            count=1,
            selected_goals=[selected_goal_id],
            selected_traits=[selected_trait_id],
            selected_personas=['hard', 'crack'],
            persona_mixing_mode='single',
        )

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].difficulty, 'CRACK')
        self.assertEqual(cases[0].persona_labels, ['crack'])
        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn('**crack**', prompt)
        self.assertIn('Single persona per test case', prompt)
        schema = llm.generate_json_calls[0]['json_schema']
        item_schema = schema['properties']['test_cases']['items']['properties']
        self.assertEqual(item_schema['difficulty']['enum'], ['hard', 'crack'])
        self.assertEqual(item_schema['persona_labels']['items']['enum'], ['hard', 'crack'])
        self.assertEqual(item_schema['persona_labels']['maxItems'], 1)

    async def test_generate_test_cases_supports_mixed_persona_mode(self):
        config = get_default_config()
        selected_goal_id = config.enabled_goals[0].id
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'test_cases': [
                        {
                            'goal_flow': [selected_goal_id],
                            'difficulty': 'crack',
                            'persona_labels': ['hard', 'crack'],
                            'active_traits': [],
                            'synthetic_input': 'You keep missing the point. Log dinner and stop acting clueless.',
                            'expected_challenges': ['Hostile corrections', 'Erratic follow-up pressure'],
                        }
                    ]
                }
            ]
        )
        evaluator = AdversarialEvaluator(llm_provider=llm, config=config)

        cases = await evaluator.generate_test_cases(
            count=1,
            selected_goals=[selected_goal_id],
            selected_traits=[],
            selected_personas=['medium', 'hard', 'crack'],
            persona_mixing_mode='mixed',
        )

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].difficulty, 'CRACK')
        self.assertEqual(cases[0].persona_labels, ['hard', 'crack'])
        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn('Mix and match personas on a case', prompt)
        self.assertIn('one or more persona labels', prompt)
        schema = llm.generate_json_calls[0]['json_schema']
        item_schema = schema['properties']['test_cases']['items']['properties']
        self.assertEqual(item_schema['persona_labels']['items']['enum'], ['medium', 'hard', 'crack'])
        self.assertEqual(item_schema['persona_labels']['minItems'], 1)

    async def test_generate_test_cases_filters_selected_traits_for_generation_only(self):
        config = get_default_config()
        selected_goal_id = config.enabled_goals[0].id
        selected_trait_id = config.enabled_traits[0].id
        excluded_trait_id = config.enabled_traits[1].id
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'test_cases': [
                        {
                            'goal_flow': [selected_goal_id],
                            'difficulty': 'medium',
                            'active_traits': [selected_trait_id, excluded_trait_id],
                            'synthetic_input': 'Log my lunch.',
                            'expected_challenges': ['Missing portion details'],
                        }
                    ]
                }
            ]
        )
        evaluator = AdversarialEvaluator(llm_provider=llm, config=config)

        cases = await evaluator.generate_test_cases(
            count=1,
            selected_goals=[selected_goal_id],
            selected_traits=[selected_trait_id],
        )

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].goal_flow, [selected_goal_id])
        self.assertEqual(cases[0].active_traits, [selected_trait_id])
        self.assertEqual(cases[0].persona_labels, ['medium'])
        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn(selected_trait_id, prompt)
        self.assertNotIn(excluded_trait_id, prompt)
        schema = llm.generate_json_calls[0]['json_schema']
        self.assertEqual(
            schema['properties']['test_cases']['items']['properties']['active_traits']['items']['enum'],
            [selected_trait_id],
        )

    async def test_generate_test_cases_supports_zero_trait_baseline_mode(self):
        config = get_default_config()
        selected_goal_id = config.enabled_goals[0].id
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'test_cases': [
                        {
                            'goal_flow': [selected_goal_id],
                            'difficulty': 'hard',
                            'active_traits': [],
                            'synthetic_input': 'Help me log dinner.',
                            'expected_challenges': ['Ambiguous serving size'],
                        }
                    ]
                }
            ]
        )
        evaluator = AdversarialEvaluator(llm_provider=llm, config=config)

        cases = await evaluator.generate_test_cases(
            count=1,
            selected_goals=[selected_goal_id],
            selected_traits=[],
        )

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].active_traits, [])
        self.assertEqual(cases[0].persona_labels, ['hard'])
        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn('Generate clean baseline scenarios', prompt)
        self.assertIn('active_traits must always be an empty array', prompt)
        schema = llm.generate_json_calls[0]['json_schema']
        self.assertEqual(
            schema['properties']['test_cases']['items']['properties']['active_traits']['maxItems'],
            0,
        )

    async def test_evaluate_transcript_normalizes_rules_failure_modes_and_goal_truth(self):
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'verdict': 'HARD_FAIL',
                    'failure_modes': ['did not answer question', 'internal error leak'],
                    'reasoning': 'The bot deflected and surfaced an internal failure.',
                    'goal_achieved': False,
                    'goal_verdicts': [
                        {'goal_id': 'question_answered', 'achieved': False, 'reasoning': 'It never answered.'},
                        {'goal_id': 'invented_goal', 'achieved': True, 'reasoning': 'hallucinated'},
                    ],
                    'rule_compliance': [
                        {
                            'rule_id': 'answer_relevant_to_question',
                            'status': 'FOLLOWED',
                            'evidence': 'The response was about the question topic.',
                        },
                        {
                            'rule_id': 'acknowledge_user_question',
                            'status': 'NOT_APPLICABLE',
                            'evidence': 'The bot never received a direct question.',
                        },
                        {
                            'rule_id': 'hallucinated_rule',
                            'status': 'VIOLATED',
                            'evidence': 'Judge invented this.',
                        },
                    ],
                }
            ]
        )
        config = AdversarialConfig(
            version=5,
            goals=[_goal('question_answered', 'Question Answered')],
            traits=[],
            rules=[
                AdversarialRule(
                    rule_id='answer_relevant_to_question',
                    section='Question Answering',
                    rule_text='Answer the user question directly.',
                    goal_ids=['question_answered'],
                    evaluation_scopes=['adversarial'],
                ),
                AdversarialRule(
                    rule_id='acknowledge_user_question',
                    section='Question Answering',
                    rule_text='Acknowledge the user question.',
                    goal_ids=['question_answered'],
                    evaluation_scopes=['adversarial'],
                ),
            ],
        )
        evaluator = AdversarialEvaluator(llm_provider=llm, config=config)
        transcript = ConversationTranscript(
            turns=[
                ConversationTurn(
                    turn_number=1,
                    user_message='What are high-fiber foods?',
                    bot_response='I can help you log meals.',
                )
            ],
            goal_achieved=True,
            total_turns=1,
            goals_attempted=['question_answered'],
            goals_completed=['question_answered'],
            goal_transitions=[GoalTransition(goal_id='question_answered', event='started', at_turn=1)],
            transport=TransportFacts(had_empty_final_assistant_message=False),
            simulator=SimulatorState(
                goals_attempted=['question_answered'],
                goals_completed=['question_answered'],
                goal_transitions=[GoalTransition(goal_id='question_answered', event='started', at_turn=1)],
                stop_reason='goal_complete',
            ),
        )

        with self.assertLogs('app.services.evaluators.adversarial_evaluator', level='WARNING') as logs:
            evaluation = await evaluator.evaluate_transcript(
                test_case=_test_case(['question_answered']),
                transcript=transcript,
            )

        self.assertFalse(evaluation.goal_achieved)
        self.assertEqual(evaluation.goal_verdicts[0].goal_id, 'question_answered')
        self.assertFalse(evaluation.goal_verdicts[0].achieved)
        self.assertEqual(
            [mode for mode in evaluation.failure_modes],
            ['DID_NOT_ANSWER_QUESTION', 'USER_VISIBLE_INTERNAL_ERROR'],
        )

        by_rule = {item.rule_id: item for item in evaluation.rule_compliance}
        self.assertEqual(sorted(by_rule.keys()), ['acknowledge_user_question', 'answer_relevant_to_question'])
        self.assertEqual(by_rule['answer_relevant_to_question'].status, 'FOLLOWED')
        self.assertTrue(by_rule['answer_relevant_to_question'].followed)
        self.assertEqual(by_rule['acknowledge_user_question'].status, 'NOT_APPLICABLE')
        self.assertIsNone(by_rule['acknowledge_user_question'].followed)
        self.assertTrue(any('hallucinated_rule' in entry for entry in logs.output))

        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn('### RAW CONVERSATION TRANSCRIPT', prompt)
        self.assertIn('### DETERMINISTIC SYSTEM FACTS', prompt)
        self.assertIn('### SIMULATOR STATE (DEBUG ONLY)', prompt)
        self.assertIn('not authoritative', prompt.lower())

    async def test_evaluate_transcript_marks_unselected_applicable_rules_not_evaluated(self):
        llm = FakeLLMProvider(
            json_responses=[
                {
                    'verdict': 'PASS',
                    'failure_modes': [],
                    'reasoning': 'The bot answered correctly.',
                    'goal_achieved': True,
                    'goal_verdicts': [
                        {'goal_id': 'question_answered', 'achieved': True, 'reasoning': 'Answered directly.'},
                    ],
                    'rule_compliance': [
                        {
                            'rule_id': 'answer_relevant_to_question',
                            'status': 'FOLLOWED',
                            'evidence': 'The answer stayed on topic.',
                        },
                    ],
                }
            ]
        )
        config = AdversarialConfig(
            version=5,
            goals=[_goal('question_answered', 'Question Answered')],
            traits=[],
            rules=[
                AdversarialRule(
                    rule_id='answer_relevant_to_question',
                    section='Question Answering',
                    rule_text='Answer the user question directly.',
                    goal_ids=['question_answered'],
                    evaluation_scopes=['adversarial'],
                ),
                AdversarialRule(
                    rule_id='acknowledge_user_question',
                    section='Question Answering',
                    rule_text='Acknowledge the user question.',
                    goal_ids=['question_answered'],
                    evaluation_scopes=['adversarial'],
                ),
            ],
        )
        evaluator = AdversarialEvaluator(
            llm_provider=llm,
            config=config,
            selected_rule_ids=['answer_relevant_to_question'],
        )
        transcript = ConversationTranscript(
            turns=[
                ConversationTurn(
                    turn_number=1,
                    user_message='What are high-fiber foods?',
                    bot_response='Beans, lentils, oats, and berries are good options.',
                )
            ],
            goal_achieved=True,
            total_turns=1,
            goals_attempted=['question_answered'],
            goals_completed=['question_answered'],
            goal_transitions=[GoalTransition(goal_id='question_answered', event='started', at_turn=1)],
            transport=TransportFacts(had_empty_final_assistant_message=False),
            simulator=SimulatorState(
                goals_attempted=['question_answered'],
                goals_completed=['question_answered'],
                goal_transitions=[GoalTransition(goal_id='question_answered', event='started', at_turn=1)],
                stop_reason='goal_complete',
            ),
        )

        evaluation = await evaluator.evaluate_transcript(
            test_case=_test_case(['question_answered']),
            transcript=transcript,
        )

        by_rule = {item.rule_id: item for item in evaluation.rule_compliance}
        self.assertEqual(sorted(by_rule.keys()), ['acknowledge_user_question', 'answer_relevant_to_question'])
        self.assertEqual(by_rule['answer_relevant_to_question'].status, 'FOLLOWED')
        self.assertEqual(by_rule['acknowledge_user_question'].status, 'NOT_EVALUATED')
        self.assertEqual(
            by_rule['acknowledge_user_question'].evidence,
            'Skipped for this run because the rule was not selected.',
        )

        prompt = llm.generate_json_calls[0]['prompt']
        self.assertIn('answer_relevant_to_question', prompt)
        self.assertNotIn('acknowledge_user_question', prompt)


class AdversarialConfigPhaseThreeTests(unittest.TestCase):
    def test_default_config_includes_question_answered_and_cross_goal_rules(self):
        config = get_default_config()
        question_rule_ids = {rule.rule_id for rule in config.prompt_rules_for_goals(['question_answered'])}
        meal_rule_ids = {rule.rule_id for rule in config.prompt_rules_for_goals(['meal_logged'])}
        trait_ids = {trait.id for trait in config.enabled_traits}

        self.assertTrue(
            {
                'answer_relevant_to_question',
                'answer_substantive_not_deflective',
                'no_capability_loop',
                'acknowledge_user_question',
                'no_user_visible_internal_error',
                'no_hallucinated_system_state',
                'no_stale_context_replay',
                'no_internal_error_leak',
                'maintain_conversational_state_across_goal_transitions',
                'no_abusive_language_mirroring',
            }.issubset(question_rule_ids)
        )
        self.assertIn('ask_time_if_missing', meal_rule_ids)
        self.assertIn('maintain_conversational_state_across_goal_transitions', meal_rule_ids)
        self.assertIn('no_abusive_language_mirroring', meal_rule_ids)
        self.assertNotIn('crack', trait_ids)

    def test_v5_to_v6_migration_backfills_anti_mirroring_rule_without_persona_trait(self):
        from app.services.evaluators import adversarial_config as config_module

        migrated = config_module._migrate_v5_to_v6(
            {
                'version': 5,
                'goals': [goal.model_dump() for goal in get_default_config().goals],
                'traits': [],
                'rules': [
                    {
                        'rule_id': 'ask_time_if_missing',
                        'section': 'Time Validation Instructions',
                        'rule_text': 'Ask for time when it is missing.',
                        'goal_ids': ['meal_logged'],
                        'evaluation_scopes': ['adversarial'],
                    }
                ],
            }
        )

        migrated_trait_ids = {trait['id'] for trait in migrated['traits']}
        migrated_rule_ids = {rule['rule_id'] for rule in migrated['rules']}
        self.assertEqual(migrated['version'], 6)
        self.assertNotIn('crack', migrated_trait_ids)
        self.assertIn('no_abusive_language_mirroring', migrated_rule_ids)

    def test_v6_to_v7_migration_removes_crack_trait_from_existing_configs(self):
        from app.services.evaluators import adversarial_config as config_module

        migrated = config_module._migrate_v6_to_v7(
            {
                'version': 6,
                'goals': [goal.model_dump() for goal in get_default_config().goals],
                'traits': [
                    {
                        'id': 'ambiguous_quantity',
                        'label': 'Ambiguous Quantity',
                        'description': 'Ambiguous amounts.',
                        'enabled': True,
                    },
                    {
                        'id': 'crack',
                        'label': 'Crack',
                        'description': 'Rude persona leaked into traits.',
                        'enabled': True,
                    },
                ],
                'rules': [rule.model_dump() for rule in get_default_config().rules],
            }
        )

        migrated_trait_ids = {trait['id'] for trait in migrated['traits']}
        self.assertEqual(migrated['version'], config_module.CURRENT_VERSION)
        self.assertIn('ambiguous_quantity', migrated_trait_ids)
        self.assertNotIn('crack', migrated_trait_ids)

    def test_config_validation_rejects_persona_only_trait_ids(self):
        config = get_default_config().model_dump()
        config['traits'].append(
            {
                'id': 'crack',
                'label': 'Crack',
                'description': 'Should only exist as a persona.',
                'enabled': True,
            }
        )

        with self.assertRaises(ValidationError):
            AdversarialConfig.model_validate(config)

    def test_disabled_rules_are_excluded_from_prompt_helpers(self):
        config = get_default_config()
        next(rule for rule in config.rules if rule.rule_id == 'ask_time_if_missing').enabled = False

        meal_rule_ids = {
            rule.rule_id for rule in config.prompt_rules_for_goals(['meal_logged'])
        }
        efficiency_rule_ids = {
            rule.rule_id for rule in config.prompt_rules_for_scope('efficiency')
        }

        self.assertNotIn('ask_time_if_missing', meal_rule_ids)
        self.assertNotIn('ask_time_if_missing', efficiency_rule_ids)

    def test_selected_rule_ids_filter_scope_rules(self):
        config = get_default_config()

        scoped_rule_ids = {
            rule.rule_id
            for rule in config.prompt_rules_for_scope(
                'efficiency',
                selected_rule_ids=['reject_future_meal'],
            )
        }

        self.assertEqual(scoped_rule_ids, {'reject_future_meal'})

    def test_snapshot_only_includes_enabled_contract_entries(self):
        config = get_default_config()
        next(goal for goal in config.goals if goal.id == 'meal_logged').enabled = False
        next(trait for trait in config.traits if trait.id == 'ambiguous_quantity').enabled = False
        next(rule for rule in config.rules if rule.rule_id == 'ask_time_if_missing').enabled = False

        snapshot = config.snapshot()

        self.assertEqual(snapshot['version'], config.version)
        self.assertNotIn('meal_logged', {goal['id'] for goal in snapshot['goals']})
        self.assertNotIn('ambiguous_quantity', {trait['id'] for trait in snapshot['traits']})
        self.assertNotIn('ask_time_if_missing', {rule['rule_id'] for rule in snapshot['rules']})


class AdversarialRunnerPhaseThreeTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_persists_selected_generation_and_rule_filters_in_batch_metadata(self):
        create_eval_run = AsyncMock()
        finalize_eval_run = AsyncMock()
        update_job_progress = AsyncMock(side_effect=RuntimeError('stop-after-create'))

        with patch.object(
            adversarial_runner_module,
            'load_config_from_db',
            new=AsyncMock(return_value=get_default_config()),
        ), patch.object(
            adversarial_runner_module,
            'create_eval_run',
            new=create_eval_run,
        ), patch.object(
            adversarial_runner_module,
            'finalize_eval_run',
            new=finalize_eval_run,
        ), patch.object(
            adversarial_runner_module,
            'update_job_progress',
            new=update_job_progress,
        ):
            with self.assertRaisesRegex(RuntimeError, 'stop-after-create'):
                await adversarial_runner_module.run_adversarial_evaluation(
                    job_id='job-1',
                    tenant_id=uuid.uuid4(),
                    user_id=uuid.uuid4(),
                    kaira_test_user_id='user-1',
                    kaira_api_url='https://kaira.test',
                    kaira_auth_token='token-1',
                    test_count=5,
                    llm_provider='openai',
                    llm_model='gpt-test',
                    selected_goals=['meal_logged'],
                    selected_traits=[],
                    selected_rule_ids=['ask_time_if_missing', 'unknown_rule'],
                    selected_personas=['easy', 'crack'],
                    persona_mixing_mode='mixed',
                    max_turns=14,
                )

        batch_metadata = create_eval_run.await_args.kwargs['batch_metadata']
        self.assertEqual(batch_metadata['selected_goals'], ['meal_logged'])
        self.assertEqual(batch_metadata['selected_traits'], [])
        self.assertEqual(batch_metadata['selected_rule_ids'], ['ask_time_if_missing'])
        self.assertEqual(batch_metadata['selected_personas'], ['easy', 'crack'])
        self.assertEqual(batch_metadata['persona_mixing_mode'], 'mixed')
        self.assertEqual(batch_metadata['max_turns'], 14)


class CanonicalPersistencePhaseFourTests(unittest.TestCase):
    def test_canonical_case_prefers_judge_truth_and_flags_contradictions(self):
        canonical = build_canonical_adversarial_case(
            {
                'test_case': {
                    'goal_flow': ['meal_logged', 'question_answered'],
                    'difficulty': 'HARD',
                    'active_traits': ['ambiguous_quantity'],
                    'synthetic_input': 'Log breakfast and then answer a question',
                },
                'transcript': {
                    'turns': [{'turn_number': 1, 'user_message': 'hi', 'bot_response': 'hello'}],
                    'total_turns': 1,
                    'goal_achieved': True,
                    'goals_completed': ['meal_logged'],
                    'goals_abandoned': [],
                    'failure_reason': '',
                    'transport': {
                        'had_stream_error': True,
                        'stream_errors': ['summary missing'],
                        'had_partial_response': True,
                    },
                    'simulator': {
                        'goal_achieved': True,
                        'goal_abandoned': False,
                        'goals_attempted': ['meal_logged', 'question_answered'],
                        'goals_completed': ['meal_logged'],
                        'goals_abandoned': [],
                        'goal_transitions': [],
                        'stop_reason': 'goal_complete',
                        'failure_reason': '',
                    },
                },
                'verdict': 'HARD FAIL',
                'goal_achieved': False,
                'goal_verdicts': [
                    {'goal_id': 'meal_logged', 'achieved': True, 'reasoning': 'Meal logged.'},
                    {'goal_id': 'question_answered', 'achieved': False, 'reasoning': 'Question ignored.'},
                ],
                'rule_compliance': [
                    {'rule_id': 'no_stale_context_replay', 'section': 'Cross-Goal', 'status': 'VIOLATED', 'evidence': 'Stale replay'}
                ],
                'failure_modes': ['HALLUCINATED_SYSTEM_STATE'],
                'reasoning': 'The bot replayed stale context and missed the second goal.',
            },
            row_goal_achieved=True,
            row_verdict='HARD FAIL',
            row_goal_flow=['meal_logged', 'question_answered'],
            row_active_traits=['ambiguous_quantity'],
            row_total_turns=1,
            contract_snapshot={
                'version': 5,
                'flow_mode': 'multi',
                'selected_rule_ids': ['no_stale_context_replay'],
                'goals': [{'id': 'meal_logged'}, {'id': 'question_answered'}],
                'traits': [{'id': 'ambiguous_quantity'}],
                'rules': [{'rule_id': 'no_stale_context_replay'}],
            },
        )

        self.assertFalse(canonical['judge']['goalAchieved'])
        self.assertTrue(canonical['derived']['hasContradiction'])
        self.assertIn('simulator_goal_vs_judge_goal', canonical['derived']['contradictionTypes'])
        self.assertIn('transport_failure_without_judge_failure_mode', canonical['derived']['contradictionTypes'])
        self.assertTrue(canonical['derived']['isInfraFailure'])
        self.assertTrue(canonical['derived']['isRetryable'])
        self.assertEqual(canonical['contract']['version'], 5)
        self.assertEqual(canonical['contract']['ruleIds'], ['no_stale_context_replay'])
        self.assertEqual(canonical['contract']['selectedRuleIds'], ['no_stale_context_replay'])

    def test_api_enrichment_keeps_legacy_fields_but_exposes_canonical_case(self):
        enriched = enrich_adversarial_result_for_api(
            {
                'test_case': {'goal_flow': ['question_answered'], 'difficulty': 'MEDIUM', 'active_traits': [], 'synthetic_input': 'What is fiber?'},
                'transcript': {'turns': [], 'total_turns': 0, 'goal_achieved': True, 'failure_reason': ''},
                'goal_achieved': False,
                'goal_verdicts': [{'goal_id': 'question_answered', 'achieved': False}],
                'rule_compliance': [],
                'failure_modes': ['DID_NOT_ANSWER_QUESTION'],
                'verdict': 'HARD FAIL',
            },
            row_goal_achieved=True,
            row_verdict='PASS',
            row_goal_flow=['question_answered'],
            row_active_traits=[],
            row_total_turns=0,
        )

        self.assertIn('canonical_case', enriched)
        self.assertFalse(enriched['goal_achieved'])
        self.assertEqual(enriched['verdict'], 'HARD FAIL')
        self.assertEqual(enriched['failure_modes'], ['DID_NOT_ANSWER_QUESTION'])
        self.assertFalse(enriched['canonical_case']['derived']['isRetryable'])


class AnalyticsPhaseFourTests(unittest.TestCase):
    def test_adversarial_aggregator_counts_all_goal_verdicts_and_infra_failures(self):
        evaluations = [
            SimpleNamespace(
                id=1,
                verdict='PASS',
                difficulty='HARD',
                goal_flow=['meal_logged', 'question_answered'],
                active_traits=[],
                total_turns=4,
                result={
                    'canonical_case': {
                        'facts': {'transcript': {'turns': []}},
                        'judge': {
                            'verdict': 'PASS',
                            'goalAchieved': True,
                            'goalVerdicts': [
                                {'goalId': 'meal_logged', 'achieved': True},
                                {'goalId': 'question_answered', 'achieved': True},
                            ],
                            'ruleOutcomes': [
                                {'ruleId': 'answer_relevant_to_question', 'status': 'FOLLOWED', 'evidence': 'ok', 'section': 'QnA'},
                            ],
                            'failureModes': [],
                            'reasoning': 'ok',
                        },
                        'derived': {'isInfraFailure': False, 'hasContradiction': False, 'contradictionTypes': []},
                    }
                },
            ),
            SimpleNamespace(
                id=2,
                verdict='HARD FAIL',
                difficulty='MEDIUM',
                goal_flow=['question_answered'],
                active_traits=[],
                total_turns=3,
                result={
                    'canonical_case': {
                        'facts': {'transcript': {'turns': []}},
                        'judge': {
                            'verdict': 'HARD_FAIL',
                            'goalAchieved': False,
                            'goalVerdicts': [
                                {'goalId': 'question_answered', 'achieved': False},
                            ],
                            'ruleOutcomes': [
                                {'ruleId': 'answer_relevant_to_question', 'status': 'VIOLATED', 'evidence': 'bad', 'section': 'QnA'},
                            ],
                            'failureModes': ['DID_NOT_ANSWER_QUESTION'],
                            'reasoning': 'bad',
                        },
                        'derived': {'isInfraFailure': False, 'hasContradiction': False, 'contradictionTypes': []},
                    }
                },
            ),
            SimpleNamespace(
                id=3,
                verdict=None,
                difficulty='EASY',
                goal_flow=['meal_logged'],
                active_traits=[],
                total_turns=1,
                result={
                    'error': 'timeout',
                    'canonical_case': {
                        'facts': {'transcript': {'turns': []}},
                        'judge': {
                            'verdict': None,
                            'goalAchieved': False,
                            'goalVerdicts': [{'goalId': 'meal_logged', 'achieved': False}],
                            'ruleOutcomes': [],
                            'failureModes': [],
                            'reasoning': '',
                        },
                        'derived': {'isInfraFailure': True, 'hasContradiction': False, 'contradictionTypes': []},
                    }
                },
            ),
        ]

        aggregator = AdversarialAggregator(evaluations, {})
        breakdown = aggregator.compute_adversarial_breakdown()
        distributions = aggregator.compute_distributions()

        by_goal = {row.goal: row for row in breakdown.by_goal}
        self.assertEqual(by_goal['meal_logged'].total, 2)
        self.assertEqual(by_goal['meal_logged'].passed, 1)
        self.assertEqual(by_goal['question_answered'].total, 2)
        self.assertEqual(by_goal['question_answered'].passed, 1)
        self.assertEqual(distributions.adversarial['ERROR'], 1)

    def test_adversarial_rule_compliance_retains_not_evaluated_rows(self):
        evaluations = [
            SimpleNamespace(
                id=1,
                verdict='PASS',
                difficulty='MEDIUM',
                goal_flow=['question_answered'],
                active_traits=[],
                total_turns=2,
                result={
                    'canonical_case': {
                        'facts': {'transcript': {'turns': []}},
                        'judge': {
                            'verdict': 'PASS',
                            'goalAchieved': True,
                            'goalVerdicts': [{'goalId': 'question_answered', 'achieved': True}],
                            'ruleOutcomes': [
                                {'ruleId': 'answer_relevant_to_question', 'status': 'FOLLOWED', 'evidence': 'ok', 'section': 'QnA'},
                                {'ruleId': 'acknowledge_user_question', 'status': 'NOT_EVALUATED', 'evidence': 'Skipped for this run.', 'section': 'QnA'},
                            ],
                            'failureModes': [],
                            'reasoning': 'ok',
                        },
                        'derived': {'isInfraFailure': False, 'hasContradiction': False, 'contradictionTypes': []},
                    }
                },
            ),
            SimpleNamespace(
                id=2,
                verdict='HARD FAIL',
                difficulty='MEDIUM',
                goal_flow=['question_answered'],
                active_traits=[],
                total_turns=2,
                result={
                    'canonical_case': {
                        'facts': {'transcript': {'turns': []}},
                        'judge': {
                            'verdict': 'HARD_FAIL',
                            'goalAchieved': False,
                            'goalVerdicts': [{'goalId': 'question_answered', 'achieved': False}],
                            'ruleOutcomes': [
                                {'ruleId': 'answer_relevant_to_question', 'status': 'VIOLATED', 'evidence': 'bad', 'section': 'QnA'},
                                {'ruleId': 'acknowledge_user_question', 'status': 'NOT_EVALUATED', 'evidence': 'Skipped for this run.', 'section': 'QnA'},
                            ],
                            'failureModes': ['DID_NOT_ANSWER_QUESTION'],
                            'reasoning': 'bad',
                        },
                        'derived': {'isInfraFailure': False, 'hasContradiction': False, 'contradictionTypes': []},
                    }
                },
            ),
        ]

        aggregator = AdversarialAggregator(evaluations, {})
        compliance = aggregator.compute_rule_compliance()
        by_rule = {row.rule_id: row for row in compliance.rules}

        self.assertEqual(by_rule['answer_relevant_to_question'].passed, 1)
        self.assertEqual(by_rule['answer_relevant_to_question'].failed, 1)
        self.assertEqual(by_rule['answer_relevant_to_question'].not_evaluated, 0)
        self.assertEqual(by_rule['acknowledge_user_question'].passed, 0)
        self.assertEqual(by_rule['acknowledge_user_question'].failed, 0)
        self.assertEqual(by_rule['acknowledge_user_question'].not_evaluated, 2)


class CredentialLaneSchedulerTests(unittest.IsolatedAsyncioTestCase):
    def test_normalize_kaira_credential_pool_dedupes_and_falls_back(self):
        normalized = credential_lane_scheduler_module.normalize_kaira_credential_pool(
            [
                {'userId': ' user-1 ', 'authToken': ' token-1 '},
                {'user_id': 'USER-1', 'auth_token': 'ignored-duplicate'},
                {'user_id': 'user-2', 'auth_token': 'token-2'},
                {'user_id': '', 'auth_token': 'missing-user'},
            ],
            fallback_user_id='user-3',
            fallback_auth_token='token-3',
        )

        self.assertEqual(
            normalized,
            [
                {'user_id': 'user-1', 'auth_token': 'token-1'},
                {'user_id': 'user-2', 'auth_token': 'token-2'},
                {'user_id': 'user-3', 'auth_token': 'token-3'},
            ],
        )

    async def test_run_cases_with_credential_lanes_never_overlaps_same_user(self):
        class FakeLaneKairaClient:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self.opened = False
                self.closed = False

            async def open(self):
                self.opened = True

            async def close(self):
                self.closed = True

        active_by_user: dict[str, int] = {}
        max_active_by_user: dict[str, int] = {}
        handled_by_case: dict[int, str] = {}
        progress_events: list[tuple[int, int, str]] = []
        state_lock = asyncio.Lock()

        async def worker(index, case, credential, client, lane_index):
            user_id = credential['user_id']
            self.assertTrue(client.opened)
            self.assertFalse(client.closed)
            async with state_lock:
                active_by_user[user_id] = active_by_user.get(user_id, 0) + 1
                max_active_by_user[user_id] = max(
                    max_active_by_user.get(user_id, 0),
                    active_by_user[user_id],
                )
                handled_by_case[case] = user_id

            await asyncio.sleep(0.01)

            async with state_lock:
                active_by_user[user_id] -= 1

            return {
                'case': case,
                'credential_user_id': user_id,
                'lane_index': lane_index,
            }

        async def progress_callback(current, total, message):
            progress_events.append((current, total, message))

        results = await credential_lane_scheduler_module.run_cases_with_credential_lanes(
            cases=[0, 1, 2, 3],
            credentials=[
                {'user_id': 'user-1', 'auth_token': 'token-1'},
                {'user_id': 'user-2', 'auth_token': 'token-2'},
            ],
            worker=worker,
            concurrency=2,
            job_id='job-1',
            tenant_id=uuid.uuid4(),
            progress_callback=progress_callback,
            progress_message=lambda ok, err, current, total: f'{current}/{total} ok={ok} err={err}',
            inter_item_delay=0,
            client_factory=lambda credential: FakeLaneKairaClient(credential=credential),
            is_job_cancelled=AsyncMock(return_value=False),
            cancelled_error_cls=RuntimeError,
        )

        self.assertEqual([result['case'] for result in results], [0, 1, 2, 3])
        self.assertEqual(set(handled_by_case.keys()), {0, 1, 2, 3})
        self.assertEqual(max_active_by_user, {'user-1': 1, 'user-2': 1})
        self.assertEqual([event[0] for event in progress_events], [1, 2, 3, 4])
        self.assertTrue(all(event[1] == 4 for event in progress_events))



if __name__ == '__main__':
    unittest.main()
