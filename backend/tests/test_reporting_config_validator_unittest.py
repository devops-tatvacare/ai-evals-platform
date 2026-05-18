"""Unit tests for the Phase 1 reporting config validator.

See docs/plans/2026-05-18-reporting-genericize-phase-1.md.
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from app.services.reports.config_validator import validate_reporting_config
from app.services.seed_defaults import APP_SEEDS


class _FakeResult:
    def __init__(self, rows: list[tuple[str, dict]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[str, dict]]:
        return self._rows


class _FakeDB:
    """Minimal async DB stub matching the call shape used by validate_all_app_pack_ids."""

    def __init__(self, rows: list[tuple[str, dict]]) -> None:
        self._rows = rows

    async def execute(self, *_args: Any, **_kwargs: Any) -> _FakeResult:
        return _FakeResult(self._rows)


def _seed_rows() -> list[tuple[str, dict]]:
    """All active seeded apps as (slug, config) tuples — deep-copied so tests can mutate."""
    return [(app["slug"], copy.deepcopy(app["config"])) for app in APP_SEEDS]


def _row_for(slug: str) -> tuple[str, dict]:
    for s, cfg in _seed_rows():
        if s == slug:
            return s, cfg
    raise KeyError(slug)


class ReportingConfigValidatorTests(unittest.IsolatedAsyncioTestCase):
    # --- positive case ---------------------------------------------------

    async def test_all_seeded_apps_pass(self):
        """Regression gate — every active seeded app must satisfy every invariant."""
        db = _FakeDB(_seed_rows())
        # Should not raise.
        await validate_reporting_config(db)

    # --- negative: profile (G4) ------------------------------------------

    async def test_unknown_profile_fails(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["profile"] = "bogus_v9"
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("voice-rx", str(ctx.exception))
        self.assertIn("bogus_v9", str(ctx.exception))

    async def test_empty_profile_fails_when_capability_on(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["profile"] = ""
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("profile", str(ctx.exception).lower())

    async def test_capability_off_skips_all_checks(self):
        """If singleRunReport=false the validator must not look at sections/export/etc."""
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["profile"] = "totally-bogus"  # would fail check 1
        cfg["analytics"]["capabilities"]["singleRunReport"] = False
        await validate_reporting_config(_FakeDB([(slug, cfg)]))  # should not raise

    # --- negative: sections shape ----------------------------------------

    async def test_empty_sections_fails(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["singleRun"]["sections"] = []
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("sections", str(ctx.exception).lower())

    async def test_duplicate_section_ids_fail(self):
        slug, cfg = _row_for("voice-rx")
        sections = cfg["analytics"]["singleRun"]["sections"]
        # Duplicate the first section's id onto the second.
        sections[1]["id"] = sections[0]["id"]
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("duplicate", str(ctx.exception).lower())

    # --- negative: export subset (G3 export half) ------------------------

    async def test_export_section_id_not_in_sections_fails(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["singleRun"]["export"]["sectionIds"].append("ghost-section")
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("ghost-section", str(ctx.exception))
        self.assertIn("export", str(ctx.exception).lower())

    # --- negative: documentVariant (G3 palette) --------------------------

    async def test_unknown_document_variant_fails(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["singleRun"]["export"]["documentVariant"] = "not-a-real-variant"
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("not-a-real-variant", str(ctx.exception))

    # --- negative: aiSummary subset (G3 narrative half) ------------------

    async def test_ai_summary_section_id_not_in_sections_fails(self):
        slug, cfg = _row_for("kaira-bot")
        cfg["analytics"]["singleRun"]["aiSummary"]["sectionIds"].append("phantom-id")
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("phantom-id", str(ctx.exception))
        self.assertIn("aiSummary", str(ctx.exception))

    # --- negative: narrative insertion substring match (G3) --------------

    async def test_narrative_typed_section_with_bad_id_fails(self):
        """A section.type='narrative' whose id has no 'narrative' substring would
        be silently dropped by narrative_executor.py:201-213 — must fail at boot."""
        slug, cfg = _row_for("kaira-bot")
        for section in cfg["analytics"]["singleRun"]["sections"]:
            if section["type"] == "narrative":
                section["id"] = "kaira-summary-text"  # no 'narrative' substring
                break
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        msg = str(ctx.exception)
        self.assertIn("kaira-summary-text", msg)
        self.assertIn("narrative", msg.lower())

    async def test_prompt_gap_typed_section_with_bad_id_fails(self):
        slug, cfg = _row_for("kaira-bot")
        for section in cfg["analytics"]["singleRun"]["sections"]:
            if section["type"] == "prompt_gap_analysis":
                section["id"] = "kaira-rubric-quality"
                break
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("kaira-rubric-quality", str(ctx.exception))

    async def test_callout_typed_section_with_bad_id_fails(self):
        slug, cfg = _row_for("voice-rx")
        for section in cfg["analytics"]["singleRun"]["sections"]:
            if section["type"] == "callout":
                section["id"] = "voice-rx-banner"  # no 'overview' or 'callout' substring
                break
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("voice-rx-banner", str(ctx.exception))

    async def test_issues_typed_section_with_bad_id_fails(self):
        slug, cfg = _row_for("kaira-bot")
        for section in cfg["analytics"]["singleRun"]["sections"]:
            if section["type"] == "issues_recommendations":
                section["id"] = "kaira-todo-list"
                break
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        self.assertIn("kaira-todo-list", str(ctx.exception))

    # --- error aggregation -----------------------------------------------

    async def test_multiple_errors_collected_into_single_raise(self):
        slug, cfg = _row_for("voice-rx")
        cfg["analytics"]["profile"] = "bogus_v9"
        cfg["analytics"]["singleRun"]["export"]["documentVariant"] = "not-a-real-variant"
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(_FakeDB([(slug, cfg)]))
        msg = str(ctx.exception)
        self.assertIn("bogus_v9", msg)
        self.assertIn("not-a-real-variant", msg)
        # Single raise reports both — count newline bullets.
        self.assertGreaterEqual(msg.count("\n  - "), 2)

    async def test_corrupt_config_reports_but_does_not_crash(self):
        """An app whose AppConfig parse fails should be reported, not propagated."""
        db = _FakeDB([("broken-app", {"analytics": "not-a-dict"})])
        with self.assertRaises(RuntimeError) as ctx:
            await validate_reporting_config(db)
        self.assertIn("broken-app", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
