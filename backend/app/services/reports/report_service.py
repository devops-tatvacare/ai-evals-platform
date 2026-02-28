"""Orchestrates report generation: load → aggregate → narrate → assemble.

Phase 1: Infrastructure (data loading, health score, metadata).
Phase 2: Aggregation engine (distributions, compliance, friction, exemplars).
Phase 3: AI narrative generation via LLM.
"""

import logging
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation
from app.services.evaluators.llm_base import create_llm_provider, LoggingLLMWrapper
from app.services.evaluators.runner_utils import save_api_log
from app.services.evaluators.settings_helper import get_llm_settings_from_db, _detect_service_account_path

from .aggregator import AdversarialAggregator, ReportAggregator
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
        if not force_refresh and run.report_cache:
            try:
                return ReportPayload.model_validate(run.report_cache)
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

        # Aggregate — same interface for both aggregator types
        distributions = agg.compute_distributions()
        rule_compliance = agg.compute_rule_compliance()
        friction = agg.compute_friction_analysis()
        exemplars = agg.select_exemplars(k=5)
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
        )

        # Cache for future requests
        await self._save_cache(run_id, payload)

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
            # Try DB settings first; fall back to direct SA detection if DB
            # has no llm-settings row (common when only service account is used).
            try:
                settings = await get_llm_settings_from_db(
                    app_id=run.app_id,
                    auth_intent="managed_job",
                )
            except RuntimeError:
                sa_path = _detect_service_account_path()
                if not sa_path and not llm_provider:
                    raise
                settings = {
                    "provider": llm_provider or "gemini",
                    "selected_model": llm_model or "",
                    "api_key": "",
                    "service_account_path": sa_path,
                }

            # Override with user-selected provider/model if provided
            effective_provider = llm_provider or settings["provider"]
            effective_model = llm_model or settings["selected_model"]

            if not effective_model:
                logger.warning("Narrative generation skipped: no model specified")
                return None, None

            provider = create_llm_provider(
                provider=effective_provider,
                api_key=settings["api_key"],
                model_name=effective_model,
                service_account_path=settings["service_account_path"],
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

    async def _save_cache(self, run_id: str, payload: ReportPayload) -> None:
        """Persist report payload to eval_run.report_cache."""
        try:
            stmt = (
                update(EvalRun)
                .where(EvalRun.id == UUID(run_id))
                .values(report_cache=payload.model_dump())
            )
            await self.db.execute(stmt)
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
