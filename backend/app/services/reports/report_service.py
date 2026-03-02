"""Orchestrates report generation: load → aggregate → narrate → assemble.

Phase 1: Infrastructure (data loading, health score, metadata).
Phase 2: Aggregation engine (distributions, compliance, friction, exemplars).
Phase 3: AI narrative generation via LLM.
"""

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import load_only

from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation
from app.models.evaluation_analytics import EvaluationAnalytics
from app.models.evaluator import Evaluator
from app.services.evaluators.llm_base import create_llm_provider, LoggingLLMWrapper
from app.services.evaluators.runner_utils import save_api_log
from app.services.evaluators.settings_helper import get_llm_settings_from_db

from .aggregator import AdversarialAggregator, ReportAggregator
from .custom_evaluations.aggregator import CustomEvaluationsAggregator
from .custom_evaluations.narrator import CustomEvalNarrator
from .custom_evaluations.schemas import CustomEvaluationsReport
from .health_score import compute_adversarial_health_score, compute_health_score
from .narrator import ReportNarrator
from .prompts.production_prompts import get_production_prompts
from .schemas import (
    Exemplars,
    NarrativeOutput,
    ProductionPrompts,
    ReportMetadata,
    ReportPayload,
)

logger = logging.getLogger(__name__)


class ReportService:
    """Stateless per-request report generator.

    Usage:
        service = ReportService(db_session)
        payload = await service.generate(run_id)
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate(
        self,
        run_id: str,
        force_refresh: bool = False,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> ReportPayload:
        """Full report generation pipeline.

        1. Check cache (unless force_refresh)
        2. Load EvalRun + ThreadEvaluations + AdversarialEvaluations
        3. Compute health score from run summary
        4. Aggregate metrics via ReportAggregator
        5. Generate AI narrative via LLM (non-blocking — failure is OK)
        6. Assemble ReportPayload and cache it
        """
        run = await self._load_run(run_id)

        # Return cached report if available
        if not force_refresh:
            cached = await self._load_cache(run_id, run.app_id)
            if cached:
                try:
                    return ReportPayload.model_validate(cached)
                except Exception:
                    logger.warning("Report cache corrupted for run %s, regenerating", run_id)

        threads = await self._load_threads(run_id)
        adversarial = await self._load_adversarial(run_id)

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

        # Production prompts (static constants for gap analysis)
        prod_prompts = get_production_prompts(run.app_id)
        production_prompts = ProductionPrompts(
            intent_classification=prod_prompts.get("intent_classification"),
            meal_summary_spec=prod_prompts.get("meal_summary_spec"),
        )

        # AI Narrative (non-blocking — failure is OK)
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
        if custom_eval_report and custom_eval_agg:
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
            production_prompts=production_prompts,
            narrative=narrative,
            custom_evaluations_report=custom_eval_report,
        )

        # Cache for future requests
        await self._save_cache(run_id, run.app_id, payload)

        return payload

    # --- AI Narrative ---

    async def _generate_narrative(
        self,
        run: EvalRun,
        metadata: ReportMetadata,
        health_score,
        distributions,
        rule_compliance,
        friction,
        adversarial_breakdown,
        exemplars,
        prod_prompts: dict,
        llm_provider: str | None = None,
        llm_model: str | None = None,
        is_adversarial: bool = False,
    ) -> tuple[NarrativeOutput | None, str | None]:
        """Call LLM for narrative. Returns (narrative, model_used) tuple."""
        try:
            settings = await get_llm_settings_from_db(
                auth_intent="managed_job",
                provider_override=llm_provider or None,
            )

            # Override with user-selected provider/model if provided
            effective_provider = llm_provider or settings["provider"]
            effective_model = llm_model or settings["selected_model"]

            if not effective_model:
                logger.warning("Narrative generation skipped: no model specified")
                return None, None

            factory_kwargs = {}
            if effective_provider == "azure_openai":
                factory_kwargs["azure_endpoint"] = settings.get("azure_endpoint", "")
                factory_kwargs["api_version"] = settings.get("api_version", "")

            provider = create_llm_provider(
                provider=effective_provider,
                api_key=settings["api_key"],
                model_name=effective_model,
                service_account_path=settings.get("service_account_path", ""),
                **factory_kwargs,
            )

            # Wrap with logging for API log visibility
            llm = LoggingLLMWrapper(provider, log_callback=save_api_log)
            llm.set_context(run_id=str(run.id), thread_id="report_narrative")

            narrator = ReportNarrator(llm)
            result = await narrator.generate(
                metadata=metadata.model_dump(),
                health_score=health_score.model_dump(),
                distributions=distributions.model_dump(),
                rule_compliance=rule_compliance.model_dump(),
                friction=friction.model_dump(),
                adversarial=adversarial_breakdown.model_dump() if adversarial_breakdown else None,
                exemplars=exemplars.model_dump(),
                production_prompts=prod_prompts,
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

    # --- Cache persistence ---

    async def _load_cache(self, run_id: str, app_id: str) -> dict | None:
        """Load cached report from evaluation_analytics table."""
        try:
            result = await self.db.execute(
                select(EvaluationAnalytics.analytics_data)
                .where(
                    EvaluationAnalytics.scope == "single_run",
                    EvaluationAnalytics.run_id == UUID(run_id),
                    EvaluationAnalytics.app_id == app_id,
                )
            )
            row = result.scalar_one_or_none()
            return row if row else None
        except Exception as e:
            logger.warning("Failed to load cache for run %s: %s", run_id, e)
            return None

    async def _save_cache(self, run_id: str, app_id: str, payload: ReportPayload) -> None:
        """Persist report payload to evaluation_analytics table."""
        try:
            from datetime import datetime, timezone
            data = payload.model_dump()
            now = datetime.now(timezone.utc)

            # Check for existing row
            result = await self.db.execute(
                select(EvaluationAnalytics)
                .where(
                    EvaluationAnalytics.scope == "single_run",
                    EvaluationAnalytics.run_id == UUID(run_id),
                    EvaluationAnalytics.app_id == app_id,
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.analytics_data = data
                existing.computed_at = now
            else:
                row = EvaluationAnalytics(
                    app_id=app_id,
                    scope="single_run",
                    run_id=UUID(run_id),
                    analytics_data=data,
                    computed_at=now,
                )
                self.db.add(row)

            await self.db.commit()
        except Exception as e:
            logger.warning("Failed to cache report for run %s: %s", run_id, e)

    # --- Data loading ---

    async def _load_run(self, run_id: str) -> EvalRun:
        """Load EvalRun or raise ValueError (caught as 404 by route)."""
        run = await self.db.get(EvalRun, UUID(run_id))
        if not run:
            raise ValueError(f"Eval run not found: {run_id}")
        return run

    async def _load_threads(self, run_id: str) -> list[ThreadEvaluation]:
        """Load all ThreadEvaluation rows for a run."""
        result = await self.db.execute(
            select(ThreadEvaluation)
            .where(ThreadEvaluation.run_id == UUID(run_id))
        )
        return list(result.scalars().all())

    async def _load_adversarial(self, run_id: str) -> list[AdversarialEvaluation]:
        """Load all AdversarialEvaluation rows for a run."""
        result = await self.db.execute(
            select(AdversarialEvaluation)
            .where(AdversarialEvaluation.run_id == UUID(run_id))
        )
        return list(result.scalars().all())

    # --- Metadata ---

    def _build_metadata(
        self,
        run: EvalRun,
        threads: list[ThreadEvaluation],
        adversarial: list[AdversarialEvaluation],
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
        run: EvalRun,
        report: CustomEvaluationsReport,
        aggregator: CustomEvaluationsAggregator,
        metadata: ReportMetadata,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> CustomEvaluationsReport:
        """Generate AI narrative for custom eval report. Returns report with narrative attached."""
        try:
            settings = await get_llm_settings_from_db(
                auth_intent="managed_job",
                provider_override=llm_provider or None,
            )

            effective_provider = llm_provider or settings["provider"]
            effective_model = llm_model or settings["selected_model"]

            if not effective_model:
                return report

            factory_kwargs = {}
            if effective_provider == "azure_openai":
                factory_kwargs["azure_endpoint"] = settings.get("azure_endpoint", "")
                factory_kwargs["api_version"] = settings.get("api_version", "")

            provider = create_llm_provider(
                provider=effective_provider,
                api_key=settings["api_key"],
                model_name=effective_model,
                service_account_path=settings.get("service_account_path", ""),
                **factory_kwargs,
            )

            llm = LoggingLLMWrapper(provider, log_callback=save_api_log)
            llm.set_context(run_id=str(run.id), thread_id="custom_eval_narrative")

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
