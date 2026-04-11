# Analytics Platform Plan — Denormalize, Harden, Observe

> Replaces `analytics-scale-plan.md`. Full implementation spec with DDLs, code paths, and file locations.
> All names are generic. All app context derived from `app_id` on the source row. Zero hardcoding.

---

## Table of Contents

1. [Fact Tables — DDLs and Models](#1-fact-tables)
2. [Population Pipeline — Worker Job](#2-population-pipeline)
3. [Analytics Job Logging](#3-analytics-job-logging)
4. [Agent Tool Logging](#4-agent-tool-logging)
5. [Query Cache](#5-query-cache)
6. [SQL Agent Hardening](#6-sql-agent-hardening)
7. [Updated Semantic Model](#7-updated-semantic-model)
8. [Analytics Connection Pool](#8-analytics-connection-pool)
9. [Backfill Script](#9-backfill-script)
10. [Worker Priority Tuning](#10-worker-priority)
11. [Execution Order](#11-execution-order)

---

## 1. Fact Tables

Three denormalized tables. One row per grain. No JSONB unpacking at query time.

### 1.1 `analytics_run_facts`

**Grain:** One row per eval run.
**Populated from:** `eval_runs` + aggregated `thread_evaluations` / `adversarial_evaluations`.

```sql
CREATE TABLE analytics_run_facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    app_id          TEXT NOT NULL,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    eval_type       TEXT NOT NULL,     -- batch_thread, call_quality, batch_adversarial, etc.
    status          TEXT NOT NULL,     -- completed, failed, etc.
    
    -- Timing
    created_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    duration_ms     FLOAT,
    
    -- Counts
    thread_count    INT DEFAULT 0,
    pass_count      INT DEFAULT 0,
    fail_count      INT DEFAULT 0,
    error_count     INT DEFAULT 0,
    
    -- Rates (pre-computed, avoids re-calculation)
    pass_rate       FLOAT,            -- 0.0-100.0
    avg_intent_accuracy FLOAT,        -- 0.0-1.0
    
    -- Adversarial-specific (null for non-adversarial)
    adversarial_total       INT,
    adversarial_blocked     INT,
    adversarial_block_rate  FLOAT,
    
    -- App-specific dimensions (flat key-value, GIN indexed)
    -- Examples: {"run_name": "...", "evaluator_names": [...], "model": "..."}
    context         JSONB NOT NULL DEFAULT '{}',
    
    -- Dedup
    UNIQUE (run_id)
);

CREATE INDEX idx_arf_tenant_app ON analytics_run_facts(tenant_id, app_id, created_at DESC);
CREATE INDEX idx_arf_app_type ON analytics_run_facts(app_id, eval_type, created_at DESC);
CREATE INDEX idx_arf_context ON analytics_run_facts USING GIN (context);
```

**ORM Model:** `backend/app/models/analytics_facts.py`

```python
class AnalyticsRunFact(Base):
    __tablename__ = "analytics_run_facts"
    
    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = mapped_column(UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"), unique=True, nullable=False)
    app_id = mapped_column(String(50), nullable=False)
    tenant_id = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    user_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    eval_type = mapped_column(String(30), nullable=False)
    status = mapped_column(String(30), nullable=False)
    created_at = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms = mapped_column(Float, nullable=True)
    thread_count = mapped_column(Integer, default=0)
    pass_count = mapped_column(Integer, default=0)
    fail_count = mapped_column(Integer, default=0)
    error_count = mapped_column(Integer, default=0)
    pass_rate = mapped_column(Float, nullable=True)
    avg_intent_accuracy = mapped_column(Float, nullable=True)
    adversarial_total = mapped_column(Integer, nullable=True)
    adversarial_blocked = mapped_column(Integer, nullable=True)
    adversarial_block_rate = mapped_column(Float, nullable=True)
    context = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
```

### 1.2 `analytics_eval_facts`

**Grain:** One row per evaluator per thread (or per adversarial case).
**Purpose:** Unifies all evaluator outputs — built-in verdicts, custom scores, rubric scores, adversarial results.
**Key design:** `evaluator_type` + `evaluator_name` are generic. Not tied to any app's evaluator names.

```sql
CREATE TABLE analytics_eval_facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    app_id          TEXT NOT NULL,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    eval_type       TEXT NOT NULL,
    
    -- What was evaluated
    item_id         TEXT NOT NULL,     -- thread_id for threads, adversarial eval ID for adv
    item_type       TEXT NOT NULL,     -- 'thread', 'adversarial_case', 'recording', 'listing'
    
    -- Who evaluated
    evaluator_type  TEXT NOT NULL,     -- 'intent', 'correctness', 'efficiency', 'custom', 'adversarial_judge', 'call_rubric'
    evaluator_name  TEXT NOT NULL,     -- human-readable: "Intent Accuracy", "Correctness", evaluator.name, etc.
    evaluator_id    UUID,             -- FK to evaluators table for custom; null for built-in
    
    -- Result (generic across all evaluator types)
    result_status   TEXT,             -- PASS/FAIL/VIOLATED/FOLLOWED/EFFICIENT/etc. Null if score-only.
    result_score    FLOAT,            -- 0.0-1.0 or 0-100 depending on evaluator. Null if status-only.
    result_verdict  TEXT,             -- Freeform verdict text if applicable
    success         BOOLEAN,          -- Derived: did this evaluation pass?
    
    -- Full output for custom evaluators (arbitrary schema)
    result_detail   JSONB DEFAULT '{}',
    
    -- App-specific context (call metadata, thread metadata, etc.)
    context         JSONB NOT NULL DEFAULT '{}',
    
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_aef_run ON analytics_eval_facts(run_id);
CREATE INDEX idx_aef_tenant_app ON analytics_eval_facts(tenant_id, app_id, created_at DESC);
CREATE INDEX idx_aef_item ON analytics_eval_facts(item_id, evaluator_type);
CREATE INDEX idx_aef_evaluator ON analytics_eval_facts(evaluator_type, evaluator_name, result_status);
CREATE INDEX idx_aef_context ON analytics_eval_facts USING GIN (context);
```

**How different eval types map to rows:**

| eval_type | evaluator_type | evaluator_name | result_status | result_score |
|-----------|---------------|----------------|---------------|-------------|
| batch_thread | `intent` | "Intent Accuracy" | null | 0.85 (intent_accuracy) |
| batch_thread | `correctness` | "Correctness" | "PASS" / "HARD FAIL" | null |
| batch_thread | `efficiency` | "Efficiency" | "FRICTION" / "EFFICIENT" | null |
| batch_thread | `custom` | evaluator.name | from output schema | from output schema |
| call_quality | `call_rubric` | evaluator.name | null | dimension_score |
| batch_adversarial | `adversarial_judge` | "Adversarial Judge" | "PASS" / "FAIL" | null |
| full_evaluation | `critique` | "Voice Rx Critique" | null | overall_quality/100 |

### 1.3 `analytics_criterion_facts`

**Grain:** One row per criterion (rule/check) per thread.
**Purpose:** Answers "which rules fail most?" without JSONB unpacking.
**Key design:** `criterion_id` + `criterion_source` are generic. Works for rule_catalog rules, adversarial rules, and future app-specific criteria.

```sql
CREATE TABLE analytics_criterion_facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    app_id          TEXT NOT NULL,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- What was evaluated
    item_id         TEXT NOT NULL,     -- thread_id or adversarial eval ID
    
    -- Which criterion
    criterion_source TEXT NOT NULL,    -- 'rule_catalog', 'adversarial_rule', 'custom_criterion'
    criterion_id    TEXT NOT NULL,     -- rule_id from rule_catalog, or custom criterion key
    criterion_label TEXT,             -- human-readable label (rule section, criterion name)
    
    -- Evaluation scope (which evaluator produced this)
    evaluator_type  TEXT NOT NULL,     -- 'correctness', 'efficiency', 'intent', 'adversarial_judge'
    
    -- Result
    status          TEXT NOT NULL,     -- FOLLOWED, VIOLATED, NOT_APPLICABLE, NOT_EVALUATED
    passed          BOOLEAN,          -- true=FOLLOWED, false=VIOLATED, null=N/A
    evidence        TEXT,             -- truncated to 500 chars
    
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_acf_run ON analytics_criterion_facts(run_id);
CREATE INDEX idx_acf_tenant_app ON analytics_criterion_facts(tenant_id, app_id);
CREATE INDEX idx_acf_criterion ON analytics_criterion_facts(criterion_id, status);
CREATE INDEX idx_acf_tenant_app_criterion ON analytics_criterion_facts(tenant_id, app_id, criterion_id, status);
CREATE INDEX idx_acf_item ON analytics_criterion_facts(item_id);
```

**How different eval types map to rows:**

| Source | criterion_source | criterion_id | evaluator_type | status |
|--------|-----------------|-------------|----------------|--------|
| batch_thread correctness rules | `rule_catalog` | "exact_calorie_values" | `correctness` | FOLLOWED/VIOLATED |
| batch_thread efficiency rules | `rule_catalog` | "ask_time_if_missing" | `efficiency` | FOLLOWED/VIOLATED |
| batch_thread intent rules | `rule_catalog` | "detect_meal_intent" | `intent` | FOLLOWED/VIOLATED |
| adversarial judge rules | `adversarial_rule` | "no_hallucination" | `adversarial_judge` | FOLLOWED/VIOLATED |
| Future: custom criteria | `custom_criterion` | user-defined key | `custom` | FOLLOWED/VIOLATED |

---

## 2. Population Pipeline

### 2.1 Service: `backend/app/services/analytics/fact_populator.py`

A stateless service class. Takes an eval run + its child evaluations. Produces fact table rows. No hardcoded app logic — uses the eval_type and result structure to determine extraction.

```python
class FactPopulator:
    """
    Extracts analytics facts from a completed eval run.
    
    Each eval_type has an extractor method registered in EXTRACTORS.
    New eval types register here — no changes to the caller.
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def populate(self, run_id: UUID) -> PopulationResult:
        """
        Main entry point. Loads the run, dispatches to the right extractor,
        bulk-inserts fact rows, returns metadata for the analytics job log.
        """
        # 1. Load run + children
        # 2. Delete existing facts for this run (idempotent re-run)
        # 3. Dispatch to extractor by eval_type
        # 4. Bulk insert run_fact + eval_facts + criterion_facts
        # 5. Return PopulationResult(rows_inserted, duration_ms, errors)
    
    async def _extract_batch_thread(self, run, threads) -> FactSet:
        """Extract facts from batch_thread runs (kaira-bot pattern)."""
        # Iterates threads, extracts:
        #   - One eval_fact per built-in evaluator (intent, correctness, efficiency)
        #   - One eval_fact per custom evaluator
        #   - One criterion_fact per rule outcome
        
    async def _extract_call_quality(self, run, threads) -> FactSet:
        """Extract facts from call_quality runs (inside-sales pattern)."""
        # Iterates threads, extracts:
        #   - One eval_fact per evaluator output
        #   - context: {"agent": ..., "direction": ..., "duration": ...}
    
    async def _extract_adversarial(self, run, cases) -> FactSet:
        """Extract facts from batch_adversarial runs."""
        # Iterates adversarial cases, extracts:
        #   - One eval_fact per case (adversarial_judge)
        #   - criterion_facts from judge.ruleOutcomes
    
    async def _extract_full_evaluation(self, run) -> FactSet:
        """Extract facts from full_evaluation runs (voice-rx pattern)."""
        # Single eval_fact from EvalRun.result
        # No criterion_facts (no rules)
    
    async def _extract_custom(self, run) -> FactSet:
        """Extract facts from custom evaluator runs."""
        # Single eval_fact from EvalRun.result
        # result_detail = the custom output JSONB

# Extractor registry — add new eval types here
EXTRACTORS = {
    "batch_thread": FactPopulator._extract_batch_thread,
    "call_quality": FactPopulator._extract_call_quality,
    "batch_adversarial": FactPopulator._extract_adversarial,
    "full_evaluation": FactPopulator._extract_full_evaluation,
    "custom": FactPopulator._extract_custom,
}
```

**File structure:**

```
backend/app/services/analytics/
    __init__.py
    fact_populator.py     — extraction logic per eval_type
    extractors/
        __init__.py
        batch_thread.py   — _extract_batch_thread
        call_quality.py   — _extract_call_quality
        adversarial.py    — _extract_adversarial
        full_eval.py      — _extract_full_evaluation
        custom_eval.py    — _extract_custom
    types.py              — FactSet, PopulationResult, RunFactRow, EvalFactRow, CriterionFactRow
```

Each extractor is a separate file. Adding a new eval_type = add one file + register in `EXTRACTORS`. No modification to existing extractors.

### 2.2 Job Type: `populate-analytics`

Registered in `backend/app/services/job_worker.py` alongside existing job types.

```python
# In get_job_submission_metadata():
"populate-analytics": {
    "app_id": params.get("app_id", ""),
    "priority": 500,            # Lower priority than evals (100) and reports (200)
    "queue_class": "analytics",
    "max_attempts": 3,          # Retry on transient DB errors
}
```

```python
# In the job runner dispatch:
"populate-analytics": run_populate_analytics,
```

```python
async def run_populate_analytics(job_id, params, db):
    """Worker entry point for analytics population."""
    run_id = UUID(params["run_id"])
    populator = FactPopulator(db)
    result = await populator.populate(run_id)
    return result.to_dict()
```

### 2.3 Trigger: Fire After Run Completion

In each runner's completion path, after the run is marked `completed`, submit the analytics job.

**Touch points (add one call at each):**

| Runner | File | After line |
|--------|------|------------|
| batch_runner | `batch_runner.py:769` | After `await db.commit()` (run status update) |
| inside_sales_runner | `inside_sales_runner.py:535` | After `finalize_eval_run()` |
| adversarial_runner | `adversarial_runner.py` | After run finalization |
| voice_rx_runner | `voice_rx_runner.py` | After run finalization |
| custom_evaluator_runner | `custom_evaluator_runner.py` | After run finalization |

**The call (same everywhere):**

```python
from app.services.analytics import submit_analytics_job

await submit_analytics_job(
    db=db,
    run_id=run_id,
    app_id=app_id,
    tenant_id=tenant_id,
    user_id=user_id,
)
```

```python
# backend/app/services/analytics/__init__.py
async def submit_analytics_job(*, db, run_id, app_id, tenant_id, user_id):
    """Submit a populate-analytics job for a completed run."""
    from app.models.job import Job
    job = Job(
        job_type="populate-analytics",
        app_id=app_id,
        tenant_id=tenant_id,
        user_id=user_id,
        priority=500,
        queue_class="analytics",
        max_attempts=3,
        params={"run_id": str(run_id), "app_id": app_id},
    )
    db.add(job)
    await db.flush()
```

---

## 3. Analytics Job Logging

**Table: `analytics_jobs`**

Tracks every analytics population run — timing, errors, row counts.

```sql
CREATE TABLE analytics_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID REFERENCES eval_runs(id) ON DELETE SET NULL,
    app_id          TEXT NOT NULL,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    job_type        TEXT NOT NULL,     -- 'populate_facts', 'cache_evict', etc.
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     FLOAT,
    rows_inserted   INT DEFAULT 0,
    rows_updated    INT DEFAULT 0,
    rows_deleted    INT DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB DEFAULT '{}',  -- details: which facts affected, retry count, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aj_tenant ON analytics_jobs(tenant_id, created_at DESC);
CREATE INDEX idx_aj_run ON analytics_jobs(run_id);
CREATE INDEX idx_aj_status ON analytics_jobs(status);
```

**Model:** `backend/app/models/analytics_jobs.py`

The `FactPopulator.populate()` method creates and updates an `analytics_jobs` row as it executes.

---

## 4. Agent Tool Logging

**Table: `agent_tool_logs`**

Tracks every tool call from the chat assistant — not just `analyze`, all tools.

```sql
CREATE TABLE agent_tool_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT,             -- chat session ID (report-builder session)
    db_session_id   UUID,             -- ChatSession.id if persisted
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id          TEXT NOT NULL,
    
    -- Tool execution
    tool_name       TEXT NOT NULL,
    arguments       JSONB DEFAULT '{}',
    
    -- For analyze tool: SQL details
    generated_sql   TEXT,
    validated_sql   TEXT,
    
    -- Execution metrics
    execution_ms    FLOAT,
    row_count       INT,
    status          TEXT NOT NULL,     -- 'ok', 'validation_error', 'execution_error', 'cache_hit'
    error_message   TEXT,
    
    -- LLM metrics (for analyze tool's inner LLM call)
    llm_model       TEXT,
    llm_tokens_in   INT,
    llm_tokens_out  INT,
    
    -- Cache
    cache_hit       BOOLEAN DEFAULT FALSE,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_atl_tenant ON agent_tool_logs(tenant_id, created_at DESC);
CREATE INDEX idx_atl_tool ON agent_tool_logs(tool_name, status);
CREATE INDEX idx_atl_session ON agent_tool_logs(db_session_id);
```

**Integration point:** `dispatch_tool_call` in `tool_handlers.py`. Wrap the handler call with timing + logging:

```python
async def dispatch_tool_call(tool_name, arguments, *, db, auth, app_id):
    start = time.monotonic()
    handler = TOOL_HANDLER_MAP.get(tool_name)
    if not handler:
        await _log_tool_call(db, tool_name, arguments, auth, app_id, status="unknown_tool", ...)
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    
    context = dict(db=db, auth=auth, app_id=app_id)
    safe_args = {k: v for k, v in arguments.items() if k not in context}
    
    try:
        result = await handler(**safe_args, **context)
        elapsed = (time.monotonic() - start) * 1000
        await _log_tool_call(db, tool_name, arguments, auth, app_id,
                             status="ok", execution_ms=elapsed, result=result)
        return json.dumps(result, default=str)
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        await _log_tool_call(db, tool_name, arguments, auth, app_id,
                             status="error", execution_ms=elapsed, error=str(e))
        return json.dumps({"error": str(e)})
```

`_log_tool_call` inserts into `agent_tool_logs`. Fire-and-forget (don't fail the tool call if logging fails).

---

## 5. Query Cache

**Table: `analytics_query_cache`**

Per-tenant, TTL-based. The SQL agent checks this before executing.

```sql
CREATE TABLE analytics_query_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sql_hash        TEXT NOT NULL,     -- SHA256 of the validated SQL
    tenant_id       UUID NOT NULL,
    app_id          TEXT NOT NULL,
    result_json     JSONB NOT NULL,    -- cached query result
    row_count       INT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    
    UNIQUE (sql_hash, tenant_id, app_id)
);

CREATE INDEX idx_aqc_lookup ON analytics_query_cache(sql_hash, tenant_id, app_id, expires_at);
```

**Integration in `sql_agent.py`:**

```python
async def analyze(question, *, db, auth, app_id):
    # ... generate SQL ...
    # ... validate SQL ...
    
    # Check cache
    sql_hash = hashlib.sha256(safe_sql.encode()).hexdigest()
    cached = await _get_cache(db, sql_hash, auth.tenant_id, app_id)
    if cached:
        return {"status": "ok", "question": question, "row_count": cached["row_count"],
                "data": cached["data"], "cache_hit": True}
    
    # Execute
    rows = await execute_query(safe_sql, params, db)
    
    # Store in cache (fire-and-forget, 120s TTL)
    await _set_cache(db, sql_hash, auth.tenant_id, app_id, rows, ttl_seconds=120)
    
    return {"status": "ok", ...}
```

**Cache eviction:** A periodic cleanup (can be another low-priority job, or just `DELETE WHERE expires_at < now()` on each cache check).

---

## 6. SQL Agent Hardening

### 6.1 EXPLAIN Cost Check

Before executing, run EXPLAIN to estimate cost.

```python
# In sql_agent.py, before execute_query:
async def _check_query_cost(sql, params, db, max_cost=50000):
    explain_sql = f"EXPLAIN (FORMAT JSON) {sql}"
    result = await db.execute(text(explain_sql), params)
    plan = result.scalar()
    total_cost = plan[0]["Plan"]["Total Cost"]
    if total_cost > max_cost:
        raise SQLValidationError(f"Query too expensive (cost={total_cost}). Try a narrower question.")
```

### 6.2 Retry on SQL Error

If the generated SQL fails, send the error back to the inner LLM for one retry.

```python
# In sql_agent.py analyze():
try:
    rows = await execute_query(safe_sql, params, db)
except Exception as e:
    await db.rollback()
    # One retry: send error to LLM to fix
    fixed_sql = await generate_sql(
        question=f"Fix this SQL error: {e}\n\nOriginal question: {question}\n\nFailing SQL:\n{safe_sql}",
        tenant_id=..., user_id=...,
    )
    validated = validate_sql(fixed_sql)
    safe_fixed, params = prepare_query(validated, auth, app_id)
    rows = await execute_query(safe_fixed, params, db)
```

---

## 7. Updated Semantic Model

After fact tables are populated, update `semantic_model.yaml` to point at them.

**Before (JSONB lateral joins):**

```yaml
tables:
  thread_evaluations:
    jsonb_extractions:
      rule_compliance:
        extraction_sql: |
          CROSS JOIN LATERAL jsonb_array_elements(...)
```

**After (flat fact tables):**

```yaml
tables:
  analytics_run_facts:
    alias: rf
    description: "Pre-computed run-level metrics. One row per eval run."
    columns:
      run_id, app_id, eval_type, status, pass_rate, avg_intent_accuracy,
      thread_count, pass_count, fail_count, created_at, context
    access_control:
      tenant_column: tenant_id
  
  analytics_eval_facts:
    alias: ef
    description: "Per-evaluator per-thread results. Unified across all eval types."
    columns:
      run_id, item_id, item_type, evaluator_type, evaluator_name,
      result_status, result_score, success, context, created_at
    joins: "ef.run_id = rf.run_id"
    access_control:
      tenant_column: tenant_id

  analytics_criterion_facts:
    alias: cf
    description: "Per-rule per-thread results. Answers 'which rules fail most'."
    columns:
      run_id, item_id, criterion_source, criterion_id, criterion_label,
      evaluator_type, status, passed, evidence, created_at
    joins: "cf.run_id = rf.run_id"
    access_control:
      tenant_column: tenant_id
```

**The LLM generates simple queries:**

```sql
-- "Which rules fail most?" (before: JSONB lateral join nightmare)
SELECT criterion_id, criterion_label,
       COUNT(*) FILTER (WHERE status = 'VIOLATED') AS violated,
       COUNT(*) FILTER (WHERE status = 'FOLLOWED') AS followed
FROM analytics_criterion_facts
WHERE app_id = :app_id AND tenant_id = :tenant_id
GROUP BY criterion_id, criterion_label
ORDER BY violated DESC
LIMIT 20
```

---

## 8. Analytics Connection Pool

Separate pool for analytics queries. Same DB host for now. When you add a read replica, change one URL.

```python
# backend/app/database.py — add after existing engine:

analytics_engine = create_async_engine(
    settings.ANALYTICS_DATABASE_URL or settings.DATABASE_URL,  # falls back to primary
    echo=False,
    pool_size=5,           # smaller pool — analytics is background
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"server_settings": {"statement_timeout": "15000"}},  # 15s hard timeout
)

analytics_session = async_sessionmaker(analytics_engine, class_=AsyncSession, expire_on_commit=False)

async def get_analytics_db():
    async with analytics_session() as session:
        try:
            yield session
        finally:
            await session.close()
```

**Config:** Add `ANALYTICS_DATABASE_URL` to `backend/app/config.py` (defaults to empty string → falls back to primary).

**Usage:** The SQL agent's `execute_query` uses `analytics_session` instead of the main session.

---

## 9. Backfill Script

One-time script to populate fact tables from existing data.

**File:** `backend/scripts/backfill_analytics_facts.py`

```python
"""
Backfill analytics fact tables from existing eval_runs.
Idempotent — deletes existing facts for a run before re-inserting.
Run once after migration, or re-run to fix data.

Usage:
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts --app-id kaira-bot
  PYTHONPATH=backend python -m scripts.backfill_analytics_facts --run-id <uuid>
"""

async def backfill(app_id=None, run_id=None):
    # 1. Query completed runs (filtered by app_id/run_id if provided)
    # 2. For each run, call FactPopulator.populate(run_id)
    # 3. Log progress: "Backfilled run {i}/{total}: {run_id} ({rows} rows)"
    # 4. Log summary: "Done. {total_runs} runs, {total_rows} fact rows."
```

---

## 10. Worker Priority

The `jobs` table already has a `priority` column and the worker orders by `priority ASC`.

**Current priorities** (from `get_job_submission_metadata`):

| Job type | Current priority |
|----------|-----------------|
| evaluate-* | 100 |
| generate-report | 200 |
| generate-evaluator-draft | 300 |

**Add:**

| Job type | Priority |
|----------|----------|
| populate-analytics | 500 |

Lower number = higher priority. Analytics never blocks evals or reports.

**Worker scaling:** Set `replicas: 3` in `docker-compose.yml` for the worker service. Each worker uses `SKIP LOCKED` (already implemented) to pick different jobs.

---

## 11. Execution Order

| Phase | Items | Dependency |
|-------|-------|------------|
| **A: Schema** | Migration: create 6 tables (`analytics_run_facts`, `analytics_eval_facts`, `analytics_criterion_facts`, `analytics_jobs`, `agent_tool_logs`, `analytics_query_cache`) | None |
| **B: Models** | ORM models for all 6 tables in `backend/app/models/` | Phase A |
| **C: Extractors** | `backend/app/services/analytics/` — FactPopulator + 5 extractors | Phase B |
| **D: Job wiring** | Register `populate-analytics` job type, add trigger in each runner's completion path | Phase C |
| **E: Backfill** | Run backfill script for existing data | Phase D |
| **F: Semantic model** | Update `semantic_model.yaml` to point at fact tables | Phase E |
| **G: SQL agent** | Add EXPLAIN check, retry loop, cache integration | Phase F |
| **H: Tool logging** | Wire `agent_tool_logs` into `dispatch_tool_call` | Phase B |
| **I: Connection pool** | Add `analytics_session` to `database.py`, wire into SQL agent | Phase A |

**Phases A-E are the critical path.** F-I can be done in parallel after B.

**Estimated total:** ~15 files created, ~8 files modified, 1 migration, 1 backfill script.
