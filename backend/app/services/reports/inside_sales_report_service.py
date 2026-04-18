# backend/app/services/reports/inside_sales_report_service.py
"""Report service for inside sales evaluations.

Extends BaseReportService with inside-sales-specific aggregation and narration.
"""

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import load_only

from app.models.app import App
from app.models.eval_run import EvalRun
from app.models.evaluator import Evaluator
from app.models.external_agent import ExternalAgent
from app.schemas.app_config import AppConfig as AppConfigSchema
from app.schemas.app_analytics_config import AppAnalyticsConfig

from .base_report_service import BaseReportService
from .canonical_adapters import adapt_inside_sales_run_report
from .contracts.run_report import PlatformRunReportPayload
from .inside_sales_aggregator import aggregate_multi_evaluator
from .inside_sales_narrator import InsideSalesNarrator
from .inside_sales_schemas import (
    EvaluatorAggregate,
    InsideSalesReportMetadata,
    InsideSalesReportPayload,
)

logger = logging.getLogger(__name__)


class InsideSalesReportService(BaseReportService):
    payload_model = PlatformRunReportPayload

    async def _load_source_data(self, run_id: str) -> dict[str, list[dict]]:
        threads = await self._load_threads(run_id)
        return {
            "threads": [
                {
                    "thread_id": t.thread_id,
                    "result": t.result,
                    "success_status": t.success_status,
                }
                for t in threads
            ],
        }

    async def _build_payload(
        self,
        run: EvalRun,
        source_data: dict[str, list[dict]],
        llm_provider: str | None = None,
        llm_model: str | None = None,
        include_narrative: bool = True,
    ) -> PlatformRunReportPayload:
        thread_dicts = source_data["threads"]

        output_schemas, evaluator_names = await self._load_evaluator_schemas(run, thread_dicts)
        agent_names = await self._load_agent_names(thread_dicts)

        aggregate_data = aggregate_multi_evaluator(
            thread_dicts, output_schemas, agent_names, evaluator_names,
        )
        combined = aggregate_data["combined"]

        batch_meta = run.batch_metadata or {}
        metadata = InsideSalesReportMetadata(
            run_id=str(run.id),
            run_name=batch_meta.get("name"),
            app_id=run.app_id,
            eval_type=run.eval_type,
            created_at=run.created_at.isoformat() if run.created_at else "",
            llm_provider=run.llm_provider,
            llm_model=run.llm_model,
            total_calls=combined["runSummary"]["totalCalls"],
            evaluated_calls=combined["runSummary"]["evaluatedCalls"],
            duration_ms=run.duration_ms,
        )

        narrative = None
        narrative_model = None
        if include_narrative:
            try:
                llm, model_name = await self._create_llm_provider(
                    run, "inside_sales_narrative", llm_provider, llm_model,
                )
                if llm:
                    narrator = InsideSalesNarrator(llm)
                    narrative = await narrator.generate(aggregate_data)
                    narrative_model = model_name
            except Exception as e:
                logger.warning("Inside sales narrative skipped: %s", e)

        metadata.narrative_model = narrative_model

        per_evaluator_payload: dict[str, EvaluatorAggregate] = {}
        for ev_id, agg in aggregate_data["perEvaluator"].items():
            per_evaluator_payload[ev_id] = EvaluatorAggregate(
                id=agg["id"],
                name=agg["name"],
                run_summary=agg["runSummary"],
                dimension_breakdown=agg["dimensionBreakdown"],
                compliance_breakdown=agg["complianceBreakdown"],
                flag_stats=agg["flagStats"],
                agent_slices=agg["agentSlices"],
            )

        payload = InsideSalesReportPayload(
            metadata=metadata,
            run_summary=combined["runSummary"],
            dimension_breakdown=combined["dimensionBreakdown"],
            compliance_breakdown=combined["complianceBreakdown"],
            flag_stats=combined["flagStats"],
            agent_slices=combined["agentSlices"],
            narrative=narrative,
            per_evaluator=per_evaluator_payload or None,
        )
        analytics_config = await self._load_analytics_config(run.app_id)
        return adapt_inside_sales_run_report(payload, analytics_config)

    async def _load_evaluator_schemas(
        self, run: EvalRun, threads: list[dict] | None = None,
    ) -> tuple[dict[str, list[dict]], dict[str, str]]:
        """Collect every evaluator referenced by this run's threads and load their schemas.

        Returns (output_schemas, evaluator_names) each keyed by evaluator_id (str).
        Order follows first-appearance in `result.evaluations[]`, which matches the
        order the runner attached the evaluators.
        """
        ordered_ids: list[str] = []
        seen: set[str] = set()
        for t in threads or []:
            for ev in t.get("result", {}).get("evaluations", []) or []:
                ev_id = ev.get("evaluator_id")
                if ev_id and str(ev_id) not in seen:
                    seen.add(str(ev_id))
                    ordered_ids.append(str(ev_id))

        if not ordered_ids:
            config = run.config or {}
            fallback_id = config.get("evaluator_id")
            if fallback_id:
                ordered_ids = [str(fallback_id)]

        if not ordered_ids:
            logger.warning("No evaluator_id found for run %s, using empty schemas", run.id)
            return {}, {}

        try:
            uuids = [UUID(eid) for eid in ordered_ids]
        except (ValueError, TypeError) as e:
            logger.warning("Invalid evaluator_id in run %s: %s", run.id, e)
            return {}, {}

        try:
            result = await self.db.execute(
                select(Evaluator)
                .where(Evaluator.id.in_(uuids))
                .options(load_only(Evaluator.id, Evaluator.name, Evaluator.output_schema))
            )
            rows = list(result.scalars().all())
        except Exception as e:
            logger.warning("Failed to load evaluator schemas for run %s: %s", run.id, e)
            return {}, {}

        by_id = {str(r.id): r for r in rows}
        schemas: dict[str, list[dict]] = {}
        names: dict[str, str] = {}
        for eid in ordered_ids:
            row = by_id.get(eid)
            schemas[eid] = (row.output_schema if row else []) or []
            names[eid] = row.name if row else eid
        return schemas, names

    async def _load_agent_names(self, threads: list[dict]) -> dict[str, str]:
        agent_ids = set()
        for t in threads:
            meta = t.get("result", {}).get("call_metadata", {})
            aid = meta.get("agent_id")
            if aid:
                agent_ids.add(aid)

        if not agent_ids:
            return {}

        try:
            uuids = [UUID(aid) for aid in agent_ids]
            result = await self.db.execute(
                select(ExternalAgent).where(
                    ExternalAgent.id.in_(uuids),
                    ExternalAgent.tenant_id == self.tenant_id,
                )
                .options(load_only(ExternalAgent.id, ExternalAgent.name))
            )
            return {str(a.id): a.name for a in result.scalars().all()}
        except Exception as e:
            logger.warning("Failed to load agent names: %s", e)
            names = {}
            for t in threads:
                meta = t.get("result", {}).get("call_metadata", {})
                aid = meta.get("agent_id")
                if aid and aid not in names:
                    names[aid] = meta.get("agent", aid)
            return names

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
