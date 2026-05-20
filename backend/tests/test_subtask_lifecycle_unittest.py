"""Projection of a specialist's as_tool return into the uniform SubtaskResult."""
import unittest

from app.services.sherlock_v3.contracts.bouncer import Verdict
from app.services.sherlock_v3.contracts.brief import Attempt
from app.services.sherlock_v3.contracts.result import SpecialistResult
from app.services.sherlock_v3.subtask_result import project_specialist_output


def _data_result_json(*, status: str, attempts: list[Attempt], summary: str) -> str:
    return SpecialistResult(
        kind='data' if status != 'error' else 'error',
        status=status,
        summary=summary,
        attempts=attempts,
    ).model_dump_json()


class ProjectSpecialistOutputTest(unittest.TestCase):
    def test_data_specialist_ok_surfaces_sql_and_row_count(self):
        attempts = [
            Attempt(sql='SELECT count(*) FROM leads', verdict=Verdict(status='ok'), status='ok', row_count=7201),
        ]
        output = _data_result_json(status='ok', attempts=attempts, summary='Counted leads in New Lead.')
        result, is_error = project_specialist_output('data_specialist', output)
        self.assertFalse(is_error)
        self.assertEqual(result.status, 'ok')
        self.assertEqual(result.summary, 'Counted leads in New Lead.')
        self.assertEqual(result.sql, 'SELECT count(*) FROM leads')
        self.assertEqual(result.row_count, 7201)

    def test_data_specialist_picks_the_resolved_attempt(self):
        attempts = [
            Attempt(sql='BAD', verdict=Verdict(status='invalid'), status='bouncer_rejected_before', row_count=None),
            Attempt(sql='SELECT 1', verdict=Verdict(status='ok'), status='ok', row_count=13),
        ]
        output = _data_result_json(status='ok', attempts=attempts, summary='ok')
        result, is_error = project_specialist_output('data_specialist', output)
        self.assertFalse(is_error)
        self.assertEqual(result.sql, 'SELECT 1')
        self.assertEqual(result.row_count, 13)

    def test_data_specialist_error_status_marks_error(self):
        output = _data_result_json(status='error', attempts=[], summary='bouncer refused')
        result, is_error = project_specialist_output('data_specialist', output)
        self.assertTrue(is_error)
        self.assertEqual(result.status, 'error')

    def test_data_specialist_invalid_json_degrades_to_error(self):
        result, is_error = project_specialist_output('data_specialist', 'not json {')
        self.assertTrue(is_error)
        self.assertEqual(result.status, 'error')
        self.assertIsNone(result.sql)

    def test_authoring_specialist_text_output_is_ok_without_sql(self):
        result, is_error = project_specialist_output('authoring_specialist', 'Here is the narrative.')
        self.assertFalse(is_error)
        self.assertEqual(result.status, 'ok')
        self.assertIsNone(result.sql)
        self.assertIsNone(result.row_count)

    def test_query_synthesis_empty_output_is_empty(self):
        result, is_error = project_specialist_output('query_synthesis_specialist', '   ')
        self.assertFalse(is_error)
        self.assertEqual(result.status, 'empty')


if __name__ == '__main__':
    unittest.main()
