# Phase 3: Kaira-Evals Merge + Job Execution System

**Branch:** `feat/phase-3-kaira-merge`
**Goal:** Port kaira-evals evaluation logic into the backend. Add job queue for batch evaluations triggered from UI.
**Outcome:** User can submit "evaluate batch" from the UI, backend processes it, UI shows progress.

**Prerequisite:** Phase 2 complete and merged. App works E2E through HTTP API.

**Reference code:** `~/Programs/python/ai-tatva-evals/kaira-evals/src/`

---

## Step 3.1: Create branch

```bash
git checkout main
git checkout -b feat/phase-3-kaira-merge
```

---

## Step 3.2: Jobs API routes

**Files to create:** `backend/app/routes/jobs.py`
**Files to edit:** `backend/app/main.py` (register router)

### Instructions

The jobs table already exists from Phase 1 models. Now create the API routes.

```python
"""Jobs API - submit, list, check status, cancel background jobs."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from app.database import get_db
from app.models.job import Job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", status_code=201)
async def submit_job(
    body: dict,  # {job_type: str, params: dict}
    db: AsyncSession = Depends(get_db),
):
    """Submit a new background job."""
    job = Job(
        job_type=body["job_type"],
        params=body.get("params", {}),
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.get("")
async def list_jobs(
    status: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List jobs, optionally filtered by status."""
    query = select(Job).order_by(desc(Job.created_at)).limit(limit).offset(offset)
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    jobs = result.scalars().all()
    return [_to_dict(j) for j in jobs]


@router.get("/{job_id}")
async def get_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get job status and progress."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return _to_dict(job)


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running job."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "failed", "cancelled"):
        raise HTTPException(400, f"Cannot cancel job in '{job.status}' state")
    job.status = "cancelled"
    job.completed_at = datetime.utcnow()
    await db.commit()
    return {"id": str(job_id), "status": "cancelled"}


def _to_dict(job: Job) -> dict:
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "params": job.params,
        "result": job.result,
        "progress": job.progress,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
```

Register in `main.py`:
```python
from app.routes.jobs import router as jobs_router
app.include_router(jobs_router)
```

### Test
```bash
# Submit a job
curl -X POST http://localhost:8721/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"job_type": "evaluate-batch", "params": {"app_id": "kaira-bot", "data_path": "test.csv"}}'

# List jobs
curl http://localhost:8721/api/jobs

# Get job by ID
curl http://localhost:8721/api/jobs/{returned-id}
```

### Commit
```bash
git add backend/app/routes/jobs.py backend/app/main.py
git commit -m "phase 3.2: jobs API routes (submit, list, status, cancel)"
```

---

## Step 3.3: Background job worker

**Files to create:** `backend/app/services/job_worker.py`
**Files to edit:** `backend/app/main.py` (start worker on startup)

### Instructions

This is a simple polling worker that runs as an asyncio background task inside the FastAPI process. It checks for queued jobs every 5 seconds and processes them.

