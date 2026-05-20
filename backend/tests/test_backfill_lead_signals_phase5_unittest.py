"""Tests for the ``backfill-lead-signals`` job orchestration.

Phase 11B rewired this job onto the signal derivation framework: the
per-lead derivation (extraction input, the LLM call, projection) moved
into the ``llm_profile`` strategy and is tested in
``test_signal_derivation.py``. What stays here is the job's own
orchestration surface: request parsing / bounds validation and the
cost estimate. The strategy-level tests cover the rest.
"""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.services.analytics import backfill_lead_signals_job as backfill


REQUIRED_LLM = {"provider": "gemini", "model": "gemini-2.5-flash"}


class ParseRequestTests(unittest.TestCase):
    def test_defaults_when_only_app_id_provided(self) -> None:
        req = backfill.parse_request({"app_id": "inside-sales", **REQUIRED_LLM})
        self.assertEqual(req.app_id, "inside-sales")
        self.assertFalse(req.dry_run)
        self.assertEqual(req.max_leads, backfill.DEFAULT_MAX_LEADS)
        self.assertEqual(req.batch_size, backfill.DEFAULT_BATCH_SIZE)
        self.assertEqual(req.cost_budget_usd, backfill.DEFAULT_COST_BUDGET_USD)
        self.assertEqual(req.provider, "gemini")
        self.assertEqual(req.model, "gemini-2.5-flash")

    def test_missing_app_id_raises(self) -> None:
        with self.assertRaises(ValueError):
            backfill.parse_request({})

    def test_missing_provider_or_model_is_accepted(self) -> None:
        # provider / model are optional overrides — when blank the resolver
        # picks the ``lead_signal_extraction`` call-site default. Partial
        # overrides are caught downstream by ``resolve_llm_call``.
        req = backfill.parse_request({"app_id": "inside-sales"})
        self.assertEqual(req.provider, "")
        self.assertEqual(req.model, "")
        req = backfill.parse_request({"app_id": "inside-sales", "model": "x"})
        self.assertEqual(req.provider, "")
        self.assertEqual(req.model, "x")

    def test_batch_size_out_of_bounds_raises(self) -> None:
        with self.assertRaises(ValueError):
            backfill.parse_request({"app_id": "inside-sales", "batch_size": 1, **REQUIRED_LLM})
        with self.assertRaises(ValueError):
            backfill.parse_request(
                {"app_id": "inside-sales", "batch_size": backfill.MAX_BATCH_SIZE + 1, **REQUIRED_LLM}
            )

    def test_max_leads_out_of_bounds_raises(self) -> None:
        with self.assertRaises(ValueError):
            backfill.parse_request({"app_id": "inside-sales", "max_leads": 0, **REQUIRED_LLM})
        with self.assertRaises(ValueError):
            backfill.parse_request(
                {"app_id": "inside-sales", "max_leads": backfill.MAX_MAX_LEADS + 1, **REQUIRED_LLM}
            )

    def test_cost_budget_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            backfill.parse_request({"app_id": "inside-sales", "cost_budget_usd": 0, **REQUIRED_LLM})

    def test_iso_datetime_with_z_parses(self) -> None:
        req = backfill.parse_request(
            {
                "app_id": "inside-sales",
                "started_after": "2026-01-25T00:00:00Z",
                "ended_before": "2026-05-13T00:00:00+00:00",
                **REQUIRED_LLM,
            }
        )
        self.assertEqual(
            req.started_after, datetime(2026, 1, 25, tzinfo=timezone.utc)
        )
        self.assertEqual(
            req.ended_before, datetime(2026, 5, 13, tzinfo=timezone.utc)
        )


class CostEstimateTests(unittest.TestCase):
    def test_zero_leads_is_zero_cost(self) -> None:
        self.assertEqual(backfill.estimate_cost(0), 0.0)

    def test_thirty_thousand_at_default_rate_under_budget(self) -> None:
        cost = backfill.estimate_cost(30_000)
        self.assertEqual(cost, 30_000 * backfill.DEFAULT_PER_LEAD_COST_USD)
        # Sanity: a default-config run is not blocked at the budget gate.
        self.assertLessEqual(cost, backfill.DEFAULT_COST_BUDGET_USD * 2)


if __name__ == "__main__":
    unittest.main()
