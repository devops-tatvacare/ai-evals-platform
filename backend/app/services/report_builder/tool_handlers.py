"""
Executes tool calls from the LLM during report builder chat.
Each handler takes parsed arguments and returns a JSON-serializable result.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.report_builder.section_catalog import (
    get_section_detail,
    list_section_types,
)


async def _resolve_run_id(run_id: str, tenant_id: str, db: AsyncSession):
    """Resolve a short or full run ID to the actual UUID. Returns None if not found."""
    from sqlalchemy import select, String as SAString
    from app.models.eval_run import EvalRun

    q = select(EvalRun.id).where(EvalRun.tenant_id == tenant_id)
    if len(run_id) < 36:
        q = q.where(EvalRun.id.cast(SAString).startswith(run_id))
    else:
        q = q.where(EvalRun.id == run_id)
    r = await db.execute(q.limit(1))
    return r.scalar_one_or_none()


async def handle_list_section_types(**_kwargs: Any) -> dict:
    return {"sections": list_section_types()}


async def handle_get_section_detail(*, section_type: str, **_kwargs: Any) -> dict:
    detail = get_section_detail(section_type)
    if not detail:
        return {"error": f"Unknown section type: {section_type}"}
    return detail


async def handle_list_app_sections(
    *,
    app_id: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Look up analytics config for the app and return its declared sections."""
    try:
        from sqlalchemy import select
        from app.models.app import App

        result = await db.execute(
            select(App).where(App.slug == app_id, App.is_active.is_(True))
        )
        config = result.scalar_one_or_none()
        if not config:
            return {"error": f"No app config found for {app_id}"}

        analytics = (config.config or {}).get("analytics", {})
        single_run = analytics.get("singleRun", {})
        sections = single_run.get("sections", [])

        return {
            "app_id": app_id,
            "sections": [
                {
                    "id": s.get("id"),
                    "type": s.get("type"),
                    "title": s.get("title", ""),
                    "variant": s.get("variant", ""),
                }
                for s in sections
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_compose_report(
    *,
    report_name: str,
    sections: list[dict],
    **_kwargs: Any,
) -> dict:
    """Validate and return a preview-ready report config."""
    from app.services.report_builder.section_catalog import get_section_type

    errors: list[str] = []
    validated: list[dict] = []

    for section in sections:
        section_type = section.get("type", "")
        if not get_section_type(section_type):
            errors.append(f"Unknown section type: {section_type}")
            continue

        validated.append({
            "id": section.get("id", f"custom-{section_type}-{uuid.uuid4().hex[:6]}"),
            "type": section_type,
            "title": section.get("title", section_type.replace("_", " ").title()),
            "variant": section.get("variant", ""),
        })

    if errors:
        return {"status": "error", "errors": errors, "validated_sections": validated}

    return {
        "status": "ok",
        "report_name": report_name,
        "sections": validated,
        "preview_ready": True,
    }


async def handle_save_template(
    *,
    report_name: str,
    sections: list[dict],
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """Persist as a new ReportConfig row."""
    try:
        from app.models.report_config import ReportConfig

        report_id = f"custom-{uuid.uuid4().hex[:8]}"
        presentation_config = {
            "rendererId": "platform-default",
            "layoutGroups": [],
            "density": "default",
            "designTokens": {},
            "themeTokens": {},
            "sections": [
                {
                    "sectionId": s["id"],
                    "componentId": s["type"],
                    "title": s.get("title", ""),
                    "description": None,
                    "variant": s.get("variant", ""),
                    "printable": True,
                }
                for s in sections
            ],
        }
        export_config = {
            "enabled": True,
            "format": "pdf",
            "documentVariant": "platform-default",
            "sectionIds": [s["id"] for s in sections],
        }

        config = ReportConfig(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            report_id=report_id,
            scope="single_run",
            name=report_name,
            description=f"Custom report created via report builder",
            presentation_config=presentation_config,
            narrative_config={"enabled": False},
            export_config=export_config,
        )
        db.add(config)
        await db.flush()

        return {
            "status": "saved",
            "report_id": report_id,
            "report_name": report_name,
            "section_count": len(sections),
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_query_eval_runs(
    *,
    limit: int = 10,
    eval_type: str = "",
    db: AsyncSession,
    tenant_id: str,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """List recent eval runs for the app."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import EvalRun

        limit = min(max(limit, 1), 50)
        q = (
            select(EvalRun)
            .where(EvalRun.tenant_id == tenant_id, EvalRun.app_id == app_id)
            .order_by(desc(EvalRun.created_at))
            .limit(limit)
        )
        if eval_type:
            q = q.where(EvalRun.eval_type == eval_type)

        result = await db.execute(q)
        runs = result.scalars().all()

        return {
            "app_id": app_id,
            "count": len(runs),
            "runs": [
                {
                    "id": str(run.id)[:8],
                    "full_id": str(run.id),
                    "eval_type": run.eval_type,
                    "status": run.status,
                    "created_at": run.created_at.strftime("%Y-%m-%d %H:%M") if run.created_at else "",
                    "name": (run.batch_metadata or {}).get("name", ""),
                    "thread_count": (run.batch_metadata or {}).get("thread_count", 0),
                    "summary": _extract_run_summary(run.summary),
                }
                for run in runs
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


def _extract_run_summary(summary: dict | None) -> dict:
    """Extract key stats from a run's summary dict."""
    if not summary:
        return {}
    return {
        "avg_intent_accuracy": summary.get("avg_intent_accuracy"),
        "correctness_verdicts": summary.get("correctness_verdicts", {}),
        "efficiency_verdicts": summary.get("efficiency_verdicts", {}),
        "total_evaluated": summary.get("total_evaluated", 0),
    }


async def handle_get_run_summary(
    *,
    run_id: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Get detailed summary for a single run."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        result = await db.execute(select(EvalRun).where(EvalRun.id == real_run_id))
        run = result.scalar_one_or_none()
        if not run:
            return {"error": f"Run not found: {run_id}"}

        return {
            "id": str(run.id),
            "app_id": run.app_id,
            "eval_type": run.eval_type,
            "status": run.status,
            "created_at": run.created_at.strftime("%Y-%m-%d %H:%M") if run.created_at else "",
            "completed_at": run.completed_at.strftime("%Y-%m-%d %H:%M") if run.completed_at else "",
            "duration_ms": run.duration_ms,
            "name": (run.batch_metadata or {}).get("name", ""),
            "description": (run.batch_metadata or {}).get("description", ""),
            "thread_count": (run.batch_metadata or {}).get("thread_count", 0),
            "summary": run.summary or {},
            "config_snapshot": {
                "model": (run.config or {}).get("model", ""),
                "evaluator": (run.config or {}).get("evaluator_name", ""),
            },
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_compare_runs(
    *,
    run_id_a: str,
    run_id_b: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Compare two runs side by side."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun

        real_run_id_a = await _resolve_run_id(run_id_a, tenant_id, db)
        real_run_id_b = await _resolve_run_id(run_id_b, tenant_id, db)

        if not real_run_id_a:
            return {"error": f"Run A not found: {run_id_a}"}
        if not real_run_id_b:
            return {"error": f"Run B not found: {run_id_b}"}

        res_a = await db.execute(select(EvalRun).where(EvalRun.id == real_run_id_a))
        run_a = res_a.scalar_one_or_none()
        res_b = await db.execute(select(EvalRun).where(EvalRun.id == real_run_id_b))
        run_b = res_b.scalar_one_or_none()

        if not run_a:
            return {"error": f"Run A not found: {run_id_a}"}
        if not run_b:
            return {"error": f"Run B not found: {run_id_b}"}

        sum_a = run_a.summary or {}
        sum_b = run_b.summary or {}

        return {
            "run_a": {
                "id": str(run_a.id)[:8],
                "created_at": run_a.created_at.strftime("%Y-%m-%d") if run_a.created_at else "",
                "eval_type": run_a.eval_type,
                "summary": _extract_run_summary(sum_a),
            },
            "run_b": {
                "id": str(run_b.id)[:8],
                "created_at": run_b.created_at.strftime("%Y-%m-%d") if run_b.created_at else "",
                "eval_type": run_b.eval_type,
                "summary": _extract_run_summary(sum_b),
            },
            "deltas": _compute_deltas(sum_a, sum_b),
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


def _compute_deltas(sum_a: dict, sum_b: dict) -> dict:
    """Compute differences between two run summaries."""
    acc_a = sum_a.get("avg_intent_accuracy")
    acc_b = sum_b.get("avg_intent_accuracy")
    delta_accuracy = None
    if acc_a is not None and acc_b is not None:
        delta_accuracy = round(acc_b - acc_a, 3)

    cv_a = sum_a.get("correctness_verdicts", {})
    cv_b = sum_b.get("correctness_verdicts", {})
    total_a = sum(cv_a.values()) if cv_a else 0
    total_b = sum(cv_b.values()) if cv_b else 0
    pass_a = cv_a.get("PASS", 0) / total_a if total_a else 0
    pass_b = cv_b.get("PASS", 0) / total_b if total_b else 0

    return {
        "intent_accuracy_delta": delta_accuracy,
        "pass_rate_a": round(pass_a * 100, 1),
        "pass_rate_b": round(pass_b * 100, 1),
        "pass_rate_delta": round((pass_b - pass_a) * 100, 1),
        "total_evaluated_a": sum_a.get("total_evaluated", 0),
        "total_evaluated_b": sum_b.get("total_evaluated", 0),
    }


async def handle_query_threads(
    *,
    run_id: str,
    verdict: str = "",
    limit: int = 10,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """List threads from a specific run."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import ThreadEvaluation

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        limit = min(max(limit, 1), 50)
        tq = (
            select(ThreadEvaluation)
            .where(ThreadEvaluation.eval_run_id == real_run_id)
            .order_by(desc(ThreadEvaluation.created_at))
            .limit(limit)
        )
        if verdict:
            tq = tq.where(ThreadEvaluation.worst_correctness == verdict)

        result = await db.execute(tq)
        threads = result.scalars().all()

        return {
            "run_id": str(real_run_id)[:8],
            "count": len(threads),
            "threads": [
                {
                    "thread_id": t.thread_id,
                    "worst_correctness": t.worst_correctness or "N/A",
                    "efficiency_verdict": t.efficiency_verdict or "N/A",
                    "intent_accuracy": round(t.intent_accuracy, 2) if t.intent_accuracy is not None else None,
                    "success": t.success_status,
                }
                for t in threads
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_get_app_stats(
    *,
    db: AsyncSession,
    tenant_id: str,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """Get aggregate stats across all runs for the app."""
    try:
        from sqlalchemy import select, func
        from app.models.eval_run import EvalRun, ThreadEvaluation

        # Count runs
        run_count = await db.execute(
            select(func.count(EvalRun.id)).where(
                EvalRun.tenant_id == tenant_id,
                EvalRun.app_id == app_id,
            )
        )
        total_runs = run_count.scalar() or 0

        # Count threads
        thread_count = await db.execute(
            select(func.count(ThreadEvaluation.id)).join(EvalRun).where(
                EvalRun.tenant_id == tenant_id,
                EvalRun.app_id == app_id,
            )
        )
        total_threads = thread_count.scalar() or 0

        # Avg intent accuracy
        avg_acc = await db.execute(
            select(func.avg(ThreadEvaluation.intent_accuracy)).join(EvalRun).where(
                EvalRun.tenant_id == tenant_id,
                EvalRun.app_id == app_id,
                ThreadEvaluation.intent_accuracy.isnot(None),
            )
        )
        avg_intent = avg_acc.scalar()

        # Correctness distribution
        corr_dist = await db.execute(
            select(ThreadEvaluation.worst_correctness, func.count(ThreadEvaluation.id))
            .join(EvalRun)
            .where(
                EvalRun.tenant_id == tenant_id,
                EvalRun.app_id == app_id,
                ThreadEvaluation.worst_correctness.isnot(None),
            )
            .group_by(ThreadEvaluation.worst_correctness)
        )
        correctness = {row[0]: row[1] for row in corr_dist.all()}

        return {
            "app_id": app_id,
            "total_runs": total_runs,
            "total_threads_evaluated": total_threads,
            "avg_intent_accuracy": round(avg_intent, 3) if avg_intent else None,
            "correctness_distribution": correctness,
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_get_report_section(
    *,
    run_id: str,
    section_type: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Read a pre-computed report section from the analytics cache."""
    try:
        from sqlalchemy import select
        from app.models.evaluation_analytics import EvaluationAnalytics

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        result = await db.execute(
            select(EvaluationAnalytics.analytics_data).where(
                EvaluationAnalytics.run_id == real_run_id,
                EvaluationAnalytics.scope == "single_run",
            )
        )
        analytics_data = result.scalar_one_or_none()
        if not analytics_data:
            return {"error": f"No report generated for run {run_id}. Generate a report first."}

        # Find the section by type in the sections array
        sections = analytics_data.get("sections", [])
        for section in sections:
            if section.get("type") == section_type:
                return {
                    "run_id": str(real_run_id)[:8],
                    "section_type": section_type,
                    "title": section.get("title", section_type),
                    "data": section.get("data"),
                }

        available = [s.get("type") for s in sections]
        return {
            "error": f"Section '{section_type}' not found in report for run {run_id}.",
            "available_sections": available,
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_get_thread_detail(
    *,
    run_id: str,
    thread_id: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Get detailed evaluation result for a specific thread."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import ThreadEvaluation

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        result = await db.execute(
            select(ThreadEvaluation).where(
                ThreadEvaluation.eval_run_id == real_run_id,
                ThreadEvaluation.thread_id == thread_id,
            )
        )
        thread = result.scalar_one_or_none()
        if not thread:
            return {"error": f"Thread '{thread_id}' not found in run {run_id}"}

        evaluation = thread.result if isinstance(thread.result, dict) else {}

        # Extract rule outcomes from the judge result
        judge = evaluation.get("judge", evaluation.get("critique", {}))
        rule_outcomes = []
        for rule in judge.get("ruleOutcomes", judge.get("rule_outcomes", [])):
            rule_outcomes.append({
                "rule": rule.get("ruleName", rule.get("rule_name", rule.get("rule", ""))),
                "verdict": rule.get("verdict", ""),
                "reason": rule.get("reason", rule.get("justification", ""))[:200],
            })

        # Extract transcript excerpt (truncated)
        thread_data = evaluation.get("thread", {})
        messages = thread_data.get("messages", [])
        transcript = []
        char_count = 0
        for msg in messages[:10]:  # max 10 turns
            query = msg.get("query_text", msg.get("user", ""))[:150]
            response = msg.get("final_response_message", msg.get("assistant", ""))[:150]
            if query:
                transcript.append({"role": "user", "text": query})
            if response:
                transcript.append({"role": "assistant", "text": response})
            char_count += len(query) + len(response)
            if char_count > 500:
                break

        # Extract friction turns
        efficiency = evaluation.get("efficiency_evaluation", {})
        friction_turns = [
            {"turn": ft.get("turn"), "cause": ft.get("cause"), "description": ft.get("description", "")[:100]}
            for ft in efficiency.get("friction_turns", [])[:5]
        ]

        return {
            "run_id": str(real_run_id)[:8],
            "thread_id": thread_id,
            "verdicts": {
                "worst_correctness": thread.worst_correctness,
                "efficiency_verdict": thread.efficiency_verdict,
                "intent_accuracy": round(thread.intent_accuracy, 2) if thread.intent_accuracy is not None else None,
                "success": thread.success_status,
            },
            "rule_outcomes": rule_outcomes,
            "friction_turns": friction_turns,
            "recovery_quality": efficiency.get("recovery_quality"),
            "transcript_excerpt": transcript,
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_get_rule_compliance(
    *,
    run_id: str,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """Compute rule compliance using the ReportAggregator."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun, ThreadEvaluation
        from app.services.reports.aggregator import ReportAggregator

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        # Load the run for summary
        run_result = await db.execute(select(EvalRun).where(EvalRun.id == real_run_id))
        run = run_result.scalar_one_or_none()
        if not run:
            return {"error": f"Run not found: {run_id}"}

        # Load threads
        thread_result = await db.execute(
            select(ThreadEvaluation).where(ThreadEvaluation.eval_run_id == real_run_id)
        )
        threads = list(thread_result.scalars().all())
        if not threads:
            return {"error": f"No threads found for run {run_id}"}

        # Use the aggregator
        agg = ReportAggregator(threads=threads, adversarial=[], run_summary=run.summary or {})
        compliance = agg.compute_rule_compliance()

        return {
            "run_id": str(real_run_id)[:8],
            "total_threads": len(threads),
            "rules": [
                {
                    "rule": r.rule_id,
                    "section": r.section,
                    "passed": r.passed,
                    "failed": r.failed,
                    "compliance_rate": round(r.rate * 100, 1),
                    "severity": r.severity,
                }
                for r in compliance.rules
            ],
            "co_failures": [
                {
                    "rule_a": cf.rule_a,
                    "rule_b": cf.rule_b,
                    "co_occurrence_rate": round(cf.co_occurrence_rate * 100, 1),
                }
                for cf in compliance.co_failures[:5]
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_query_adversarial(
    *,
    run_id: str,
    limit: int = 20,
    db: AsyncSession,
    tenant_id: str,
    **_kwargs: Any,
) -> dict:
    """List adversarial test results for a run."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import AdversarialEvaluation

        real_run_id = await _resolve_run_id(run_id, tenant_id, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        limit = min(max(limit, 1), 50)
        result = await db.execute(
            select(AdversarialEvaluation)
            .where(AdversarialEvaluation.eval_run_id == real_run_id)
            .order_by(desc(AdversarialEvaluation.created_at))
            .limit(limit)
        )
        cases = result.scalars().all()
        if not cases:
            return {"error": f"No adversarial evaluations found for run {run_id}"}

        achieved = sum(1 for c in cases if c.goal_achieved)

        return {
            "run_id": str(real_run_id)[:8],
            "total": len(cases),
            "goals_achieved": achieved,
            "goals_blocked": len(cases) - achieved,
            "achievement_rate": round(achieved / len(cases) * 100, 1) if cases else 0,
            "cases": [
                {
                    "verdict": c.verdict or "N/A",
                    "goal_achieved": c.goal_achieved,
                    "goal_flow": c.goal_flow or [],
                    "difficulty": c.difficulty or "N/A",
                    "active_traits": c.active_traits or [],
                    "total_turns": c.total_turns,
                }
                for c in cases
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


TOOL_HANDLER_MAP = {
    "list_section_types": handle_list_section_types,
    "get_section_detail": handle_get_section_detail,
    "list_app_sections": handle_list_app_sections,
    "compose_report": handle_compose_report,
    "save_template": handle_save_template,
    "query_eval_runs": handle_query_eval_runs,
    "get_run_summary": handle_get_run_summary,
    "compare_runs": handle_compare_runs,
    "query_threads": handle_query_threads,
    "get_app_stats": handle_get_app_stats,
    "get_report_section": handle_get_report_section,
    "get_thread_detail": handle_get_thread_detail,
    "get_rule_compliance": handle_get_rule_compliance,
    "query_adversarial": handle_query_adversarial,
}


async def dispatch_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    app_id: str,
) -> str:
    """Route a tool call to its handler and return JSON string result."""
    handler = TOOL_HANDLER_MAP.get(tool_name)
    if not handler:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    # Context kwargs (db, tenant_id, etc.) take precedence over LLM-supplied args
    context = dict(db=db, tenant_id=tenant_id, user_id=user_id, app_id=app_id)
    safe_args = {k: v for k, v in arguments.items() if k not in context}
    result = await handler(**safe_args, **context)
    return json.dumps(result, default=str)
