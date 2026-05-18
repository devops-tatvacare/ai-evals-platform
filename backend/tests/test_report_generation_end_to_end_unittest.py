"""Phase 5 — end-to-end report generation tests per analytics profile.

Closes G7 (no full-pipeline test) + G3 producer-half runtime check, per
``docs/plans/2026-05-18-reporting-genericize/phase-5-end-to-end-tests.md`` and
``Designs/reporting-pipeline-genericization.md`` (Phase 5).

Scope choice
============
The tests drive ``_compose_single_run_payload`` (the composition boundary that
owns G3 + ``data_quality`` finalization + ``narrative_status``) per profile
using a stub producer that emits one canned section payload per configured id.

Per the design doc, G3 producer-half splits into two halves:

* **composer-preserves-producer-emitted-ids** — covered here for ALL profiles.
  If the producer emits the configured ids, the composer keeps them. Catches
  composition / serializer / discriminator regressions across every profile.
* **producer-actually-emits-configured-ids-on-real-data** — left to per-
  aggregator unit tests; not implementable here without docker-compose +
  realistic fixture data per profile (deferred per Phase 5 risk note).

This file ALSO drives ``generate_single_run_report_artifact`` once (kaira
profile) so ``rg "generate_single_run_report_artifact" backend/tests/``
returns at least one match — the G7 success criterion in the design doc.
"""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from app.models.mixins.shareable import Visibility
from app.schemas.app_analytics_config import AppAnalyticsConfig
from app.services.reports.analytics_profiles.base import AnalyticsProfile
from app.services.reports.asset_resolver import ResolvedNarrativeAssets
from app.services.reports.contracts.run_narrative import PlatformRunNarrative
from app.services.reports.contracts.run_report import (
    PlatformReportMetadata,
    PlatformRunReportPayload,
)
from app.services.seed_defaults import APP_SEEDS


# ----- Profile registry under test (G3 source of truth) ------------------

_SEEDED_APP_CONFIG_BY_SLUG: dict[str, dict] = {
    seed["slug"]: seed["config"]
    for seed in APP_SEEDS
    if seed["config"].get("analytics", {}).get("capabilities", {}).get("singleRunReport")
}

# (app_slug, profile_key). Add a tuple here when a new profile registers.
_PROFILE_FIXTURES: list[tuple[str, str]] = [
    ("voice-rx", "voice_rx_v1"),
    ("kaira-bot", "kaira_v1"),
    ("inside-sales", "inside_sales_v1"),
]


# ----- Per-section-type minimal valid payload factory -------------------
#
# Each branch returns the smallest contract-valid `data` payload for the
# discriminated section type. Used by the stub producer to emit a section per
# configured id without modelling the real aggregator output shape.

def _canned_run_narrative() -> PlatformRunNarrative:
    return PlatformRunNarrative(
        executive_summary="Phase-5 fixture narrative.",
        issues=[],
        recommendations=[],
        exemplars=[],
        prompt_gaps=[],
    )


def _payload_for_type(component_type: str) -> Any:
    if component_type == "summary_cards":
        return [{"key": "k", "label": "Label", "value": "v", "tone": "neutral"}]
    if component_type == "narrative":
        return _canned_run_narrative().model_dump(by_alias=True)
    if component_type == "metric_breakdown":
        return [{"key": "m", "label": "Metric", "value": 50.0, "maxValue": 100, "unit": "%", "tone": "neutral"}]
    if component_type == "distribution_chart":
        return [{"label": "series", "values": [1.0], "categories": ["a"]}]
    if component_type == "compliance_table":
        return {
            "data": [
                {"key": "r", "label": "Rule", "passed": 1, "failed": 0, "notEvaluated": 0, "rate": 1.0}
            ],
            "coFailures": [],
        }
    if component_type == "friction_analysis":
        return {
            "totalFrictionTurns": 0,
            "byCause": {},
            "recoveryQuality": {},
            "avgTurnsByVerdict": {},
            "topPatterns": [],
        }
    if component_type == "heatmap":
        return {
            "columns": ["c1"],
            "rows": [{"key": "r1", "label": "R1", "cells": [{"label": "x", "value": 0, "tone": "neutral"}]}],
        }
    if component_type == "entity_slices":
        return [{"entityId": "e1", "label": "E1", "summary": {"score": 0}, "details": {}}]
    if component_type == "flags":
        return [{"key": "f1", "label": "Flag", "relevant": 1, "present": 1}]
    if component_type == "issues_recommendations":
        return {"issues": [], "recommendations": []}
    if component_type == "exemplars":
        return [{"itemId": "i1", "label": "Item", "score": 1.0, "summary": "ex", "details": {}}]
    if component_type == "prompt_gap_analysis":
        return []
    if component_type == "callout":
        return {"message": "callout", "tone": "info"}
    raise ValueError(f"Unknown section component type: {component_type}")


