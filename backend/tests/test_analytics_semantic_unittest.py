from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
import uuid

from app.services.analytics.extractors.adversarial import extract_adversarial
from app.services.analytics.extractors.batch_thread import extract_batch_thread
from app.services.analytics.extractors.call_quality import extract_call_quality


def _run(*, app_id: str, eval_type: str, batch_name: str | None = None):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid.uuid4(),
        app_id=app_id,
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        eval_type=eval_type,
        status='completed',
        created_at=now,
        completed_at=now,
        duration_ms=1234.0,
        batch_metadata={'name': batch_name} if batch_name else {},
        result={},
        listing_id=None,
        session_id=None,
        evaluator_id=None,
    )


class AnalyticsSemanticExtractorTests(unittest.TestCase):
    def test_batch_thread_extractor_populates_semantic_dimensions(self):
        run = _run(app_id='kaira-bot', eval_type='batch_thread', batch_name='April batch')
        now = datetime.now(timezone.utc)
        thread = SimpleNamespace(
            thread_id='thread-1',
            created_at=now,
            intent_accuracy=1.0,
            worst_correctness='PASS',
            efficiency_verdict='EFFICIENT',
            success_status=True,
            result={
                'thread': {
                    'thread_id': 'thread-1',
                    'duration_seconds': 45,
                    'messages': [{
                        'intent_detected': 'FoodAgent',
                        'intent_query_type': 'logging',
                    }],
                },
                'intent_evaluations': [{
                    'predicted_intent': 'FoodInsightAgent',
                    'predicted_query_type': 'question',
                }],
                'correctness_evaluations': [],
                'efficiency_evaluation': {'verdict': 'EFFICIENT', 'task_completed': True, 'rule_compliance': []},
            },
        )

        fact_set = extract_batch_thread(run, [thread])

        self.assertEqual(fact_set.run_fact.run_name, 'April batch')
        self.assertEqual(len(fact_set.eval_facts), 3)
        for row in fact_set.eval_facts:
            self.assertEqual(row.intent, 'FoodAgent')
            self.assertEqual(row.route, 'FoodInsightAgent')
            self.assertEqual(row.query_type, 'logging')
            self.assertEqual(row.duration_seconds, 45.0)

    def test_call_quality_extractor_populates_agent_dimensions_and_avg_score(self):
        run = _run(app_id='inside-sales', eval_type='call_quality', batch_name='QA wave')
        now = datetime.now(timezone.utc)
        thread = SimpleNamespace(
            thread_id='call-1',
            created_at=now,
            result={
                'call_metadata': {
                    'agent': 'B Himani',
                    'direction': 'outbound',
                    'duration': '120',
                },
                'evaluations': [{
                    'evaluator_name': 'GoodFlip Sales Call QA',
                    'evaluator_id': str(uuid.uuid4()),
                    'output': {'overall_score': 38.5},
                }],
            },
        )

        fact_set = extract_call_quality(run, [thread])

        self.assertEqual(fact_set.run_fact.run_name, 'QA wave')
        self.assertEqual(fact_set.run_fact.avg_score, 38.5)
        self.assertEqual(len(fact_set.eval_facts), 1)
        row = fact_set.eval_facts[0]
        self.assertEqual(row.agent, 'B Himani')
        self.assertEqual(row.direction, 'outbound')
        self.assertEqual(row.duration_seconds, 120.0)

    def test_adversarial_extractor_promotes_difficulty_turns_and_intent(self):
        run = _run(app_id='kaira-bot', eval_type='batch_adversarial', batch_name='Attack run')
        now = datetime.now(timezone.utc)
        case = SimpleNamespace(
            id=7,
            created_at=now,
            result={
                'verdict': 'HARD FAIL',
                'rule_compliance': [],
                'test_case': {'difficulty': 'CRACK'},
                'transcript': {
                    'total_turns': 4,
                    'turns': [{'detected_intent': 'FoodAgent'}],
                },
            },
            goal_achieved=False,
            verdict='HARD FAIL',
            difficulty='CRACK',
            total_turns=4,
        )

        fact_set = extract_adversarial(run, [case])

        self.assertEqual(fact_set.run_fact.run_name, 'Attack run')
        self.assertEqual(len(fact_set.eval_facts), 1)
        row = fact_set.eval_facts[0]
        self.assertEqual(row.difficulty, 'CRACK')
        self.assertEqual(row.total_turns, 4)
        self.assertEqual(row.intent, 'FoodAgent')
        self.assertEqual(row.route, 'FoodAgent')
