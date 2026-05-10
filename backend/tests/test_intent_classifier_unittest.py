"""Phase 1A — deterministic intent classifier coverage of Q1-Q10.

The plan's audit set (docs/plans/2026-05-10-sherlock-grounded-routing.md
§Test set) is the regression bar for routing correctness. This file
pins the intent class returned for each question; downstream projection
tests then assert the right table set falls out per intent.
"""
from __future__ import annotations

import unittest

from app.services.sherlock_v3.intent_classifier import (
    ALLOWED_INTENT_CLASSES,
    classify_intent,
)


# (label, question, expected_intent_class)
_AUDIT_SET: list[tuple[str, str, str]] = [
    ('Q1', 'Show evaluation runs by status as a chart', 'aggregate'),
    ('Q2', 'Pass rate trend by week', 'aggregate'),
    ('Q3', 'Find the most recent failed run', 'detail'),
    ('Q4', 'Pass/fail by evaluator', 'fact_grain'),
    ('Q5', 'Top agents by evaluation count', 'fact_grain'),
    ('Q6', 'Most violated criteria this week', 'fact_grain'),
    ('Q7', 'How many runs this month?', 'aggregate'),
    ('Q8', 'Show evaluators not used this month', 'mixed'),
    ('Q9', "What is the latest run's status?", 'detail'),
    ('Q10', 'Average call duration this week', 'fact_grain'),
]


class AuditSetCoverageTests(unittest.TestCase):
    """Q1-Q10 must each map to the intent class documented in the plan."""

    def test_audit_set_each_question(self) -> None:
        for label, question, expected in _AUDIT_SET:
            with self.subTest(label=label, question=question):
                got = classify_intent(question)
                self.assertEqual(
                    got, expected,
                    msg=f'{label}: expected {expected}, got {got}',
                )


class EdgeCaseTests(unittest.TestCase):
    def test_empty_question_returns_mixed(self) -> None:
        self.assertEqual(classify_intent(''), 'mixed')
        self.assertEqual(classify_intent('   '), 'mixed')

    def test_unrecognized_phrasing_returns_mixed(self) -> None:
        # No aggregate / fact / detail / identity signal — degrades to
        # mixed so projection returns the union (graceful baseline).
        self.assertEqual(classify_intent('hello sherlock'), 'mixed')

    def test_most_recent_does_not_match_fact_grain(self) -> None:
        # `most\s+(?!recent)\w+` excludes "most recent" — without that
        # negative lookahead, Q3 would land in fact_grain and route to
        # the wrong table.
        self.assertEqual(classify_intent('show me the most recent run'), 'detail')

    def test_classifier_returns_only_documented_classes(self) -> None:
        for _label, question, _expected in _AUDIT_SET:
            self.assertIn(classify_intent(question), ALLOWED_INTENT_CLASSES)


if __name__ == '__main__':
    unittest.main()