# ----- Fakes ------------------------------------------------------------

class _FakeSession:
    """Scripted scalar() + no-op execute/add/flush/commit. Mirrors the pattern
    in test_report_generation_unittest._FakeSession."""

    def __init__(self, scalar_returns: list[Any]):
        self._scalar_returns = list(scalar_returns)
        self.added: list[Any] = []
        self.flushes = 0
        self.committed = False

    async def scalar(self, _stmt):
        if not self._scalar_returns:
            return None
        return self._scalar_returns.pop(0)

    async def execute(self, _stmt):
        return SimpleNamespace(
            all=lambda: [],
            scalars=lambda: SimpleNamespace(all=lambda: []),
        )

    def add(self, model):
        self.added.append(model)

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.committed = True


def _make_application_row(app_slug: str) -> SimpleNamespace:
    return SimpleNamespace(
        slug=app_slug,
        is_active=True,
        config=_SEEDED_APP_CONFIG_BY_SLUG[app_slug],
    )


def _make_report_config(
    app_slug: str,
    *,
    narrative_enabled: bool = True,
) -> SimpleNamespace:
    analytics_dict = _SEEDED_APP_CONFIG_BY_SLUG[app_slug]["analytics"]
    single_run = analytics_dict["singleRun"]
    return SimpleNamespace(
        id=uuid.uuid4(),
        app_id=app_slug,
        report_id="default-single-run",
        name="Default Single Run",
        scope="single_run",
        version=1,
        default_report_run_visibility=Visibility.PRIVATE,
        presentation_config={},
        narrative_config={
            "enabled": narrative_enabled,
            "assetKeys": {},
            "inputSelection": {"sectionIds": []},
            "outputInsertionPoints": [
                sc["id"]
                for sc in single_run["sections"]
                if sc["type"]
                in ("narrative", "issues_recommendations", "prompt_gap_analysis", "callout")
            ],
        },
        export_config=single_run.get("export", {}),
    )


def _make_eval_run(app_slug: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        app_id=app_slug,
        eval_type="batch",
        llm_provider=None,
        llm_model=None,
    )


def _make_stub_producer_cls(
    app_slug: str,
    *,
    drop_section_ids: frozenset[str] = frozenset(),
    missing_inputs_to_emit: tuple[str, ...] = (),
):
    """Returns a class (matching BaseReportService surface) whose
    build_payload_for_composer emits one canned section per configured id,
    minus drop_section_ids, with optional missing_inputs markers."""

    analytics_config = AppAnalyticsConfig.model_validate(
        _SEEDED_APP_CONFIG_BY_SLUG[app_slug]["analytics"]
    )
    section_configs = analytics_config.single_run.sections

    class _StubProducer:
        payload_model = PlatformRunReportPayload

        def __init__(self, db, tenant_id, user_id):
            self.db = db
            self.tenant_id = tenant_id
            self.user_id = user_id

        async def build_payload_for_composer(
            self,
            run_id,
            *,
            llm_provider=None,
            llm_model=None,
            include_narrative=False,
        ):
            # Local imports keep this fake aligned with the actual code path
            # at call time, not at module import (which would couple test load
            # order to production import order).
            from app.services.reports.contracts.data_quality import DataQualityReport
            from app.services.reports.document_composer import compose_document
            from app.services.reports.report_composer import compose_run_report

            payloads: dict[str, Any] = {}
            for sc in section_configs:
                if sc.id in drop_section_ids:
                    continue
                payloads[sc.id] = _payload_for_type(sc.type)

            metadata = PlatformReportMetadata(
                app_id=app_slug,
                run_id=str(run_id),
                run_name="phase-5-fixture",
                eval_type="batch",
                created_at="2026-05-18T00:00:00Z",
                computed_at="2026-05-18T00:00:00Z",
            )
            export_doc = compose_document(
                title="fixture",
                subtitle=None,
                metadata={},
                sections=[],
                export_config=analytics_config.single_run.export,
            )
            payload = compose_run_report(
                metadata=metadata,
                section_configs=section_configs,
                section_payloads=payloads,
                export_document=export_doc,
            )
            if missing_inputs_to_emit:
                payload = payload.model_copy(
                    update={"data_quality": DataQualityReport(missing_inputs=list(missing_inputs_to_emit))},
                )
            return payload

    return _StubProducer


def _make_stub_profile(
    app_slug: str,
    profile_key: str,
    *,
    drop_section_ids: frozenset[str] = frozenset(),
    missing_inputs_to_emit: tuple[str, ...] = (),
) -> AnalyticsProfile:
    return AnalyticsProfile(
        key=profile_key,
        report_service_cls=_make_stub_producer_cls(
            app_slug,
            drop_section_ids=drop_section_ids,
            missing_inputs_to_emit=missing_inputs_to_emit,
        ),
        report_payload_model=PlatformRunReportPayload,
    )