```python
"""Background job worker.

Polls the jobs table for 'queued' jobs and processes them.
Runs as an asyncio task within the FastAPI process.

For production scale: extract to a separate worker process or use Celery.
For your current scale (company-internal): this is sufficient.
"""
import asyncio
import logging
import traceback
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.job import Job

logger = logging.getLogger(__name__)

# Job handler registry - add new job types here
JOB_HANDLERS = {}


def register_job_handler(job_type: str):
    """Decorator to register a job handler function."""
    def decorator(func):
        JOB_HANDLERS[job_type] = func
        return func
    return decorator


async def process_job(job_id, job_type: str, params: dict) -> dict:
    """Dispatch job to the appropriate handler."""
    handler = JOB_HANDLERS.get(job_type)
    if not handler:
        raise ValueError(f"Unknown job type: {job_type}")
    return await handler(job_id, params)


async def update_job_progress(job_id, current: int, total: int, message: str = ""):
    """Update job progress (called from within handlers)."""
    async with async_session() as db:
        await db.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(progress={"current": current, "total": total, "message": message})
        )
        await db.commit()


async def worker_loop():
    """Main worker loop. Polls for queued jobs every 5 seconds."""
    logger.info("Job worker started")
    while True:
        try:
            async with async_session() as db:
                # Pick the oldest queued job
                result = await db.execute(
                    select(Job)
                    .where(Job.status == "queued")
                    .order_by(Job.created_at)
                    .limit(1)
                )
                job = result.scalar_one_or_none()

                if job:
                    logger.info(f"Processing job {job.id} (type={job.job_type})")

                    # Mark as running
                    job.status = "running"
                    job.started_at = datetime.utcnow()
                    await db.commit()

                    try:
                        result_data = await process_job(job.id, job.job_type, job.params)

                        # Mark as completed
                        job.status = "completed"
                        job.result = result_data or {}
                        job.completed_at = datetime.utcnow()
                        job.progress = {"current": 1, "total": 1, "message": "Done"}
                        await db.commit()
                        logger.info(f"Job {job.id} completed")

                    except Exception as e:
                        logger.error(f"Job {job.id} failed: {e}")
                        logger.error(traceback.format_exc())

                        # Re-fetch job in case session was invalidated
                        async with async_session() as db2:
                            j = await db2.get(Job, job.id)
                            if j:
                                j.status = "failed"
                                j.error_message = str(e)
                                j.completed_at = datetime.utcnow()
                                await db2.commit()

        except Exception as e:
            logger.error(f"Worker loop error: {e}")

        await asyncio.sleep(5)


# ── Example job handler (placeholder) ──────────────────────

@register_job_handler("evaluate-batch")
async def handle_evaluate_batch(job_id, params: dict) -> dict:
    """
    Placeholder for batch evaluation job.

    In Phase 3.4+, this will:
    1. Load data from params['data_path']
    2. For each thread, run the evaluation pipeline
    3. Save results to thread_evaluations table
    4. Update progress along the way

    For now, it simulates work.
    """
    total = params.get("total_items", 5)
    for i in range(total):
        await update_job_progress(job_id, i + 1, total, f"Processing item {i + 1}/{total}")
        await asyncio.sleep(1)  # Simulate work

    return {"total_processed": total, "summary": "Placeholder evaluation complete"}
```

Update `backend/app/main.py` to start the worker:

```python
# Add to the lifespan function:
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background job worker
    from app.services.job_worker import worker_loop
    worker_task = asyncio.create_task(worker_loop())

    yield

    # Cleanup
    worker_task.cancel()
    await engine.dispose()

# Add import at top:
import asyncio
```

### Test
```bash
# Submit a job
curl -X POST http://localhost:8721/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"job_type": "evaluate-batch", "params": {"total_items": 3}}'

# Poll for progress (every 2 seconds)
watch -n 2 'curl -s http://localhost:8721/api/jobs/{job-id} | python -m json.tool'

# Should see: queued → running (with progress updates) → completed
```

### Commit
```bash
git add backend/app/services/job_worker.py backend/app/main.py
git commit -m "phase 3.3: background job worker with polling loop"
```

---

## Step 3.4: Port kaira-evals evaluation logic

**Files to create:** `backend/app/services/evaluators/` directory

### Instructions

This step ports the core evaluation code from `kaira-evals/src/evaluators/` into the backend.

> IMPORTANT: Do NOT copy-paste kaira-evals code blindly. The kaira-evals code uses sync Python + direct API calls. The backend uses async Python + SQLAlchemy async sessions. You need to adapt.

1. Create directory:
```bash
mkdir -p backend/app/services/evaluators
touch backend/app/services/evaluators/__init__.py
```

2. Port these files from `kaira-evals/src/evaluators/`:
   - `intent_evaluator.py` → `backend/app/services/evaluators/intent_evaluator.py`
   - `correctness_evaluator.py` → `backend/app/services/evaluators/correctness_evaluator.py`
   - `efficiency_evaluator.py` → `backend/app/services/evaluators/efficiency_evaluator.py`
   - `adversarial_evaluator.py` → `backend/app/services/evaluators/adversarial_evaluator.py`
   - `conversation_agent.py` → `backend/app/services/evaluators/conversation_agent.py`

3. Port data models from `kaira-evals/src/data/models.py`:
   - Copy the dataclass definitions (ChatMessage, ConversationThread, ThreadEvaluation, etc.)
   - Place in `backend/app/services/evaluators/models.py`

4. Port data loader from `kaira-evals/src/data/loader.py`:
   - Adapt to read from DB or uploaded files instead of local CSV path
   - Place in `backend/app/services/evaluators/data_loader.py`

5. Port LLM providers from `kaira-evals/src/llm/`:
   - `base.py` → `backend/app/services/evaluators/llm_base.py`
   - `gemini_provider.py` → adapt for backend config
   - `openai_provider.py` → adapt for Azure OpenAI config

6. Update the `evaluate-batch` job handler in `job_worker.py`:

