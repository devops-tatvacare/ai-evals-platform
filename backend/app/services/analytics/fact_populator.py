"""Fact population orchestrator — loads run, extracts facts, bulk inserts."""
from __future__ import annotations

import inspect
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_facts import FactEvaluationCriterion, FactEvaluation, AggEvaluationRun
from app.models.analytics_lead_facts import FactLeadSignal
from app.models.analytics_log import LogFactPopulationRun
from app.models.eval_run import EvaluationRunAdversarialResult, EvaluationRun, EvaluationRunThreadResult
from app.models.evaluator import Evaluator
from app.services.analytics.extractors import EXTRACTORS
from app.services.analytics.signal_extractor import build_signal_rows
from app.services.analytics.types import FactSet, PopulationResult

logger = logging.getLogger(__name__)


class FactPopulator:
    """Extracts analytics facts from a completed eval run."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def populate(self, run_id: UUID) -> PopulationResult:
        """Main entry point. Idempotent — deletes existing facts before inserting."""
        start = time.monotonic()
        errors: list[str] = []
        log: LogFactPopulationRun | None = None

        try:
            # 1. Load run first — we need tenant context for the log
            run = await self._load_run(run_id)
            if not run:
                raise ValueError(f"EvaluationRun {run_id} not found")

            # 2. Create job log now that we have tenant context
            log = LogFactPopulationRun(
                run_id=run_id,
                app_id=run.app_id,
                tenant_id=run.tenant_id,
                job_type="populate_facts",
                status="running",
                started_at=datetime.now(timezone.utc),
            )
            self.db.add(log)
            await self.db.flush()

            # 3. Find extractor
            extractor = EXTRACTORS.get(run.eval_type)
            if not extractor:
                raise ValueError(f"No extractor for eval_type: {run.eval_type}")

            # 4. Load children based on eval_type
            children = await self._load_children(run)

            # 5. Extract facts (extractors that need extra context opt in via kwargs)
            extractor_kwargs = await self._build_extractor_kwargs(extractor, run, children)
            fact_set = extractor(run, children, **extractor_kwargs)

            # 6. Delete existing facts for idempotency
            deleted = await self._delete_existing(run_id)

            # 7. Bulk insert
            rows_inserted = await self._bulk_insert(fact_set)

            # 8. Inside-sales lead-signal facts (Roadmap 01 §8.4).
            # Reads the canonical merged ``result.signals`` array
            # produced by ``inside_sales_runner.merge_thread_signals``;
            # never reads nested per-evaluator copies.
            signal_rows_inserted = await self._populate_lead_signals(run, children)
            rows_inserted += signal_rows_inserted

            # 9. Update log
            elapsed = (time.monotonic() - start) * 1000
            log.status = "completed"
            log.rows_inserted = rows_inserted
            log.rows_deleted = deleted
            log.duration_ms = elapsed
            log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

            logger.info(
                "Populated analytics for run %s: %d rows in %.0fms",
                run_id, rows_inserted, elapsed,
            )
            return PopulationResult(
                run_id=run_id,
                rows_inserted=rows_inserted,
                duration_ms=elapsed,
                errors=errors,
            )

        except Exception as e:
            elapsed = (time.monotonic() - start) * 1000
            logger.error("Analytics population failed for run %s: %s", run_id, e, exc_info=True)
            try:
                if log is not None:
                    log.status = "failed"
                    log.error_message = str(e)[:2000]
                    log.duration_ms = elapsed
                    log.completed_at = datetime.now(timezone.utc)
                    await self.db.commit()
                else:
                    await self.db.rollback()
            except Exception:
                await self.db.rollback()
            raise

    async def _load_run(self, run_id: UUID) -> EvaluationRun | None:
        result = await self.db.execute(
            select(EvaluationRun).where(EvaluationRun.id == run_id)
        )
        return result.scalar_one_or_none()

    async def _build_extractor_kwargs(self, extractor, _run: EvaluationRun, children: list) -> dict:
        """Pre-load auxiliary inputs for extractors that opt in via named parameters.

        Currently only `evaluator_schemas` is supported — fetched when the extractor
        accepts that kwarg, by collecting evaluator_ids from `result.evaluations[]`.
        """
        params = inspect.signature(extractor).parameters
        kwargs: dict = {}
        if "evaluator_schemas" in params:
            kwargs["evaluator_schemas"] = await self._load_evaluator_schemas(children)
        return kwargs

    async def _load_evaluator_schemas(self, children: list) -> dict[str, list[dict]]:
        """Collect distinct evaluator_ids from thread results and fetch their output_schemas."""
        evaluator_ids: set[UUID] = set()
        for child in children:
            result = getattr(child, "result", None) or {}
            for ev in result.get("evaluations", []) or []:
                ev_id = ev.get("evaluator_id")
                if ev_id:
                    try:
                        evaluator_ids.add(UUID(str(ev_id)))
                    except (ValueError, TypeError):
                        continue
        if not evaluator_ids:
            return {}
        rows = await self.db.execute(
            select(Evaluator.id, Evaluator.output_schema).where(Evaluator.id.in_(evaluator_ids))
        )
        return {str(row.id): (row.output_schema or []) for row in rows}

    async def _load_children(self, run: EvaluationRun) -> list:
        """Load child evaluations based on eval_type."""
        if run.eval_type in ("batch_thread", "call_quality"):
            result = await self.db.execute(
                select(EvaluationRunThreadResult).where(EvaluationRunThreadResult.run_id == run.id)
            )
            return list(result.scalars().all())
        elif run.eval_type == "batch_adversarial":
            result = await self.db.execute(
                select(EvaluationRunAdversarialResult).where(EvaluationRunAdversarialResult.run_id == run.id)
            )
            return list(result.scalars().all())
        else:
            # full_evaluation, custom — no child rows needed
            return []

    async def _populate_lead_signals(
        self, run: EvaluationRun, children: list
    ) -> int:
        """Delete-then-insert ``analytics.fact_lead_signal`` for this run.

        Only call-quality eval runs carry the inside-sales signals
        contract today (Roadmap 01 §8.4 / §8.5). Non-thread-grain runs
        (e.g. adversarial, full-evaluation) are skipped — there's
        nothing for the extractor to read.
        """
        if run.eval_type != "call_quality":
            return 0
        thread_children = [
            c for c in (children or []) if isinstance(c, EvaluationRunThreadResult)
        ]
        # Delete-then-insert per ``eval_run_id`` so re-running
        # ``populate-analytics`` is idempotent (Roadmap 01 §13).
        await self.db.execute(
            delete(FactLeadSignal).where(FactLeadSignal.eval_run_id == run.id)
        )
        rows = build_signal_rows(run, thread_children)
        if not rows:
            await self.db.flush()
            return 0
        for row in rows:
            self.db.add(FactLeadSignal(**row))
        await self.db.flush()
        return len(rows)

    async def _delete_existing(self, run_id: UUID) -> int:
        """Delete existing fact rows for this run. Returns total deleted count."""
        total = 0
        for model in (FactEvaluationCriterion, FactEvaluation, AggEvaluationRun):
            result = await self.db.execute(
                delete(model).where(model.run_id == run_id)
            )
            total += result.rowcount
        await self.db.flush()
        return total

    async def _bulk_insert(self, fact_set: FactSet) -> int:
        """Bulk insert all fact rows. Returns total row count."""
        count = 0

        # Run fact
        self.db.add(AggEvaluationRun(
            run_id=fact_set.run_fact.run_id,
            app_id=fact_set.run_fact.app_id,
            tenant_id=fact_set.run_fact.tenant_id,
            user_id=fact_set.run_fact.user_id,
            eval_type=fact_set.run_fact.eval_type,
            status=fact_set.run_fact.status,
            created_at=fact_set.run_fact.created_at,
            completed_at=fact_set.run_fact.completed_at,
            duration_ms=fact_set.run_fact.duration_ms,
            thread_count=fact_set.run_fact.thread_count,
            pass_count=fact_set.run_fact.pass_count,
            fail_count=fact_set.run_fact.fail_count,
            error_count=fact_set.run_fact.error_count,
            pass_rate=fact_set.run_fact.pass_rate,
            avg_intent_accuracy=fact_set.run_fact.avg_intent_accuracy,
            adversarial_total=fact_set.run_fact.adversarial_total,
            adversarial_blocked=fact_set.run_fact.adversarial_blocked,
            adversarial_block_rate=fact_set.run_fact.adversarial_block_rate,
            run_name=fact_set.run_fact.run_name,
            avg_score=fact_set.run_fact.avg_score,
            context=fact_set.run_fact.context,
        ))
        count += 1

        # Eval facts
        for ef in fact_set.eval_facts:
            self.db.add(FactEvaluation(
                run_id=ef.run_id,
                app_id=ef.app_id,
                tenant_id=ef.tenant_id,
                eval_type=ef.eval_type,
                item_id=ef.item_id,
                item_type=ef.item_type,
                evaluator_type=ef.evaluator_type,
                evaluator_name=ef.evaluator_name,
                evaluator_id=ef.evaluator_id,
                result_status=ef.result_status,
                result_score=ef.result_score,
                result_verdict=ef.result_verdict,
                success=ef.success,
                agent=ef.agent,
                direction=ef.direction,
                duration_seconds=ef.duration_seconds,
                intent=ef.intent,
                route=ef.route,
                query_type=ef.query_type,
                difficulty=ef.difficulty,
                total_turns=ef.total_turns,
                result_detail=ef.result_detail,
                context=ef.context,
                created_at=ef.created_at,
            ))
        count += len(fact_set.eval_facts)

        # Criterion facts
        for cf in fact_set.criterion_facts:
            self.db.add(FactEvaluationCriterion(
                run_id=cf.run_id,
                app_id=cf.app_id,
                tenant_id=cf.tenant_id,
                item_id=cf.item_id,
                criterion_source=cf.criterion_source,
                criterion_id=cf.criterion_id,
                criterion_label=cf.criterion_label,
                evaluator_type=cf.evaluator_type,
                status=cf.status,
                passed=cf.passed,
                evidence=cf.evidence,
                created_at=cf.created_at,
            ))
        count += len(fact_set.criterion_facts)

        await self.db.flush()
        return count
