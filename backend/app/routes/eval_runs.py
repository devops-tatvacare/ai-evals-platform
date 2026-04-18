"""Eval runs API - unified query for ALL evaluation run results."""
import logging
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, desc, asc, func, delete as sql_delete, true, false, or_, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.database import get_db
from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation, ApiLog
from app.models.listing import Listing
from app.models.job import Job
from app.models.user import User
from app.models.report_run import ReportRun
from app.schemas.base import CamelModel
from app.schemas.eval_run import EvalRunVisibilityUpdate
from app.services.evaluators.adversarial_canonical import enrich_adversarial_result_for_api
from app.services.evaluators.thread_canonical import enrich_thread_result_for_api
from app.services.access_control import readable_scope_clause
from app.models.mixins.shareable import Visibility

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/eval-runs", tags=["eval-runs"])
threads_router = APIRouter(prefix="/api/threads", tags=["threads"])


def _app_access_clause(model, auth: AuthContext):
    if auth.is_owner:
        return true()
    if not auth.app_access:
        return false()
    return model.app_id.in_(tuple(sorted(auth.app_access)))


async def _get_readable_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    auth: AuthContext,
) -> EvalRun:
    run = await db.scalar(
        select(EvalRun).where(
            EvalRun.id == run_id,
            readable_scope_clause(EvalRun, auth),
            _app_access_clause(EvalRun, auth),
        )
    )
    if not run:
        raise HTTPException(404, "Run not found")
    return run


async def _get_owned_run(
    db: AsyncSession,
    *,
    run_id: UUID,
    auth: AuthContext,
) -> EvalRun:
    run = await db.scalar(
        select(EvalRun).where(
            EvalRun.id == run_id,
            EvalRun.tenant_id == auth.tenant_id,
            EvalRun.user_id == auth.user_id,
            _app_access_clause(EvalRun, auth),
        )
    )
    if not run:
        raise HTTPException(404, "Run not found")
    return run


# Map high-level run_type (UI concept) to the eval_type values stored in DB.
_RUN_TYPE_MAP: dict[str, tuple[str, ...]] = {
    "batch": ("batch_thread", "batch_adversarial"),
    "adversarial": ("batch_adversarial", "adversarial"),
    "thread": ("thread", "batch_thread"),
    "custom": ("custom",),
    "evaluation": ("full_evaluation",),
}

# Whitelist of sortable columns on EvalRun.
_SORT_COLUMNS = {
    "created_at": EvalRun.created_at,
    "status": EvalRun.status,
    "eval_type": EvalRun.eval_type,
    "duration_ms": EvalRun.duration_ms,
}

_LOG_COLUMNS = (
    ApiLog.id.label("id"),
    ApiLog.run_id.label("run_id"),
    ApiLog.thread_id.label("thread_id"),
    ApiLog.test_case_label.label("test_case_label"),
    ApiLog.provider.label("provider"),
    ApiLog.model.label("model"),
    ApiLog.method.label("method"),
    ApiLog.prompt.label("prompt"),
    ApiLog.system_prompt.label("system_prompt"),
    ApiLog.response.label("response"),
    ApiLog.error.label("error"),
    ApiLog.duration_ms.label("duration_ms"),
    ApiLog.tokens_in.label("tokens_in"),
    ApiLog.tokens_out.label("tokens_out"),
    ApiLog.created_at.label("created_at"),
)


def _build_log_runs_subquery(
    *,
    auth: AuthContext,
    app_id: str | None,
    run_id: UUID | None,
):
    filters = [
        readable_scope_clause(EvalRun, auth),
        _app_access_clause(EvalRun, auth),
    ]
    if app_id:
        filters.append(EvalRun.app_id == app_id)
    if run_id:
        filters.append(EvalRun.id == run_id)

    return (
        select(
            EvalRun.id.label("run_id"),
            EvalRun.eval_type.label("eval_type"),
            EvalRun.batch_metadata.label("batch_metadata"),
        )
        .where(*filters)
        .subquery()
    )


def _log_mapping_to_dict(log: Mapping[str, Any]) -> dict[str, Any]:
    created_at = log["created_at"]
    return {
        "id": log["id"],
        "run_id": str(log["run_id"]) if log["run_id"] else None,
        "thread_id": log["thread_id"],
        "test_case_label": log["test_case_label"],
        "provider": log["provider"],
        "model": log["model"],
        "method": log["method"],
        "prompt": log["prompt"],
        "system_prompt": log["system_prompt"],
        "response": log["response"],
        "error": log["error"],
        "duration_ms": log["duration_ms"],
        "tokens_in": log["tokens_in"],
        "tokens_out": log["tokens_out"],
        "created_at": created_at.isoformat() if created_at else None,
    }


