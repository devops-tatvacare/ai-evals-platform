import uuid
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services import inside_sales_eval_linkage as linkage  # noqa: E402


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeScalarCollection:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalarCollection(self._rows)


class _FakeSession:
    def __init__(self, result):
        self.result = result

    async def execute(self, _statement):
        return self.result


class InsideSalesEvalLinkageTests(unittest.IsolatedAsyncioTestCase):
    def test_extract_inside_sales_eval_score_uses_nested_and_fallback_shapes(self):
        nested_score = linkage.extract_inside_sales_eval_score(
            {"evaluations": [{"output": {"overall_score": 87}}]}
        )
        fallback_score = linkage.extract_inside_sales_eval_score(
            {"output": {"overall_score": 73}}
        )

        self.assertEqual(nested_score, 87)
        self.assertEqual(fallback_score, 73)

    async def test_fetch_latest_eval_overlays_maps_scores_and_counts(self):
        run_id = uuid.uuid4()
        db = _FakeSession(
            _FakeResult(
                [
                    (
                        "activity-1",
                        run_id,
                        {"evaluations": [{"output": {"overall_score": 91}}]},
                        3,
                    )
                ]
            )
        )

        overlays = await linkage.fetch_latest_eval_overlays(
            db,
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            thread_ids=["activity-1"],
        )

        self.assertEqual(overlays["activity-1"].eval_count, 3)
        self.assertEqual(overlays["activity-1"].latest_score, 91)
        self.assertEqual(overlays["activity-1"].latest_run_id, str(run_id))

    async def test_list_eval_history_entries_serializes_thread_rows(self):
        created_at = datetime(2026, 4, 8, 12, 0, tzinfo=timezone.utc)
        db = _FakeSession(
            _FakeScalarResult(
                [
                    SimpleNamespace(
                        id=7,
                        thread_id="activity-1",
                        run_id=uuid.uuid4(),
                        result={"output": {"overall_score": 88}},
                        created_at=created_at,
                    )
                ]
            )
        )

        entries = await linkage.list_eval_history_entries(
            db,
            tenant_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            app_id="inside-sales",
            thread_ids=["activity-1"],
        )

        self.assertEqual(entries[0]["thread_id"], "activity-1")
        self.assertEqual(entries[0]["result"]["output"]["overall_score"], 88)
        self.assertEqual(entries[0]["created_at"], str(created_at))


if __name__ == '__main__':
    unittest.main()