```python
@register_job_handler("evaluate-batch")
async def handle_evaluate_batch(job_id, params: dict) -> dict:
    """Run batch evaluation on threads from a data file."""
    from app.services.evaluators.batch_runner import run_batch_evaluation

    result = await run_batch_evaluation(
        job_id=job_id,
        data_path=params.get("data_path"),
        app_id=params.get("app_id", "kaira-bot"),
        llm_provider=params.get("llm_provider", "gemini"),
        llm_model=params.get("llm_model"),
        progress_callback=update_job_progress,
    )
    return result
```

> NOTE: This is the most complex step. Take it slow. The evaluation logic is self-contained - it takes input data, runs LLM calls, and produces results. The main adaptation is making it async-compatible and storing results in PostgreSQL instead of SQLite.

### Commit
```bash
git add backend/app/services/evaluators/
git commit -m "phase 3.4: port kaira-evals evaluation logic to backend"
```

---

## Step 3.5: Eval runs API routes

**Files to create:** `backend/app/routes/eval_runs.py`

### Instructions

These routes expose the kaira-evals data (runs, thread evaluations, adversarial tests, API logs) through the API. They mirror the kaira-evals FastAPI server (`kaira-evals/src/api/server.py`).

```python
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
    limit: int = Query(50),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    query = select(EvalRun).order_by(desc(EvalRun.created_at)).limit(limit).offset(offset)
    if command:
        query = query.where(EvalRun.command == command)
    result = await db.execute(query)
    return [_run_to_dict(r) for r in result.scalars().all()]


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
    limit: int = Query(200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ApiLog).where(ApiLog.run_id == run_id).order_by(desc(ApiLog.id)).limit(limit).offset(offset)
    )
    return {"run_id": run_id, "logs": [_log_to_dict(l) for l in result.scalars().all()]}


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


# Helper functions to convert models to dicts
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

def _log_to_dict(l: ApiLog) -> dict:
    return {
        "id": l.id, "run_id": l.run_id, "provider": l.provider,
        "model": l.model, "method": l.method, "duration_ms": l.duration_ms,
        "tokens_in": l.tokens_in, "tokens_out": l.tokens_out,
    }
```

Register in `main.py`:
```python
from app.routes.eval_runs import router as eval_runs_router
app.include_router(eval_runs_router)
```

### Commit
```bash
git add backend/app/routes/eval_runs.py backend/app/main.py
git commit -m "phase 3.5: eval runs API routes (runs, threads, adversarial, logs, stats)"
```

---

## Step 3.6: Frontend - Jobs API client + Job submission UI

**Files to create:**
- `src/services/api/jobsApi.ts` - HTTP client for jobs
- UI component for job submission (location depends on your feature structure)

### Instructions

```typescript
// src/services/api/jobsApi.ts
import { apiRequest } from './client';

export interface Job {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: { current: number; total: number; message: string };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const jobsApi = {
  async submit(jobType: string, params: Record<string, unknown>): Promise<Job> {
    return apiRequest<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ job_type: jobType, params }),
    });
  },

  async list(status?: string): Promise<Job[]> {
    const query = status ? `?status=${status}` : '';
    return apiRequest<Job[]>(`/api/jobs${query}`);
  },

  async get(jobId: string): Promise<Job> {
    return apiRequest<Job>(`/api/jobs/${jobId}`);
  },

  async cancel(jobId: string): Promise<void> {
    await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  },

  /**
   * Poll a job until it completes. Calls onProgress with each update.
   */
  async pollUntilDone(
    jobId: string,
    onProgress?: (job: Job) => void,
    intervalMs: number = 2000,
  ): Promise<Job> {
    while (true) {
      const job = await this.get(jobId);
      onProgress?.(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        return job;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },
};
```

> UI component design is flexible. The key pattern: submit job → start polling → show progress bar → show results on completion. This can be added to the existing evaluation feature module.

### Commit
```bash
git add src/services/api/jobsApi.ts
git commit -m "phase 3.6: jobs API client + polling utility"
```

---

## Phase 3 Final Test

1. Submit a batch evaluation job from the frontend (or curl)
2. Watch job progress update from queued → running → completed
3. Query eval run results through the API
4. Verify results are stored in PostgreSQL:
```bash
psql postgresql://evals_user:evals_pass@localhost:5432/ai_evals_platform \
  -c "SELECT id, status, job_type FROM jobs ORDER BY created_at DESC LIMIT 5"
```

### Phase 3 Final Commit
```bash
git add .
git commit -m "phase 3: kaira-evals merge with job execution system"
```

### Merge
```bash
git checkout main
git merge feat/phase-3-kaira-merge
```
