"""Eval runs API - query evaluation run results."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation, ApiLog

router = APIRouter(prefix="/api/eval-runs", tags=["eval-runs"])


@router.get("")
async def list_eval_runs(
    command: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = select(EvalRun).order_by(desc(EvalRun.created_at)).limit(limit).offset(offset)
    if command:
        query = query.where(EvalRun.command == command)
    result = await db.execute(query)
    return [_run_to_dict(r) for r in result.scalars().all()]


@router.get("/stats/summary")
async def get_summary_stats(db: AsyncSession = Depends(get_db)):
    """Global stats across all evaluation runs."""
    total_runs = (await db.execute(select(func.count(EvalRun.id)))).scalar() or 0
    total_threads = (await db.execute(
        select(func.count(func.distinct(ThreadEvaluation.thread_id)))
    )).scalar() or 0
    total_adversarial = (await db.execute(
        select(func.count(AdversarialEvaluation.id))
    )).scalar() or 0

    return {
        "total_runs": total_runs,
        "total_threads_evaluated": total_threads,
        "total_adversarial_tests": total_adversarial,
    }


@router.get("/{run_id}")
async def get_eval_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return _run_to_dict(run)


@router.get("/{run_id}/threads")
async def get_run_threads(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ThreadEvaluation).where(ThreadEvaluation.run_id == run_id)
    )
    evals = result.scalars().all()
    return {"run_id": run_id, "evaluations": [_thread_to_dict(e) for e in evals], "total": len(evals)}


@router.get("/{run_id}/adversarial")
async def get_run_adversarial(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AdversarialEvaluation).where(AdversarialEvaluation.run_id == run_id)
    )
    evals = result.scalars().all()
    return {"run_id": run_id, "evaluations": [_adv_to_dict(e) for e in evals], "total": len(evals)}


@router.get("/{run_id}/logs")
async def get_run_logs(
    run_id: str,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ApiLog).where(ApiLog.run_id == run_id)
        .order_by(desc(ApiLog.id)).limit(limit).offset(offset)
    )
    return {"run_id": run_id, "logs": [_log_to_dict(log) for log in result.scalars().all()]}


# ── Helper functions ─────────────────────────────────────────────

def _run_to_dict(r: EvalRun) -> dict:
    return {
        "id": r.id, "command": r.command, "status": r.status,
        "llm_provider": r.llm_provider, "llm_model": r.llm_model,
        "duration_seconds": r.duration_seconds, "total_items": r.total_items,
        "summary": r.summary, "error_message": r.error_message,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _thread_to_dict(e: ThreadEvaluation) -> dict:
    return {
        "id": e.id, "run_id": e.run_id, "thread_id": e.thread_id,
        "intent_accuracy": e.intent_accuracy, "worst_correctness": e.worst_correctness,
        "efficiency_verdict": e.efficiency_verdict, "success_status": e.success_status,
        "result": e.result,
    }


def _adv_to_dict(e: AdversarialEvaluation) -> dict:
    return {
        "id": e.id, "run_id": e.run_id, "category": e.category,
        "difficulty": e.difficulty, "verdict": e.verdict,
        "goal_achieved": e.goal_achieved, "total_turns": e.total_turns,
        "result": e.result,
    }


def _log_to_dict(log: ApiLog) -> dict:
    return {
        "id": log.id, "run_id": log.run_id, "provider": log.provider,
        "model": log.model, "method": log.method, "duration_ms": log.duration_ms,
        "tokens_in": log.tokens_in, "tokens_out": log.tokens_out,
    }