_EMPTY_RESOLVED_ASSETS = ResolvedNarrativeAssets(
    prompt_references={},
    system_prompt="system prompt",
    glossary=None,
)


# ----- Tests ------------------------------------------------------------

class ComposeBoundaryHappyPathTests(unittest.IsolatedAsyncioTestCase):
    """Per-profile happy path: producer emits all configured sections, narrative
    resolves to 'completed'. Asserts G3 (configured ⊆ composed) + data_quality
    + narrative_status."""

    async def _drive(
        self,
        app_slug: str,
        profile_key: str,
        *,
        drop_section_ids: frozenset[str] = frozenset(),
        missing_inputs_to_emit: tuple[str, ...] = (),
        narrative_enabled: bool = True,
        narrative_llm_present: bool = True,
    ):
        from app.services.reports import report_generation_service as svc

        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        run = _make_eval_run(app_slug)
        report_config = _make_report_config(app_slug, narrative_enabled=narrative_enabled)
        report_run = SimpleNamespace(
            id=uuid.uuid4(),
            llm_provider=None,
            llm_model=None,
            status="pending",
            completed_at=None,
        )

        # db.scalar returns the Application row once for _compose_single_run_payload.
        db = _FakeSession([_make_application_row(app_slug)])

        stub_profile = _make_stub_profile(
            app_slug,
            profile_key,
            drop_section_ids=drop_section_ids,
            missing_inputs_to_emit=missing_inputs_to_emit,
        )

        llm_return = (
            (SimpleNamespace(), "openai", "gpt-test")
            if narrative_llm_present
            else (None, None, None)
        )

        def _narrative_payloads(**_kw):
            # Mirror what the real executor emits: payload per narrative output
            # insertion point. Keying by section id matches the
            # `_serialize_section_payloads` lookup.
            return {
                sid: _canned_run_narrative().model_dump(by_alias=True)
                for sid in report_config.narrative_config["outputInsertionPoints"]
                if "narrative" in sid.lower()
            }

        with patch.object(svc, "get_analytics_profile", return_value=stub_profile), \
             patch.object(svc, "resolve_report_config_assets", AsyncMock(return_value=_EMPTY_RESOLVED_ASSETS)), \
             patch.object(svc, "_create_logging_llm", AsyncMock(return_value=llm_return)), \
             patch.object(svc, "execute_narrative_generation", AsyncMock(side_effect=lambda **kw: _narrative_payloads(**kw))):
            payload, _provider, _model = await svc._compose_single_run_payload(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                run=run,
                report_run=report_run,
                report_config=report_config,
                llm_provider=None,
                llm_model=None,
            )
        return payload, report_config

    async def test_each_profile_happy_path_preserves_configured_sections_and_taxonomy(self):
        for app_slug, profile_key in _PROFILE_FIXTURES:
            with self.subTest(app=app_slug, profile=profile_key):
                payload, report_config = await self._drive(app_slug, profile_key)

                configured_ids = [
                    sc["id"]
                    for sc in _SEEDED_APP_CONFIG_BY_SLUG[app_slug]["analytics"]["singleRun"]["sections"]
                ]
                composed_ids = [s.id for s in payload.sections]

                # G3 composer-preserves-producer-emitted-ids.
                self.assertEqual(
                    set(configured_ids),
                    set(composed_ids),
                    f"[{app_slug}] composed sections != configured sections",
                )
                self.assertEqual(payload.data_quality.overall, "complete")
                self.assertEqual(payload.data_quality.missing_inputs, [])
                self.assertEqual(payload.data_quality.section_status, {})
                self.assertEqual(payload.metadata.narrative_status, "completed")
                self.assertEqual(payload.metadata.narrative_model, "gpt-test")
                self.assertEqual(payload.metadata.app_id, app_slug)

    async def test_each_profile_producer_drops_a_section_flags_data_quality(self):
        """Dropping a configured section routes into data_quality.section_status.
        The exact marker depends on whether the dropped id is also in
        export.sectionIds — the finalizer prefers the more specific
        'dropped_from_export' over 'empty' (data_quality_finalizer.py:64)."""
        for app_slug, profile_key in _PROFILE_FIXTURES:
            with self.subTest(app=app_slug, profile=profile_key):
                analytics = _SEEDED_APP_CONFIG_BY_SLUG[app_slug]["analytics"]["singleRun"]
                configured = analytics["sections"]
                exported_ids = set(analytics.get("export", {}).get("sectionIds") or [])
                dropped_id = configured[0]["id"]
                expected_marker = "dropped_from_export" if dropped_id in exported_ids else "empty"

                payload, _ = await self._drive(
                    app_slug,
                    profile_key,
                    drop_section_ids=frozenset({dropped_id}),
                )

                composed_ids = {s.id for s in payload.sections}
                self.assertNotIn(dropped_id, composed_ids)
                self.assertEqual(payload.data_quality.overall, "partial")
                self.assertEqual(
                    payload.data_quality.section_status.get(dropped_id),
                    expected_marker,
                )

    async def test_each_profile_producer_emits_missing_inputs_yields_partial(self):
        for app_slug, profile_key in _PROFILE_FIXTURES:
            with self.subTest(app=app_slug, profile=profile_key):
                payload, _ = await self._drive(
                    app_slug,
                    profile_key,
                    missing_inputs_to_emit=("summary.test_marker",),
                )
                self.assertEqual(payload.data_quality.overall, "partial")
                self.assertIn("summary.test_marker", payload.data_quality.missing_inputs)
                self.assertEqual(payload.data_quality.section_status, {})

    async def test_each_profile_narrative_disabled_status(self):
        for app_slug, profile_key in _PROFILE_FIXTURES:
            with self.subTest(app=app_slug, profile=profile_key):
                payload, _ = await self._drive(
                    app_slug, profile_key, narrative_enabled=False,
                )
                self.assertEqual(payload.metadata.narrative_status, "disabled")
                self.assertIsNone(payload.metadata.narrative_model)

    async def test_each_profile_narrative_enabled_no_llm_yields_skipped_no_model(self):
        for app_slug, profile_key in _PROFILE_FIXTURES:
            with self.subTest(app=app_slug, profile=profile_key):
                payload, _ = await self._drive(
                    app_slug, profile_key, narrative_llm_present=False,
                )
                self.assertEqual(payload.metadata.narrative_status, "skipped_no_model")


