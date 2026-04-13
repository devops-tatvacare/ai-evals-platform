"""
Executes tool calls from the LLM during report builder chat.
Each handler takes parsed arguments and returns a JSON-serializable result.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.report_builder.section_catalog import (
    get_section_detail,
    list_section_types,
)

_DISCOVERY_VOLUME_LABELS = {
    'analytics_run_facts': 'runs',
    'analytics_eval_facts': 'evaluations',
    'analytics_criterion_facts': 'criteria',
}


def _app_access_clause_for_tools(model, auth):
    """App-access clause matching eval_runs routes pattern."""
    from sqlalchemy.sql import true, false
    if auth.is_owner:
        return true()
    if not auth.app_access:
        return false()
    return model.app_id.in_(tuple(sorted(auth.app_access)))


async def _resolve_run_id(run_id: str, auth, db: AsyncSession):
    """Resolve a short or full run ID to the actual UUID. Returns None if not found."""
    from sqlalchemy import select, String as SAString
    from app.models.eval_run import EvalRun
    from app.services.access_control import readable_scope_clause

    q = select(EvalRun.id).where(
        readable_scope_clause(EvalRun, auth),
        _app_access_clause_for_tools(EvalRun, auth),
    )
    if len(run_id) < 36:
        q = q.where(EvalRun.id.cast(SAString).startswith(run_id))
    else:
        q = q.where(EvalRun.id == run_id)
    r = await db.execute(q.limit(1))
    return r.scalar_one_or_none()


def _display_id(value: Any) -> str:
    return str(value)[:8]


async def _load_active_semantic_model(db: AsyncSession, app_id: str) -> dict[str, Any]:
    from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model

    return load_semantic_model(app_id, app_config=await load_app_config(db, app_id))


def _dimension_lookup_map(semantic_model: dict[str, Any]) -> dict[str, dict[str, Any]]:
    from app.services.chat_engine.sql_agent import _normalize_dimensions

    return {
        str(dimension['name']).lower(): dimension
        for dimension in _normalize_dimensions(semantic_model)
    }


def _table_scope_columns(semantic_model: dict[str, Any], table_name: str) -> tuple[str, str]:
    tables = semantic_model.get('tables', {})
    table_config = tables.get(table_name, {}) if isinstance(tables, dict) else {}
    access = table_config.get('access_control', {}) if isinstance(table_config, dict) else {}
    tenant_column = access.get('tenant_column', 'tenant_id')
    app_column = access.get('app_column', 'app_id')
    return app_column, tenant_column


async def handle_discover(
    *,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    session: dict[str, Any] | None = None,
    **_kwargs: Any,
) -> dict:
    scratchpad = (session or {}).get('scratchpad', {}) if session else {}
    cached = scratchpad.get('discovery')
    if isinstance(cached, dict) and cached.get('app_id') == app_id:
        return {**cached, 'cache_hit': True}

    semantic_model = await _load_active_semantic_model(db, app_id)
    dimensions = _dimension_lookup_map(semantic_model)
    metrics = semantic_model.get('metrics', {})
    params = {
        'app_id': app_id,
        'tenant_id': str(getattr(auth, 'tenant_id', '')),
        'limit': 25,
    }
    errors: list[str] = []
    dimension_payload: list[dict[str, Any]] = []
    volume: dict[str, int] = {}

    for name, dimension in dimensions.items():
        table_name = dimension['table']
        expression = dimension['expression']
        app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
        try:
            result = await db.execute(
                text(
                    f"""
                    SELECT {expression} AS value, COUNT(*) AS n
                    FROM {table_name}
                    WHERE {app_column} = :app_id
                      AND {tenant_column} = :tenant_id
                      AND ({expression}) IS NOT NULL
                      AND ({expression})::text <> ''
                    GROUP BY 1
                    ORDER BY 2 DESC, 1 ASC
                    LIMIT :limit
                    """
                ),
                params,
            )
            values = [
                {'value': row[0], 'count': row[1]}
                for row in result.all()
                if row[0] not in (None, '')
            ]
            dimension_payload.append({
                'name': dimension['name'],
                'description': dimension.get('description', ''),
                'values': values,
            })
        except Exception as exc:
            errors.append(f"{dimension['name']}: {exc}")

    tables = semantic_model.get('tables', {})
    if isinstance(tables, dict):
        for table_name in tables.keys():
            app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
            try:
                result = await db.execute(
                    text(
                        f"""
                        SELECT COUNT(*) AS n
                        FROM {table_name}
                        WHERE {app_column} = :app_id
                          AND {tenant_column} = :tenant_id
                        """
                    ),
                    params,
                )
                volume[_DISCOVERY_VOLUME_LABELS.get(table_name, table_name)] = int(result.scalar() or 0)
            except Exception as exc:
                errors.append(f'{table_name}: {exc}')

    time_range = {}
    if 'analytics_run_facts' in tables:
        run_app_column, run_tenant_column = _table_scope_columns(semantic_model, 'analytics_run_facts')
        try:
            result = await db.execute(
                text(
                    f"""
                    SELECT
                        MIN(created_at)::date::text AS earliest,
                        MAX(created_at)::date::text AS latest
                    FROM analytics_run_facts
                    WHERE {run_app_column} = :app_id
                      AND {run_tenant_column} = :tenant_id
                    """
                ),
                params,
            )
            row = result.first()
            if row:
                time_range = {
                    'earliest': row[0],
                    'latest': row[1],
                }
        except Exception as exc:
            errors.append(f'time_range: {exc}')

    metric_payload = []
    if isinstance(metrics, dict):
        metric_payload = [
            {
                'name': name,
                'description': definition.get('description', ''),
            }
            for name, definition in metrics.items()
            if isinstance(definition, dict)
        ]

    result_payload = {
        'status': 'ok' if dimension_payload or metric_payload or volume or time_range else 'error',
        'app_id': app_id,
        'time_range': time_range,
        'volume': volume,
        'dimensions': sorted(dimension_payload, key=lambda item: item['name']),
        'metrics': metric_payload,
    }
    if errors:
        result_payload['errors'] = errors
    if result_payload['status'] == 'error':
        result_payload['error'] = 'No discoverable data found for this app.'
    return result_payload


async def handle_lookup(
    *,
    dimension: str,
    search: str = '',
    limit: int = 25,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    semantic_model = await _load_active_semantic_model(db, app_id)
    dimensions = _dimension_lookup_map(semantic_model)
    dimension_def = dimensions.get(dimension.lower())
    if not dimension_def:
        return {
            'status': 'error',
            'error': f'Unknown dimension: {dimension}',
            'available_dimensions': sorted(dimensions.keys()),
        }

    table_name = dimension_def['table']
    expression = dimension_def['expression']
    app_column, tenant_column = _table_scope_columns(semantic_model, table_name)
    params = {
        'app_id': app_id,
        'tenant_id': str(getattr(auth, 'tenant_id', '')),
        'limit': min(max(limit, 1), 100),
    }
    search_clause = ''
    if search.strip():
        params['search'] = f"%{search.strip()}%"
        search_clause = f' AND ({expression})::text ILIKE :search'

    try:
        result = await db.execute(
            text(
                f"""
                SELECT {expression} AS value, COUNT(*) AS n
                FROM {table_name}
                WHERE {app_column} = :app_id
                  AND {tenant_column} = :tenant_id
                  AND ({expression}) IS NOT NULL
                  AND ({expression})::text <> ''
                  {search_clause}
                GROUP BY 1
                ORDER BY 2 DESC, 1 ASC
                LIMIT :limit
                """
            ),
            params,
        )
        values = [
            {'value': row[0], 'count': row[1]}
            for row in result.all()
            if row[0] not in (None, '')
        ]
        return {
            'status': 'ok',
            'dimension': dimension_def['name'],
            'search': search or None,
            'values': values,
        }
    except Exception as exc:
        return {
            'status': 'error',
            'error': f'Lookup failed for {dimension}: {exc}',
        }


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
    auth,
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
    auth,
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
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
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
    auth,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """List recent eval runs for the app."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import EvalRun
        from app.services.access_control import readable_scope_clause

        limit = min(max(limit, 1), 50)
        q = (
            select(EvalRun)
            .where(
                readable_scope_clause(EvalRun, auth),
                _app_access_clause_for_tools(EvalRun, auth),
                EvalRun.app_id == app_id,
            )
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
                    "id": str(run.id),
                    "display_id": _display_id(run.id),
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
    auth,
    **_kwargs: Any,
) -> dict:
    """Get detailed summary for a single run."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun

        real_run_id = await _resolve_run_id(run_id, auth, db)
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
    auth,
    **_kwargs: Any,
) -> dict:
    """Compare two runs side by side."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun

        real_run_id_a = await _resolve_run_id(run_id_a, auth, db)
        real_run_id_b = await _resolve_run_id(run_id_b, auth, db)

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
                "id": str(run_a.id),
                "display_id": _display_id(run_a.id),
                "created_at": run_a.created_at.strftime("%Y-%m-%d") if run_a.created_at else "",
                "eval_type": run_a.eval_type,
                "summary": _extract_run_summary(sum_a),
            },
            "run_b": {
                "id": str(run_b.id),
                "display_id": _display_id(run_b.id),
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
    auth,
    **_kwargs: Any,
) -> dict:
    """List threads from a specific run."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import ThreadEvaluation

        real_run_id = await _resolve_run_id(run_id, auth, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        limit = min(max(limit, 1), 50)
        tq = (
            select(ThreadEvaluation)
            .where(ThreadEvaluation.run_id == real_run_id)
            .order_by(desc(ThreadEvaluation.created_at))
            .limit(limit)
        )
        if verdict:
            tq = tq.where(ThreadEvaluation.worst_correctness == verdict)

        result = await db.execute(tq)
        threads = result.scalars().all()

        return {
            "run_id": str(real_run_id),
            "display_id": _display_id(real_run_id),
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
    auth,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """Get aggregate stats across all runs for the app."""
    try:
        from sqlalchemy import select, func
        from app.models.eval_run import EvalRun, ThreadEvaluation
        from app.services.access_control import readable_scope_clause

        accessible = (
            readable_scope_clause(EvalRun, auth),
            _app_access_clause_for_tools(EvalRun, auth),
            EvalRun.app_id == app_id,
        )

        # Count runs
        run_count = await db.execute(
            select(func.count(EvalRun.id)).where(*accessible)
        )
        total_runs = run_count.scalar() or 0

        # Count threads
        thread_count = await db.execute(
            select(func.count(ThreadEvaluation.id)).join(EvalRun).where(*accessible)
        )
        total_threads = thread_count.scalar() or 0

        # Avg intent accuracy
        avg_acc = await db.execute(
            select(func.avg(ThreadEvaluation.intent_accuracy)).join(EvalRun).where(
                *accessible,
                ThreadEvaluation.intent_accuracy.isnot(None),
            )
        )
        avg_intent = avg_acc.scalar()

        # Correctness distribution
        corr_dist = await db.execute(
            select(ThreadEvaluation.worst_correctness, func.count(ThreadEvaluation.id))
            .join(EvalRun)
            .where(
                *accessible,
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
    auth,
    **_kwargs: Any,
) -> dict:
    """Read a pre-computed report section from the analytics cache."""
    try:
        from sqlalchemy import select
        from app.models.evaluation_analytics import EvaluationAnalytics

        real_run_id = await _resolve_run_id(run_id, auth, db)
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
                    "run_id": str(real_run_id),
                    "display_id": _display_id(real_run_id),
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
    auth,
    **_kwargs: Any,
) -> dict:
    """Get detailed evaluation result for a specific thread."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import ThreadEvaluation

        real_run_id = await _resolve_run_id(run_id, auth, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        result = await db.execute(
            select(ThreadEvaluation).where(
                ThreadEvaluation.run_id == real_run_id,
                ThreadEvaluation.thread_id == thread_id,
            )
        )
        thread = result.scalar_one_or_none()
        if not thread:
            return {"error": f"Thread '{thread_id}' not found in run {run_id}"}

        evaluation = thread.result if isinstance(thread.result, dict) else {}

        # Extract rule outcomes from correctness evaluations
        rule_outcomes = []
        for ce in evaluation.get("correctness_evaluations", []):
            for rc in ce.get("rule_compliance", []):
                rule_outcomes.append({
                    "rule": rc.get("rule_id", ""),
                    "section": rc.get("section", ""),
                    "status": rc.get("status", ""),
                    "followed": rc.get("followed"),
                    "evidence": (rc.get("evidence", "") or "")[:200],
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
            "run_id": str(real_run_id),
            "display_id": _display_id(real_run_id),
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
    auth,
    **_kwargs: Any,
) -> dict:
    """Compute rule compliance using the ReportAggregator."""
    try:
        from sqlalchemy import select
        from app.models.eval_run import EvalRun, ThreadEvaluation
        from app.services.reports.aggregator import ReportAggregator

        real_run_id = await _resolve_run_id(run_id, auth, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        # Load the run for summary
        run_result = await db.execute(select(EvalRun).where(EvalRun.id == real_run_id))
        run = run_result.scalar_one_or_none()
        if not run:
            return {"error": f"Run not found: {run_id}"}

        # Load threads
        thread_result = await db.execute(
            select(ThreadEvaluation).where(ThreadEvaluation.run_id == real_run_id)
        )
        threads = list(thread_result.scalars().all())
        if not threads:
            return {"error": f"No threads found for run {run_id}"}

        # Use the aggregator
        agg = ReportAggregator(threads=threads, adversarial=[], run_summary=run.summary or {})
        compliance = agg.compute_rule_compliance()

        return {
            "run_id": str(real_run_id),
            "display_id": _display_id(real_run_id),
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
    auth,
    **_kwargs: Any,
) -> dict:
    """List adversarial test results for a run."""
    try:
        from sqlalchemy import select, desc
        from app.models.eval_run import AdversarialEvaluation

        real_run_id = await _resolve_run_id(run_id, auth, db)
        if not real_run_id:
            return {"error": f"Run not found: {run_id}"}

        limit = min(max(limit, 1), 50)
        result = await db.execute(
            select(AdversarialEvaluation)
            .where(AdversarialEvaluation.run_id == real_run_id)
            .order_by(desc(AdversarialEvaluation.created_at))
            .limit(limit)
        )
        cases = result.scalars().all()
        if not cases:
            return {"error": f"No adversarial evaluations found for run {run_id}"}

        achieved = sum(1 for c in cases if c.goal_achieved)

        return {
            "run_id": str(real_run_id),
            "display_id": _display_id(real_run_id),
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


async def handle_get_cross_run_rule_compliance(
    *,
    limit: int = 20,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    **_kwargs: Any,
) -> dict:
    """Aggregate rule compliance across ALL runs for the app."""
    try:
        from collections import defaultdict
        from sqlalchemy import select
        from app.models.eval_run import EvalRun, ThreadEvaluation
        from app.services.access_control import readable_scope_clause

        # Get all accessible completed runs for this app
        run_q = (
            select(EvalRun.id)
            .where(
                readable_scope_clause(EvalRun, auth),
                _app_access_clause_for_tools(EvalRun, auth),
                EvalRun.app_id == app_id,
                EvalRun.status == "completed",
            )
        )
        run_result = await db.execute(run_q)
        run_ids = [r[0] for r in run_result.all()]
        if not run_ids:
            return {"error": "No completed runs found for this app"}

        # Load all threads across those runs
        thread_result = await db.execute(
            select(ThreadEvaluation).where(ThreadEvaluation.run_id.in_(run_ids))
        )
        threads = thread_result.scalars().all()
        if not threads:
            return {"error": "No evaluated threads found"}

        # Aggregate rule compliance across all threads
        rule_stats: dict[str, dict] = defaultdict(lambda: {
            "passed": 0, "failed": 0, "not_applicable": 0, "run_ids": set(),
        })

        for thread in threads:
            result = thread.result if isinstance(thread.result, dict) else {}
            for ce in result.get("correctness_evaluations", []):
                for rc in ce.get("rule_compliance", []):
                    rule_id = rc.get("rule_id", "")
                    if not rule_id:
                        continue
                    stats = rule_stats[rule_id]
                    stats["run_ids"].add(str(thread.run_id))
                    status = rc.get("status", "")
                    if status == "FOLLOWED":
                        stats["passed"] += 1
                    elif status == "VIOLATED":
                        stats["failed"] += 1
                    elif status == "NOT_APPLICABLE":
                        stats["not_applicable"] += 1

        # Sort by most violated
        sorted_rules = sorted(
            rule_stats.items(),
            key=lambda x: x[1]["failed"],
            reverse=True,
        )

        limit = min(max(limit, 1), 100)
        return {
            "app_id": app_id,
            "total_runs_analyzed": len(run_ids),
            "total_threads_analyzed": len(threads),
            "rules": [
                {
                    "rule": rule_id,
                    "passed": s["passed"],
                    "failed": s["failed"],
                    "not_applicable": s["not_applicable"],
                    "total_evaluated": s["passed"] + s["failed"],
                    "compliance_rate": round(
                        s["passed"] / (s["passed"] + s["failed"]) * 100, 1
                    ) if (s["passed"] + s["failed"]) > 0 else None,
                    "appeared_in_runs": len(s["run_ids"]),
                }
                for rule_id, s in sorted_rules[:limit]
            ],
        }
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}


async def handle_analyze(
    *,
    question: str,
    db: AsyncSession,
    auth: Any,
    app_id: str,
    provider: str | None = None,
    **_kwargs: Any,
) -> dict:
    """Semantic SQL agent — generates and executes SQL from natural language."""
    from app.services.chat_engine.sql_agent import analyze
    return await analyze(question=question, db=db, auth=auth, app_id=app_id, provider=provider)


async def handle_render_chart(
    *,
    chart_type: str,
    title: str,
    x_key: str,
    y_key: str | None = None,
    series_keys: list[str] | None = None,
    x_label: str = "",
    y_label: str = "",
    **_kwargs: Any,
) -> dict:
    """Package chart spec for frontend rendering. Data comes from prior analyze call."""
    return {
        "status": "ok",
        "chart_spec": {
            "type": chart_type,
            "title": title,
            "xKey": x_key,
            "yKey": y_key,
            "seriesKeys": series_keys or [],
            "xLabel": x_label,
            "yLabel": y_label,
        },
    }


TOOL_HANDLER_MAP = {
    'discover': handle_discover,
    'lookup': handle_lookup,
    # Report builder tools (action tools)
    "list_section_types": handle_list_section_types,
    "get_section_detail": handle_get_section_detail,
    "list_app_sections": handle_list_app_sections,
    "compose_report": handle_compose_report,
    "save_template": handle_save_template,
    # Semantic analytics (replaces all fixed data explorer tools)
    "analyze": handle_analyze,
    "render_chart": handle_render_chart,
    # Deprecated but kept for backwards compat if referenced
    "query_eval_runs": handle_query_eval_runs,
    "get_run_summary": handle_get_run_summary,
    "compare_runs": handle_compare_runs,
    "query_threads": handle_query_threads,
    "get_app_stats": handle_get_app_stats,
    "get_report_section": handle_get_report_section,
    "get_thread_detail": handle_get_thread_detail,
    "get_rule_compliance": handle_get_rule_compliance,
    "query_adversarial": handle_query_adversarial,
    "get_cross_run_rule_compliance": handle_get_cross_run_rule_compliance,
}


async def dispatch_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    db: AsyncSession,
    auth: "Any",
    app_id: str,
    provider: str | None = None,
    session: dict[str, Any] | None = None,
) -> str:
    """Route a tool call to its handler and return JSON string result."""
    import time

    start = time.monotonic()
    handler = TOOL_HANDLER_MAP.get(tool_name)
    if not handler:
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="unknown_tool", execution_ms=0,
        )
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    # Context kwargs (db, auth, app_id, provider, session) take precedence over LLM-supplied args
    context: dict[str, Any] = dict(db=db, auth=auth, app_id=app_id, provider=provider, session=session)
    safe_args = {k: v for k, v in arguments.items() if k not in context}

    try:
        result = await handler(**safe_args, **context)
        elapsed = (time.monotonic() - start) * 1000
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="ok", execution_ms=elapsed, result=result,
        )
        return json.dumps(result, default=str)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        await _log_tool_call(
            tool_name, arguments, auth, app_id,
            status="error", execution_ms=elapsed, error=str(e),
        )
        return json.dumps({"error": str(e)})


async def _log_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    auth: Any,
    app_id: str,
    *,
    status: str,
    execution_ms: float = 0,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Fire-and-forget logging to agent_tool_logs.

    Uses its own session so the insert commits independently of the
    caller's transaction (the chat handler only commits for save_template).
    """
    try:
        from app.database import async_session as _log_session
        from app.models.analytics_log import AgentToolLog

        row_count = None
        generated_sql = None
        validated_sql = None
        cache_hit = False

        if isinstance(result, dict):
            row_count = result.get("row_count")
            generated_sql = result.get("generated_sql")
            validated_sql = result.get("sql_used")
            cache_hit = bool(result.get("cache_hit", False))

        async with _log_session() as log_db:
            log = AgentToolLog(
                tenant_id=getattr(auth, "tenant_id", None),
                user_id=getattr(auth, "user_id", None),
                app_id=app_id,
                tool_name=tool_name,
                arguments=arguments,
                generated_sql=generated_sql,
                validated_sql=validated_sql,
                execution_ms=execution_ms,
                row_count=row_count,
                status=status,
                error_message=error[:2000] if error else None,
                cache_hit=cache_hit,
            )
            log_db.add(log)
            await log_db.commit()
    except Exception:
        pass  # Never fail the tool call because logging failed
