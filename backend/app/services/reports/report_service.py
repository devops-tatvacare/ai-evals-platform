"""Orchestrates report generation: load → aggregate → narrate → assemble.

Phase 1: Infrastructure (data loading, health score, metadata).
Phase 2: Aggregation engine (distributions, compliance, friction, exemplars).
Phase 3: AI narrative generation via LLM.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import load_only

from app.models.app import App
from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult, EvaluationRunAdversarialResult
from app.models.evaluator import Evaluator
from app.schemas.app_config import AppConfig as AppConfigSchema
from app.schemas.app_analytics_config import AppAnalyticsConfig

from .aggregator import AdversarialAggregator, ReportAggregator
from .asset_resolver import resolve_report_assets
from .base_report_service import BaseReportService
from .canonical_adapters import adapt_kaira_run_report
from .contracts.run_report import PlatformRunReportPayload
from .custom_evaluations.aggregator import CustomEvaluationsAggregator
from .custom_evaluations.narrator import CustomEvalNarrator
from .custom_evaluations.schemas import CustomEvaluationsReport
from .health_score import compute_adversarial_health_score, compute_health_score
from .narrator import ReportNarrator
from .schemas import (
    Exemplars,
    NarrativeOutput,
    PromptReferences,
    ReportMetadata,
    ReportPayload,
)

logger = logging.getLogger(__name__)


class ReportService(BaseReportService):
    payload_model = PlatformRunReportPayload

    """Stateless per-request report generator.

    Usage:
        service = ReportService(db_session)
        payload = await service.generate(run_id)
    """

    async def _build_payload(
        self,
        run: EvaluationRun,
        source_data: dict,
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = True,
    ) -> ReportPayload:
        """Full Kaira/adversarial report generation pipeline."""
        threads = source_data["threads"]
        adversarial = source_data["adversarial"]

        summary = run.summary or {}
        is_adversarial = run.eval_type == "batch_adversarial"

        # Health score — different dimensions for adversarial
        if is_adversarial:
            health_score = compute_adversarial_health_score(adversarial, summary)
            agg = AdversarialAggregator(adversarial, summary)
        else:
            health_score = compute_health_score(
                avg_intent_accuracy=summary.get("avg_intent_accuracy"),
                correctness_verdicts=summary.get("correctness_verdicts", {}),
                efficiency_verdicts=summary.get("efficiency_verdicts", {}),
                total_evaluated=summary.get("completed", 0),
                success_count=sum(1 for t in threads if t.success_status),
            )
            agg = ReportAggregator(threads, adversarial, summary)

        # Custom evaluations (isolated module — standard runs only)
        custom_eval_report: CustomEvaluationsReport | None = None
        custom_scores: dict[str, float] | None = None
        custom_eval_agg: CustomEvaluationsAggregator | None = None
        if not is_adversarial:
            evaluator_schemas = await self._load_evaluator_schemas(summary)
            if evaluator_schemas:
                custom_eval_agg = CustomEvaluationsAggregator(threads, evaluator_schemas)
                custom_eval_report = custom_eval_agg.aggregate()
                custom_scores = custom_eval_agg.compute_custom_scores_for_exemplars()

        # Aggregate — same interface for both aggregator types
        distributions = agg.compute_distributions()
        rule_compliance = agg.compute_rule_compliance()
        friction = agg.compute_friction_analysis()
        exemplars = agg.select_exemplars(k=5, custom_scores=custom_scores)
        adversarial_breakdown = agg.compute_adversarial_breakdown()

        # Metadata
        metadata = self._build_metadata(run, threads, adversarial)
        analytics_config = await self._load_analytics_config(run.app_id)
        report_assets = await resolve_report_assets(
            self.db,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            app_id=run.app_id,
            asset_keys=analytics_config.assets,
        )

        # Legacy payload field retained for compatibility; values now come from
        # settings-managed prompt references instead of a hard-coded module.
        prod_prompts = report_assets.prompt_references
        prompt_references = PromptReferences(
            intent_classification=prod_prompts.get("intent_classification"),
            meal_summary_spec=prod_prompts.get("meal_summary_spec"),
        )

        # AI Narrative (non-blocking — failure is OK)
        narrative = None
        narrative_model = None
        if include_narrative:
            narrative, narrative_model = await self._generate_narrative(
                run=run,
                metadata=metadata,
                health_score=health_score,
                distributions=distributions,
                rule_compliance=rule_compliance,
                friction=friction,
                adversarial_breakdown=adversarial_breakdown,
                exemplars=exemplars,
                prod_prompts=prod_prompts,
                llm_provider=llm_provider,
                llm_model=llm_model,
                is_adversarial=is_adversarial,
            )

        # Reconcile LLM-returned exemplar IDs with actual exemplar IDs.
        # The LLM may truncate or slightly mangle UUIDs; this fixes the lookup.
        if narrative:
            self._reconcile_exemplar_ids(narrative, exemplars)

        # Custom eval narrative (separate LLM call — non-blocking)
        if include_narrative and custom_eval_report and custom_eval_agg:
            custom_eval_report = await self._generate_custom_eval_narrative(
                run=run,
                report=custom_eval_report,
                aggregator=custom_eval_agg,
                metadata=metadata,
                llm_provider=llm_provider,
                llm_model=llm_model,
            )

        # Attach narrative model to metadata
        metadata.narrative_model = narrative_model

        payload = ReportPayload(
            metadata=metadata,
            health_score=health_score,
            distributions=distributions,
            rule_compliance=rule_compliance,
            friction=friction,
            adversarial=adversarial_breakdown,
            exemplars=exemplars,
            prompt_references=prompt_references,
            narrative=narrative,
            custom_evaluations_report=custom_eval_report,
        )
        return adapt_kaira_run_report(payload, analytics_config)

    # --- AI Narrative ---

    async def _generate_narrative(
        self,
        run: EvaluationRun,
        metadata: ReportMetadata,
        health_score,
        distributions,
        rule_compliance,
        friction,
        adversarial_breakdown,
        exemplars,
        prompt_references: dict,
        llm_provider: str | None = None,
        llm_model: str | None = None,
        is_adversarial: bool = False,
    ) -> tuple[NarrativeOutput | None, str | None]:
        """Call LLM for narrative. Returns (narrative, model_used) tuple."""
        try:
            llm, effective_model = await self._create_llm_provider(
                run, "report_narrative", llm_provider, llm_model,
            )
            if not llm:
                return None, None

            narrator = ReportNarrator(llm)
            result = await narrator.generate(
                metadata=metadata.model_dump(),
                health_score=health_score.model_dump(),
                distributions=distributions.model_dump(),
                rule_compliance=rule_compliance.model_dump(),
                friction=friction.model_dump(),
                adversarial=adversarial_breakdown.model_dump() if adversarial_breakdown else None,
                exemplars=exemplars.model_dump(),
                prompt_references=prompt_references,
                is_adversarial=is_adversarial,
            )
            return result, effective_model
        except Exception as e:
            logger.warning("Narrative generation skipped: %s", e)
            return None, None

    # --- Exemplar ID reconciliation ---

    @staticmethod
    def _reconcile_exemplar_ids(
        narrative: NarrativeOutput, exemplars: Exemplars,
    ) -> None:
        """Fix LLM-returned thread_ids that don't exactly match exemplar IDs.

        The LLM sometimes truncates or mangles UUIDs. This reconciles by
        prefix matching so the frontend analysis lookup succeeds.
        """
        all_ids = {e.thread_id for e in exemplars.best + exemplars.worst}

        for ea in narrative.exemplar_analysis:
            if ea.thread_id in all_ids:
                continue  # exact match — nothing to fix

            # Try prefix match (LLM returned a truncated ID)
            matches = [
                eid for eid in all_ids
                if eid.startswith(ea.thread_id) or ea.thread_id.startswith(eid)
            ]
            if len(matches) == 1:
                logger.debug(
                    "Reconciled exemplar ID %r → %r", ea.thread_id, matches[0],
                )
                ea.thread_id = matches[0]
                continue

            # Try substring match as last resort
            matches = [
                eid for eid in all_ids
                if ea.thread_id in eid or eid in ea.thread_id
            ]
            if len(matches) == 1:
                logger.debug(
                    "Reconciled exemplar ID (substr) %r → %r",
                    ea.thread_id, matches[0],
                )
                ea.thread_id = matches[0]
            else:
                logger.warning(
                    "Could not reconcile exemplar ID %r with known IDs",
                    ea.thread_id,
                )

    # --- Metadata ---

    def _build_metadata(
        self,
        run: EvaluationRun,
        threads: list[EvaluationRunThreadResult],
        adversarial: list[EvaluationRunAdversarialResult],
    ) -> ReportMetadata:
        summary = run.summary or {}
        batch_meta = run.batch_metadata or {}
        is_adversarial = run.eval_type == "batch_adversarial"

        if is_adversarial:
            total_threads = summary.get("total_tests", len(adversarial))
            completed = summary.get("total_tests", 0) - summary.get("errors", 0)
        else:
            total_threads = summary.get("total_threads", len(threads) + len(adversarial))
            completed = summary.get("completed", 0)

        errors = summary.get("errors", 0)

        return ReportMetadata(
            run_id=str(run.id),
            run_name=batch_meta.get("name"),
            app_id=run.app_id,
            eval_type=run.eval_type,
            created_at=run.created_at.isoformat() if run.created_at else "",
            llm_provider=run.llm_provider,
            llm_model=run.llm_model,
            total_threads=total_threads,
            completed_threads=completed,
            error_threads=errors,
            duration_ms=run.duration_ms,
            data_path=batch_meta.get("data_path"),
        )

    # --- Custom evaluations helpers ---

    async def _load_evaluator_schemas(
        self, summary: dict,
    ) -> dict[str, dict]:
        """Load evaluator schemas for custom evaluations in this run.

        Returns {eval_id: {"name", "output_schema", "prompt"}} or empty dict.
        """
        custom_evals = summary.get("custom_evaluations", {})
        if not custom_evals:
            return {}

        eval_ids = list(custom_evals.keys())

        # Bulk-load evaluators from DB
        from uuid import UUID as PyUUID
        try:
            uuids = [PyUUID(eid) for eid in eval_ids]
        except (ValueError, AttributeError):
            return {}

        result = await self.db.execute(
            select(Evaluator)
            .where(Evaluator.id.in_(uuids))
            .options(load_only(
                Evaluator.id, Evaluator.name,
                Evaluator.output_schema, Evaluator.prompt,
            ))
        )
        db_evaluators = {str(e.id): e for e in result.scalars().all()}

        schemas: dict[str, dict] = {}
        for eval_id in eval_ids:
            if eval_id in db_evaluators:
                e = db_evaluators[eval_id]
                schemas[eval_id] = {
                    "name": e.name,
                    "output_schema": e.output_schema or [],
                    "prompt": e.prompt or "",
                }
            else:
                # Evaluator deleted — fall back to summary data
                cev_data = custom_evals.get(eval_id, {})
                if isinstance(cev_data, dict):
                    schemas[eval_id] = {
                        "name": cev_data.get("name", eval_id),
                        "output_schema": cev_data.get("output_schema", []),
                        "prompt": "",
                    }

        return schemas

    async def _generate_custom_eval_narrative(
        self,
        run: EvaluationRun,
        report: CustomEvaluationsReport,
        aggregator: CustomEvaluationsAggregator,
        metadata: ReportMetadata,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> CustomEvaluationsReport:
        """Generate AI narrative for custom eval report. Returns report with narrative attached."""
        try:
            llm, effective_model = await self._create_llm_provider(
                run, "custom_eval_narrative", llm_provider, llm_model,
            )
            if not llm:
                return report

            # Collect text/array samples for narrative context
            text_samples: dict[str, dict[str, list[str]]] = {}
            for section in report.evaluator_sections:
                text_fields = [
                    f.key for f in section.fields
                    if f.field_type in ("text", "array")
                ]
                if text_fields:
                    text_samples[section.evaluator_id] = aggregator.collect_text_samples(
                        section.evaluator_id, text_fields, k=10,
                    )

            narrator = CustomEvalNarrator(llm)
            narrative = await narrator.generate(
                report=report,
                text_samples=text_samples,
                metadata=metadata.model_dump(),
            )

            if narrative:
                report.narrative = narrative

        except Exception as e:
            logger.warning("Custom eval narrative generation skipped: %s", e)

        return report

    async def _load_analytics_config(self, app_id: str) -> AppAnalyticsConfig:
        app_row = await self.db.scalar(
            select(App).where(
                App.slug == app_id,
                App.is_active == True,
            )
        )
        if not app_row:
            raise ValueError(f"App not found: {app_id}")
        app_config = AppConfigSchema.model_validate(app_row.config or {})
        return app_config.analytics