class GenerateSingleRunArtifactOuterWiringTests(unittest.IsolatedAsyncioTestCase):
    """One outer-pipeline drive of generate_single_run_report_artifact so the
    G7 success criterion ('rg generate_single_run_report_artifact backend/tests/
    returns at least one match') is satisfied for a registered profile."""

    async def test_generate_single_run_report_artifact_runs_end_to_end(self):
        from app.services.reports import report_generation_service as svc

        app_slug = "kaira-bot"
        profile_key = "kaira_v1"

        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        eval_run = _make_eval_run(app_slug)
        # _load_run_and_profile reads run.shared_by / shared_at / visibility too.
        eval_run.shared_by = None
        eval_run.shared_at = None
        eval_run.visibility = Visibility.PRIVATE
        eval_run.created_at = datetime.now(timezone.utc)

        report_config = _make_report_config(app_slug, narrative_enabled=False)
        application_row = _make_application_row(app_slug)

        # _load_run_and_profile: scalar(EvaluationRun) -> scalar(Application).
        # resolve_report_config: scalar(ReportConfiguration). When params carry
        # an explicit `report_id`, resolve_report_config exits after one
        # scalar call (the `selected is not None and report_id is not None`
        # short-circuit at report_config_resolver.py:50-52).
        # _compose_single_run_payload: scalar(Application) again.
        db = _FakeSession([eval_run, application_row, report_config, application_row])

        # async_session() context manager → db
        class _CtxManager:
            async def __aenter__(self):
                return db

            async def __aexit__(self, *_):
                return False

        stub_profile = _make_stub_profile(app_slug, profile_key)

        ensured_run = SimpleNamespace(
            id=uuid.uuid4(),
            llm_provider=None,
            llm_model=None,
            status="pending",
            completed_at=None,
        )
        artifact = SimpleNamespace(id=uuid.uuid4())

        with patch.object(svc, "async_session", lambda: _CtxManager()), \
             patch.object(svc, "get_analytics_profile", return_value=stub_profile), \
             patch.object(svc, "ensure_report_run", AsyncMock(return_value=ensured_run)), \
             patch.object(svc, "persist_report_artifact", AsyncMock(return_value=artifact)):
            result = await svc.generate_single_run_report_artifact(
                str(uuid.uuid4()),
                # Pass report_id explicitly so resolve_report_config
                # short-circuits and our scalar() queue lines up.
                {"run_id": str(eval_run.id), "report_id": report_config.report_id},
                tenant_id=tenant_id,
                user_id=user_id,
            )

        self.assertEqual(result["report_run_id"], str(ensured_run.id))
        self.assertEqual(result["report_artifact_id"], str(artifact.id))
        self.assertEqual(result["run_id"], str(eval_run.id))
        self.assertEqual(result["report_id"], report_config.report_id)
        self.assertFalse(result["has_narrative"])
        self.assertEqual(ensured_run.status, "completed")
        self.assertTrue(db.committed)


if __name__ == "__main__":
    unittest.main()