@router.get("")
async def list_eval_runs(
    app_id: Optional[str] = Query(None),
    eval_type: Optional[str] = Query(None),
    listing_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    evaluator_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    command: Optional[str] = Query(None, description="Legacy filter — maps to eval_type"),
    run_type: Optional[str] = Query(None, description="UI-level type: batch/adversarial/thread/custom/evaluation"),
    q: Optional[str] = Query(None, description="Search run id, evaluator name"),
    sort: Optional[str] = Query(None, description="Sort column: created_at, status, eval_type, duration_ms"),
    order: Optional[str] = Query(None, description="asc or desc"),
    page: Optional[int] = Query(None, ge=1),
    page_size: Optional[int] = Query(None, ge=1, le=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Unified list with filters, scoped to readable runs.

    Two response shapes:
      - If ``page`` is provided: returns ``{items, total_items, page, page_size}``.
      - Otherwise (legacy): returns a flat list of run dicts.
    """
    filters = [
        readable_scope_clause(EvalRun, auth),
        _app_access_clause(EvalRun, auth),
    ]

    if app_id:
        filters.append(EvalRun.app_id == app_id)
    if eval_type:
        filters.append(EvalRun.eval_type == eval_type)
    if listing_id:
        filters.append(EvalRun.listing_id == UUID(listing_id))
    if session_id:
        filters.append(EvalRun.session_id == UUID(session_id))
    if evaluator_id:
        filters.append(EvalRun.evaluator_id == UUID(evaluator_id))
    if status:
        filters.append(EvalRun.status == status)
    if command:
        type_map = {
            "evaluate-batch": "batch_thread",
            "adversarial": "batch_adversarial",
        }
        mapped = type_map.get(command, command)
        filters.append(EvalRun.eval_type == mapped)
    if run_type:
        mapped_types = _RUN_TYPE_MAP.get(run_type)
        if mapped_types:
            filters.append(EvalRun.eval_type.in_(mapped_types))
    if q:
        like = f"%{q.strip()}%"
        filters.append(
            or_(
                cast(EvalRun.id, String).ilike(like),
                cast(func.json_extract_path_text(EvalRun.summary, "evaluator_name"), String).ilike(like),
                cast(func.json_extract_path_text(EvalRun.config, "evaluator_name"), String).ilike(like),
                cast(func.json_extract_path_text(EvalRun.batch_metadata, "name"), String).ilike(like),
            )
        )

    sort_col = _SORT_COLUMNS.get(sort or "created_at", EvalRun.created_at)
    sort_order = asc if (order or "desc").lower() == "asc" else desc

    base = (
        select(EvalRun, User.display_name)
        .outerjoin(User, (User.id == EvalRun.user_id) & (User.tenant_id == EvalRun.tenant_id))
        .where(*filters)
        .order_by(sort_order(sort_col))
    )

    if page is not None:
        effective_size = page_size or 25
        total_items = await db.scalar(
            select(func.count()).select_from(EvalRun).where(*filters)
        ) or 0
        query = base.limit(effective_size).offset((page - 1) * effective_size)
        result = await db.execute(query)
        items = [_run_to_dict(r, owner_name=name) for r, name in result.all()]
        return {
            "items": items,
            "total_items": int(total_items),
            "page": page,
            "page_size": effective_size,
        }

    # Legacy limit/offset response
    query = base.limit(limit).offset(offset)
    result = await db.execute(query)
    return [_run_to_dict(r, owner_name=name) for r, name in result.all()]


class DateRange(CamelModel):
    start: str
    end: str


class CsvPreviewResponse(CamelModel):
    total_messages: int
    total_threads: int
    total_users: int
    date_range: Optional[DateRange] = None
    thread_ids: list[str]
    intent_distribution: dict[str, int]
    messages_with_errors: int
    messages_with_images: int


@router.post("/preview", response_model=CsvPreviewResponse)
async def preview_csv(
    file: UploadFile = File(...),
    _auth: AuthContext = require_app_access(),
):
    """Parse an uploaded CSV and return statistics without persisting anything."""
    from app.services.evaluators.data_loader import DataLoader

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "File must be a CSV")

    try:
        content = await file.read()
        csv_text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded text")

    try:
        loader = DataLoader(csv_content=csv_text)
        stats = loader.get_statistics()
        thread_ids = loader.get_all_thread_ids()
    except Exception as e:
        logger.warning(f"CSV parse error: {e}")
        raise HTTPException(422, f"Failed to parse CSV: {e}")

    return CsvPreviewResponse(
        total_messages=stats["total_messages"],
        total_threads=stats["total_threads"],
        total_users=stats["total_users"],
        date_range=stats.get("date_range"),
        thread_ids=sorted(thread_ids),
        intent_distribution=stats.get("intent_distribution", {}),
        messages_with_errors=stats.get("messages_with_errors", 0),
        messages_with_images=stats.get("messages_with_images", 0),
    )


@router.get("/stats/summary")
async def get_summary_stats(
    app_id: Optional[str] = Query(None),
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Stats across readable evaluation runs."""
    # Total runs
    runs_q = select(func.count(EvalRun.id)).where(
        readable_scope_clause(EvalRun, auth),
        _app_access_clause(EvalRun, auth),
    )
    if app_id:
        runs_q = runs_q.where(EvalRun.app_id == app_id)
    total_runs = (await db.execute(runs_q)).scalar() or 0

    # Thread/adversarial queries need JOIN to EvalRun for ownership check
    def _thread_q(base_select):
        q = base_select.join(EvalRun, ThreadEvaluation.run_id == EvalRun.id).where(
            readable_scope_clause(EvalRun, auth),
            _app_access_clause(EvalRun, auth),
        )
        if app_id:
            q = q.where(EvalRun.app_id == app_id)
        return q

    def _adv_q(base_select):
        q = base_select.join(EvalRun, AdversarialEvaluation.run_id == EvalRun.id).where(
            readable_scope_clause(EvalRun, auth),
            _app_access_clause(EvalRun, auth),
        )
        if app_id:
            q = q.where(EvalRun.app_id == app_id)
        return q

    total_threads = (await db.execute(
        _thread_q(select(func.count(func.distinct(ThreadEvaluation.thread_id))))
    )).scalar() or 0
    total_adversarial = (await db.execute(
        _adv_q(select(func.count(AdversarialEvaluation.id)))
    )).scalar() or 0

    # Correctness distribution
    corr_result = await db.execute(
        _thread_q(
            select(ThreadEvaluation.worst_correctness, func.count())
            .where(ThreadEvaluation.worst_correctness.isnot(None))
        ).group_by(ThreadEvaluation.worst_correctness)
    )
    correctness_distribution = {r[0]: r[1] for r in corr_result.all()}

    # Efficiency distribution
    eff_result = await db.execute(
        _thread_q(
            select(ThreadEvaluation.efficiency_verdict, func.count())
            .where(ThreadEvaluation.efficiency_verdict.isnot(None))
        ).group_by(ThreadEvaluation.efficiency_verdict)
    )
    efficiency_distribution = {r[0]: r[1] for r in eff_result.all()}

    # Adversarial distribution
    adv_result = await db.execute(
        _adv_q(
            select(AdversarialEvaluation.verdict, func.count())
            .where(AdversarialEvaluation.verdict.isnot(None))
        ).group_by(AdversarialEvaluation.verdict)
    )
    adversarial_distribution = {r[0]: r[1] for r in adv_result.all()}

    # Average intent accuracy
    avg_intent = (await db.execute(
        _thread_q(
            select(func.avg(ThreadEvaluation.intent_accuracy))
            .where(ThreadEvaluation.intent_accuracy.isnot(None))
        )
    )).scalar()

    # Intent distribution (F5: only count threads with non-null intent_accuracy)
    intent_distribution = {}
    intent_evaluated_count = (await db.execute(
        _thread_q(
            select(func.count())
            .select_from(ThreadEvaluation)
            .where(ThreadEvaluation.intent_accuracy.isnot(None))
        )
    )).scalar() or 0
    if intent_evaluated_count > 0:
        correct_count = (await db.execute(
            _thread_q(
                select(func.count())
                .select_from(ThreadEvaluation)
                .where(ThreadEvaluation.intent_accuracy >= 0.5)
            )
        )).scalar() or 0
        intent_distribution = {
            "CORRECT": correct_count,
            "INCORRECT": intent_evaluated_count - correct_count,
        }

    return {
        "total_runs": total_runs,
        "total_threads_evaluated": total_threads,
        "total_adversarial_tests": total_adversarial,
        "correctness_distribution": correctness_distribution,
        "efficiency_distribution": efficiency_distribution,
        "adversarial_distribution": adversarial_distribution,
        "avg_intent_accuracy": float(avg_intent) if avg_intent is not None else None,
        "intent_distribution": intent_distribution,
    }


@router.get("/trends")
async def get_trends(
    days: int = Query(30, ge=1, le=365),
    app_id: Optional[str] = Query(None),
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate correctness verdicts by day for readable runs."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    q = (
        select(
            func.date(ThreadEvaluation.created_at).label("day"),
            ThreadEvaluation.worst_correctness,
            func.count().label("cnt"),
        )
        .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
        .where(
            readable_scope_clause(EvalRun, auth),
            _app_access_clause(EvalRun, auth),
            ThreadEvaluation.created_at >= cutoff,
            ThreadEvaluation.worst_correctness.isnot(None),
        )
    )
    if app_id:
        q = q.where(EvalRun.app_id == app_id)
    q = q.group_by(func.date(ThreadEvaluation.created_at), ThreadEvaluation.worst_correctness)
    q = q.order_by(func.date(ThreadEvaluation.created_at))

    result = await db.execute(q)
    rows = result.all()
    return {
        "data": [
            {"day": str(r.day), "worst_correctness": r.worst_correctness, "cnt": r.cnt}
            for r in rows
        ],
        "days": days,
    }


@router.get("/logs")
async def list_all_logs(
    run_id: Optional[str] = Query(None),
    app_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """List API logs scoped to readable runs."""
    parsed_run_id = UUID(run_id) if run_id else None
    filtered_runs = _build_log_runs_subquery(auth=auth, app_id=app_id, run_id=parsed_run_id)
    per_run_window = limit + offset
    run_logs = (
        select(*_LOG_COLUMNS)
        .where(ApiLog.run_id == filtered_runs.c.run_id)
        .order_by(ApiLog.id.desc())
        .limit(per_run_window)
        .lateral("run_logs")
    )
    query = (
        select(*run_logs.c, filtered_runs.c.eval_type, filtered_runs.c.batch_metadata)
        .select_from(filtered_runs.join(run_logs, true()))
        .order_by(run_logs.c.id.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = (await db.execute(query)).mappings().all()

    run_log_counts = (
        select(func.count(ApiLog.id).label("log_count"))
        .where(ApiLog.run_id == filtered_runs.c.run_id)
        .lateral("run_log_counts")
    )
    total_q = select(func.coalesce(func.sum(run_log_counts.c.log_count), 0)).select_from(
        filtered_runs.outerjoin(run_log_counts, true())
    )
    total = int((await db.execute(total_q)).scalar() or 0)

    logs_out = []
    for row in rows:
        d = _log_mapping_to_dict(row)
        d["eval_type"] = row["eval_type"]
        d["run_name"] = (row["batch_metadata"] or {}).get("name")
        logs_out.append(d)

    return {
        "logs": logs_out,
        "total": total,
        "limit": limit,
        "offset": offset,
        "run_id": run_id,
    }


@router.delete("/logs")
async def delete_logs(
    run_id: Optional[str] = Query(None),
    app_id: Optional[str] = Query(None),
    auth: AuthContext = require_permission('evaluation:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Delete API logs scoped to runs owned by the current user."""
    sub = (
        select(ApiLog.id)
        .join(EvalRun, ApiLog.run_id == EvalRun.id)
        .where(
            EvalRun.tenant_id == auth.tenant_id,
            EvalRun.user_id == auth.user_id,
            _app_access_clause(EvalRun, auth),
        )
    )
    if run_id:
        sub = sub.where(ApiLog.run_id == UUID(run_id))
    if app_id:
        sub = sub.where(EvalRun.app_id == app_id)

    stmt = sql_delete(ApiLog).where(ApiLog.id.in_(sub))
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount, "run_id": run_id}



@router.get("/{run_id}")
async def get_eval_run(
    run_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    run = await _get_readable_run(db, run_id=run_id, auth=auth)
    return _run_to_dict(run)


@router.patch("/{run_id}/visibility")
async def patch_eval_run_visibility(
    run_id: UUID,
    req: EvalRunVisibilityUpdate,
    auth: AuthContext = require_permission('asset:share'),
    db: AsyncSession = Depends(get_db),
):
    run = await _get_owned_run(db, run_id=run_id, auth=auth)
    run.visibility = req.visibility
    if req.visibility == Visibility.SHARED:
        run.shared_by = auth.user_id
        run.shared_at = datetime.now(timezone.utc)
    else:
        run.shared_by = None
        run.shared_at = None
    report_runs = (
        await db.execute(
            select(ReportRun).where(
                ReportRun.source_eval_run_id == run_id,
                ReportRun.tenant_id == auth.tenant_id,
            )
        )
    ).scalars().all()
    for report_run in report_runs:
        report_run.visibility = run.visibility
        report_run.shared_by = run.shared_by
        report_run.shared_at = run.shared_at
    await db.commit()
    await db.refresh(run)
    return _run_to_dict(run)


@router.delete("/{run_id}")
async def delete_eval_run(
    run_id: UUID,
    auth: AuthContext = require_permission('evaluation:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Delete an eval run and all its cascaded data."""
    run = await _get_owned_run(db, run_id=run_id, auth=auth)
    if run.status == "running":
        raise HTTPException(400, "Cannot delete a running evaluation. Cancel it first.")

    job_id = run.job_id  # Capture before delete
    await db.delete(run)  # CASCADE deletes threads, adversarial, logs

    # Clean up orphaned job
    if job_id:
        job = await db.scalar(
            select(Job).where(
                Job.id == job_id,
                Job.tenant_id == auth.tenant_id,
                Job.user_id == auth.user_id,
            )
        )
        if job:
            await db.delete(job)

    await db.commit()
    return {"deleted": True, "run_id": str(run_id)}


@router.get("/{run_id}/threads")
async def get_run_threads(
    run_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _get_readable_run(db, run_id=run_id, auth=auth)

    result = await db.execute(
        select(ThreadEvaluation).where(ThreadEvaluation.run_id == run_id)
    )
    evals = result.scalars().all()
    return {"run_id": str(run_id), "evaluations": [_thread_to_dict(e) for e in evals], "total": len(evals)}


@router.get("/{run_id}/adversarial")
async def get_run_adversarial(
    run_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _get_readable_run(db, run_id=run_id, auth=auth)

    result = await db.execute(
        select(AdversarialEvaluation).where(AdversarialEvaluation.run_id == run_id)
    )
    evals = result.scalars().all()
    return {"run_id": str(run_id), "evaluations": [_adv_to_dict(e) for e in evals], "total": len(evals)}


@router.get("/{run_id}/logs")
async def get_run_logs(
    run_id: UUID,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _get_readable_run(db, run_id=run_id, auth=auth)

    result = await db.execute(
        select(ApiLog).where(ApiLog.run_id == run_id)
        .order_by(desc(ApiLog.id)).limit(limit).offset(offset)
    )
    return {"run_id": str(run_id), "logs": [_log_to_dict_full(log) for log in result.scalars().all()]}


# ── Thread history (separate router) ───────────────────────────

@threads_router.get("/{thread_id}/history")
async def get_thread_history(
    thread_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Get all evaluation results for a specific thread across readable runs."""
    result = await db.execute(
        select(ThreadEvaluation)
        .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
        .where(
            ThreadEvaluation.thread_id == thread_id,
            readable_scope_clause(EvalRun, auth),
            _app_access_clause(EvalRun, auth),
        )
        .order_by(desc(ThreadEvaluation.id))
    )
    evals = result.scalars().all()
    return {
        "thread_id": thread_id,
        "history": [_thread_to_dict(e) for e in evals],
        "total": len(evals),
    }


# ── Helper functions ─────────────────────────────────────────────

def _build_evaluator_descriptors(run: EvalRun) -> list[dict]:
    """Build evaluator descriptors from run metadata for frontend rendering."""
    descriptors = []
    summary = run.summary or {}
    batch_meta = run.batch_metadata or {}

    # Built-in evaluators (only if they were enabled)
    if batch_meta.get("evaluate_intent", True):
        descriptors.append({
            "id": "intent",
            "name": "Intent Accuracy",
            "type": "built-in",
            "primaryField": {
                "key": "intent_accuracy",
                "format": "percentage",
            },
            "aggregation": {
                "average": summary.get("avg_intent_accuracy"),
                "completedCount": summary.get("completed", 0),
                "errorCount": summary.get("errors", 0),
            },
        })

    if batch_meta.get("evaluate_correctness", True):
        descriptors.append({
            "id": "correctness",
            "name": "Correctness",
            "type": "built-in",
            "primaryField": {
                "key": "worst_correctness",
                "format": "verdict",
                "verdictOrder": ["PASS", "NOT APPLICABLE", "SOFT FAIL", "HARD FAIL", "CRITICAL"],
            },
            "aggregation": {
                "distribution": summary.get("correctness_verdicts", {}),
                "completedCount": summary.get("completed", 0),
                "errorCount": summary.get("errors", 0),
            },
        })

    if batch_meta.get("evaluate_efficiency", True):
        descriptors.append({
            "id": "efficiency",
            "name": "Efficiency",
            "type": "built-in",
            "primaryField": {
                "key": "efficiency_verdict",
                "format": "verdict",
                "verdictOrder": ["EFFICIENT", "ACCEPTABLE", "FRICTION", "BROKEN"],
            },
            "aggregation": {
                "distribution": summary.get("efficiency_verdicts", {}),
                "completedCount": summary.get("completed", 0),
                "errorCount": summary.get("errors", 0),
            },
        })

    # Custom evaluators from summary
    custom_evals = summary.get("custom_evaluations", {})
    for cev_id, cev_data in custom_evals.items():
        pf = cev_data.get("primary_field", {})
        pf_format = "text"
        if pf.get("type") == "number":
            pf_format = "number"
        elif cev_data.get("distribution"):
            pf_format = "verdict"

        desc_item = {
            "id": cev_id,
            "name": cev_data.get("name", "Unknown"),
            "type": "custom",
            "outputSchema": cev_data.get("output_schema", []),
            "primaryField": {
                "key": pf.get("key", ""),
                "format": pf_format,
            },
            "aggregation": {
                "completedCount": cev_data.get("completed", 0),
                "errorCount": cev_data.get("errors", 0),
            },
        }

        if cev_data.get("distribution"):
            desc_item["primaryField"]["verdictOrder"] = list(cev_data["distribution"].keys())
            desc_item["aggregation"]["distribution"] = cev_data["distribution"]

        if cev_data.get("average") is not None:
            desc_item["aggregation"]["average"] = cev_data["average"]
            desc_item["primaryField"]["format"] = "percentage" if cev_data["average"] <= 1 else "number"

        descriptors.append(desc_item)

    return descriptors


def _run_to_dict(r: EvalRun, owner_name: str | None = None) -> dict:
    """Serialize an EvalRun to a dict with both camelCase and snake_case keys.

    Frontend EvalRun interface uses camelCase (evaluatorId, errorMessage, etc.)
    Legacy batch pages use snake_case (run_id, data_path, etc.)
    Both are included for backward compatibility.
    """
    batch = r.batch_metadata or {}
    listing_id = str(r.listing_id) if r.listing_id else None
    session_id = str(r.session_id) if r.session_id else None
    evaluator_id = str(r.evaluator_id) if r.evaluator_id else None
    job_id = str(r.job_id) if r.job_id else None
    started_at = r.started_at.isoformat() if r.started_at else None
    completed_at = r.completed_at.isoformat() if r.completed_at else None
    created_at = r.created_at.isoformat() if r.created_at else None
    shared_at = r.shared_at.isoformat() if r.shared_at else None
    latest_review_id = str(r.latest_review_id) if r.latest_review_id else None
    visibility = (Visibility.normalize(r.visibility) or Visibility.PRIVATE).value
    descriptors = _build_evaluator_descriptors(r)

    return {
        "id": str(r.id),
        "status": r.status,
        "config": r.config or {},
        "result": r.result,
        "summary": r.summary,
        # camelCase (used by frontend EvalRun interface)
        "appId": r.app_id,
        "evalType": r.eval_type,
        "listingId": listing_id,
        "sessionId": session_id,
        "evaluatorId": evaluator_id,
        "jobId": job_id,
        "errorMessage": r.error_message,
        "startedAt": started_at,
        "completedAt": completed_at,
        "createdAt": created_at,
        "durationMs": r.duration_ms,
        "llmProvider": r.llm_provider,
        "llmModel": r.llm_model,
        "batchMetadata": batch,
        "visibility": visibility,
        "sharedBy": str(r.shared_by) if r.shared_by else None,
        "sharedAt": shared_at,
        "tenantId": str(r.tenant_id),
        "userId": str(r.user_id),
        "latestReviewId": latest_review_id,
        "ownerName": owner_name,
        # snake_case (legacy compat for batch/adversarial pages)
        "run_id": str(r.id),
        "app_id": r.app_id,
        "eval_type": r.eval_type,
        "listing_id": listing_id,
        "session_id": session_id,
        "evaluator_id": evaluator_id,
        "job_id": job_id,
        "error_message": r.error_message,
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_ms": r.duration_ms,
        "duration_seconds": round(r.duration_ms / 1000, 2) if r.duration_ms else 0,
        "llm_provider": r.llm_provider,
        "llm_model": r.llm_model,
        "batch_metadata": batch,
        "visibility": visibility,
        "shared_by": str(r.shared_by) if r.shared_by else None,
        "shared_at": shared_at,
        "latest_review_id": latest_review_id,
        # Legacy batch fields (from batch_metadata)
        "command": batch.get("command", r.eval_type),
        "name": batch.get("name"),
        "description": batch.get("description"),
        "data_path": batch.get("data_path"),
        "data_file_hash": batch.get("data_file_hash"),
        "eval_temperature": batch.get("eval_temperature", 0),
        "total_items": batch.get("total_items", 0),
        "flags": batch.get("flags", {}),
        "created_at": created_at,
        "timestamp": created_at,
        # Evaluator descriptors (used by frontend for dynamic column rendering)
        "evaluatorDescriptors": descriptors,
        "evaluator_descriptors": descriptors,
        # Unified flow type (Phase 2)
        "flowType": (r.result or {}).get("flowType") or (r.config or {}).get("source_type") or "upload",
    }


def _thread_to_dict(e: ThreadEvaluation) -> dict:
    result = enrich_thread_result_for_api(
        e.result if isinstance(e.result, dict) else {},
        row_intent_accuracy=e.intent_accuracy,
        row_worst_correctness=e.worst_correctness,
        row_efficiency_verdict=e.efficiency_verdict,
        row_success_status=e.success_status,
    )
    canonical_thread = result.get("canonical_thread", {})
    return {
        "id": e.id,
        "run_id": str(e.run_id),
        "thread_id": e.thread_id,
        "data_file_hash": e.data_file_hash,
        "intent_accuracy": e.intent_accuracy,
        "worst_correctness": e.worst_correctness,
        "efficiency_verdict": e.efficiency_verdict,
        "success_status": e.success_status,
        "result": result,
        "canonical_thread": canonical_thread,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _adv_to_dict(e: AdversarialEvaluation) -> dict:
    result = enrich_adversarial_result_for_api(
        e.result if isinstance(e.result, dict) else {},
        row_verdict=e.verdict,
        row_goal_achieved=e.goal_achieved,
        row_goal_flow=e.goal_flow or [],
        row_active_traits=e.active_traits or [],
        row_total_turns=e.total_turns,
    )
    canonical_case = result.get("canonical_case", {})
    return {
        "id": e.id,
        "run_id": str(e.run_id),
        "goal_flow": e.goal_flow or [],
        "active_traits": e.active_traits or [],
        "difficulty": e.difficulty,
        "verdict": canonical_case.get("judge", {}).get("verdict"),
        "goal_achieved": canonical_case.get("judge", {}).get("goalAchieved", False),
        "total_turns": e.total_turns,
        "result": result,
        "canonical_case": canonical_case,
        "has_contradiction": canonical_case.get("derived", {}).get("hasContradiction", False),
        "contradiction_types": canonical_case.get("derived", {}).get("contradictionTypes", []),
        "is_infra_failure": canonical_case.get("derived", {}).get("isInfraFailure", False),
        "is_retryable": canonical_case.get("derived", {}).get("isRetryable", False),
        "error": result.get("error") if isinstance(result, dict) else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _log_to_dict_full(log: ApiLog) -> dict:
    return {
        "id": log.id,
        "run_id": str(log.run_id) if log.run_id else None,
        "thread_id": log.thread_id,
        "test_case_label": log.test_case_label,
        "provider": log.provider,
        "model": log.model,
        "method": log.method,
        "prompt": log.prompt,
        "system_prompt": log.system_prompt,
        "response": log.response,
        "error": log.error,
        "duration_ms": log.duration_ms,
        "tokens_in": log.tokens_in,
        "tokens_out": log.tokens_out,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }
