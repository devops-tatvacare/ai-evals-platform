# Analytics Platform — Design Specification

> This document explains the WHY and the BEFORE/AFTER for every decision.
> Read this first for understanding. Read `analytics-platform-plan.md` for implementation details.

---

## 1. The Problem

### What exists today

The platform evaluates AI chatbot conversations across three apps (kaira-bot, voice-rx, inside-sales) and stores results in PostgreSQL. Each evaluation run produces:

- An `eval_runs` row with summary stats and config snapshot
- Child rows in `thread_evaluations` (one per conversation thread) or `adversarial_evaluations` (one per attack test case)
- The detailed evaluation result is stored as a **JSON blob** inside `thread_evaluations.result`

The JSON blob contains deeply nested structures — rule compliance outcomes, friction analysis, custom evaluator outputs — all buried 3-4 levels deep inside arrays within arrays.

### What breaks

The platform has an AI chat assistant ("Sherlock") that answers analytical questions. When a user asks "which rules are most violated across all runs?", the system must:

1. Scan every thread evaluation row for the app
2. For each row, unpack the JSON blob with `jsonb_array_elements()` lateral joins
3. Drill into `result -> 'correctness_evaluations' -> [] -> 'rule_compliance' -> []`
4. Group and count across all unpacked rows

This is a **full table scan with JSON unpacking at query time**. At 10K threads it takes seconds. At 100K it takes minutes. At 1M it will timeout.

Additionally, the `result` column is `JSON` type (not `JSONB`), requiring an explicit `::jsonb` cast before any array operations. The LLM-generated SQL frequently forgets this cast, causing query failures.

### Why it can't be fixed with indexes

PostgreSQL cannot index inside arbitrary JSON arrays. You can index a specific JSON path (`result->>'status'`), but you cannot index "every element of a nested array within another nested array." The data structure is designed for flexibility (different evaluator types produce different shapes), which is correct for the transactional write path but catastrophic for the analytical read path.

### Why JSONB context columns are OK but JSONB arrays are not

The plan uses JSONB in two different ways. This distinction is critical:

**BAD (what we're eliminating):** `jsonb_array_elements(result->'correctness_evaluations')` — unpacking nested arrays row-by-row. This is O(rows × array_size) with no index support. Every query re-scans and re-unpacks.

**GOOD (what we're using):** `context->>'agent_name' = 'John'` — point lookup on a flat key-value object. GIN-indexed, O(log n) lookup. No unpacking, no lateral joins. This is how PostgreSQL JSONB is designed to be queried.

The fact tables use JSONB for app-specific metadata (call duration, agent name, recording URL) that varies by app. These are flat key-value pairs, never nested arrays.

---

## 2. The Solution

### Core idea

Separate the **write path** (flexible JSON for any evaluator output) from the **read path** (flat, indexed, pre-extracted tables for analytics).

When an evaluation completes, a background job extracts the relevant data points from the JSON blobs and writes them into three flat "fact" tables. The AI chat assistant queries these fact tables — never the raw JSON.

### Three fact tables, three perspectives

The analytics data model has three grains, each answering a different category of questions:

**`analytics_run_facts`** — One row per evaluation run.

- Answers: "How are runs trending? What's the pass rate over time? Which runs were worst?"
- Contains pre-computed aggregates: pass_rate, fail_count, thread_count, avg_intent_accuracy
- The SQL agent uses this for run-level questions without scanning thousands of thread rows

**`analytics_eval_facts`** — One row per evaluator per thread.

- Answers: "How did each evaluator score this thread? Which evaluator flags issues most? What are the rubric scores?"
- This is the bridge table that normalizes the "both" problem. A built-in correctness evaluator producing PASS/FAIL and a custom evaluator producing a 7.5/10 score both become one row with generic columns: `evaluator_type`, `evaluator_name`, `result_status`, `result_score`
- Different eval types map differently:
  - kaira-bot batch_thread: one row for intent, one for correctness, one for efficiency, one per custom evaluator — per thread
  - inside-sales call_quality: one row per rubric evaluator per call
  - adversarial: one row per test case
  - voice-rx: one row per listing evaluation
  - custom: one row per evaluator run

**`analytics_criterion_facts`** — One row per criterion (rule/check) per thread.

- Answers: "Which rules fail most? What's the compliance rate? Which rules co-fail together?"
- Criterion is the generic term for what kaira-bot calls "rules" (from rule_catalog), what adversarial tests call "judge rules", and what future apps might call "checks" or "criteria"
- Each row has: `criterion_source` (where the criterion came from), `criterion_id` (the rule/check identifier), `status` (FOLLOWED/VIOLATED/NOT_APPLICABLE), `evidence` (why)

### Why three tables instead of one

A single denormalized table at the finest grain (criterion per thread) would have hundreds of millions of rows at scale — one thread with 10 rules across 3 evaluators = 30 rows. For run-level questions ("pass rate trend"), the query would aggregate across millions of criterion rows when it only needs to scan thousands of run rows.

Three tables at three grains means:
- Run-level questions scan `analytics_run_facts` (thousands of rows, instant)
- Evaluator-level questions scan `analytics_eval_facts` (tens of thousands, fast)
- Rule-level questions scan `analytics_criterion_facts` (hundreds of thousands, still fast because it's flat + indexed)

### Why not materialized views

Materialized views do a full recompute on every `REFRESH`. At 1M rows, that refresh takes minutes and locks the view during recompute. Real tables with incremental upserts (insert only the new run's facts) are faster and non-blocking.

---

## 3. The Population Pipeline

### How facts get created

When an evaluation run completes (status transitions to `completed`), the eval runner submits a low-priority background job (`populate-analytics`). The worker picks it up and runs the `FactPopulator` service.

The pipeline:

```
Eval runner completes a run
  → Marks eval_run.status = 'completed'
  → Submits a 'populate-analytics' job to the job queue (priority 500)
  → Returns immediately — the eval is done

Worker picks up the analytics job (when no higher-priority work is pending)
  → FactPopulator loads the run + its child evaluations
  → Deletes any existing facts for this run_id (idempotent)
  → Dispatches to the correct extractor based on eval_type
  → Extractor reads the JSON result, extracts flat rows
  → Bulk inserts into the three fact tables
  → Logs metadata to analytics_jobs table
```

### Why a separate job, not inline

If analytics extraction runs inside the eval runner and fails (bug in extraction code, DB timeout), the eval run itself would be marked as failed — even though the actual evaluation completed successfully. The user sees "failed" and panics.

By using a separate job:
- The eval run succeeds independently
- The analytics job can fail and retry without affecting the eval
- Analytics jobs run at low priority (500 vs 100 for evals) — they never block eval execution
- The worker's existing retry mechanism handles transient failures

### Why Python, not SQL procedures

The extraction logic varies by eval_type. Each eval_type has a different JSON structure. A SQL procedure would need complex conditional logic with dynamic JSON paths. Python extractors are:
- Testable (unit tests per extractor)
- Readable (one file per eval_type, clear data mapping)
- Extensible (new eval_type = new file, register in EXTRACTORS dict)
- Already in the codebase style (async SQLAlchemy, ORM models)

### Extractor architecture

Each eval_type has its own extractor file in `backend/app/services/analytics/extractors/`. The `FactPopulator` class looks up the extractor by `eval_type` from a registry dict:

```python
EXTRACTORS = {
    "batch_thread": extract_batch_thread,
    "call_quality": extract_call_quality,
    "batch_adversarial": extract_adversarial,
    "full_evaluation": extract_full_eval,
    "custom": extract_custom,
}
```

Adding a new eval_type means adding one file and one line in the registry. No changes to existing extractors, no changes to the populator, no changes to the job runner.

Each extractor receives the eval run + its child rows and returns a `FactSet` — a simple dataclass containing lists of `RunFactRow`, `EvalFactRow`, and `CriterionFactRow`. The populator bulk-inserts these. The extractor never touches the database directly.

### Idempotency

The populator deletes existing facts for a `run_id` before inserting new ones. This means:
- Re-running the job produces identical results
- If the extractor logic changes (bug fix), re-running the backfill corrects the data
- No duplicate rows, no partial state

---

## 4. The Generic Design

### Why everything is generic

The platform currently has three apps (kaira-bot, voice-rx, inside-sales). The roadmap includes 10+ more agents with 100+ evaluators. Each evaluator produces different output. The fact tables must handle all of them without schema changes.

### How generic columns work

**`evaluator_type`** — A category string. Not an evaluator's name, but its kind: `intent`, `correctness`, `efficiency`, `custom`, `call_rubric`, `adversarial_judge`, `critique`. When a new built-in evaluator category is added, this gets a new value. No migration.

**`evaluator_name`** — The human-readable name. For built-in evaluators, it's fixed ("Intent Accuracy", "Correctness"). For custom evaluators, it's whatever the user named their evaluator. Stored as text, never used as a foreign key.

**`evaluator_id`** — UUID FK to the evaluators table. Only set for custom evaluators. Null for built-in. This lets you join to the evaluator definition to get the output schema, prompt, etc.

**`criterion_source`** — Where the criterion came from: `rule_catalog` (kaira-bot rules), `adversarial_rule` (adversarial judge rules), `custom_criterion` (future). New sources don't require migration.

**`criterion_id`** — The rule/check identifier. For rule_catalog rules, it's the `rule_id` from the catalog. For custom criteria, it's whatever the evaluator defines. Stored as text.

**`context`** — JSONB column for app-specific metadata that doesn't fit in the generic columns. Examples:
- For inside-sales: `{"agent": "John", "direction": "INBOUND", "duration": 120}`
- For voice-rx: `{"file_type": "audio", "quality_score": 85}`
- For kaira-bot: `{"model": "gemini-2.0-flash", "run_name": "test 1"}`

GIN-indexed for efficient filtering. Never contains nested arrays.

### How app_id drives everything

Every fact row has `app_id`. The `app_id` is copied from `eval_runs.app_id` at extraction time. The SQL agent always filters by `app_id`. No hardcoded app names appear in any table definition, query template, or extraction logic.

When a new app is added:
1. The app gets evaluators (existing system)
2. Eval runs produce results (existing system)
3. The extractor for that eval_type extracts facts (existing extractors work for any app)
4. The semantic model's table definitions don't change
5. The SQL agent generates queries with `WHERE app_id = :app_id`

No code changes needed for new apps unless the new app introduces a new eval_type (new JSON structure). In that case, one new extractor file is added.

---

## 5. Observability

### Agent tool logs

Every tool call from the chat assistant is logged to `agent_tool_logs`. This captures:

- **What:** tool name, arguments, generated SQL
- **How:** execution time, row count, cache hit/miss
- **Result:** status (ok/error), error message if failed
- **Cost:** LLM model used, tokens consumed (for the inner SQL generation call)

This lets you answer:
- "What questions do users ask most?"
- "Which SQL patterns fail most often?"
- "What's the average query time?"
- "How much are we spending on SQL generation LLM calls?"
- "What's the cache hit rate?"

The logging is fire-and-forget — if logging fails, the tool call still succeeds. Logging is done in `dispatch_tool_call`, which is the single entry point for all tool execution. No per-tool logging code needed.

### Analytics job logs

Every analytics population job is logged to `analytics_jobs`. This tracks:

- Timing: when it started, how long it took
- Volume: how many rows were inserted/updated/deleted
- Errors: what went wrong if it failed
- Metadata: which facts were affected, retry count

This lets you answer:
- "How long does fact population take per run?"
- "Are there extraction failures I need to fix?"
- "Is the analytics pipeline keeping up with eval throughput?"

---

## 6. Query Cache

### Why cache in PostgreSQL, not Redis

The analytics tables are already in PostgreSQL. A cache table there avoids adding Redis as infrastructure. The cache pattern is identical:

1. Hash the SQL query
2. Check: `SELECT result_json FROM analytics_query_cache WHERE sql_hash = :hash AND tenant_id = :tid AND app_id = :aid AND expires_at > now()`
3. Cache miss → execute query → store result with 120s TTL
4. Cache hit → return stored result

When you eventually need Redis (multiple backend replicas, sub-millisecond cache lookups), the interface is identical — swap the cache backend, not the API.

### Per-tenant isolation

Cache is keyed by `(sql_hash, tenant_id, app_id)`. Tenant A's cached result is never returned to Tenant B. This is a security requirement, not a performance optimization.

### TTL

120 seconds. Analytics data changes when new eval runs complete, which happens at most every few minutes. A 2-minute cache means:
- Same question asked twice within 2 minutes → instant response
- New data available within 2 minutes of a run completing
- No manual cache invalidation needed

---

## 7. SQL Agent Hardening

### EXPLAIN cost check

Before executing any LLM-generated SQL, run `EXPLAIN (FORMAT JSON)` to estimate the query cost. If the estimated cost exceeds a threshold (50,000), reject the query and tell the LLM to try a narrower question.

This prevents:
- Accidental full table scans from poorly generated SQL
- Cross-joins that the LLM might produce
- Queries that would tie up a database connection for minutes

### Retry loop

If the generated SQL fails execution (syntax error, wrong column name), send the error message back to the inner LLM with the failing SQL. The LLM fixes the SQL based on the error. One retry attempt, then fail gracefully.

This improves success rate significantly — most LLM SQL errors are minor (wrong alias, missing cast, typo in column name) and the LLM can fix them when shown the error.

### Updated semantic model

After fact tables are deployed, the semantic model (`semantic_model.yaml`) is updated to describe the fact tables instead of the raw transactional tables. The LLM generates simple `SELECT ... FROM analytics_criterion_facts WHERE ...` queries instead of complex JSONB lateral join queries.

Simpler SQL means:
- Fewer LLM generation errors
- Faster query execution
- No `::jsonb` cast issues
- No lateral join syntax to get wrong

---

## 8. Analytics Connection Pool

### Why separate

Analytics queries are read-heavy, potentially slow, and should not compete with the write path (eval runners saving results, API serving requests). A separate connection pool means:

- Analytics queries have their own connections (pool_size=5)
- A slow analytics query doesn't block API requests
- A 15-second statement timeout is enforced (vs no timeout on the main pool)
- When you add a read replica later, you change ONE connection string (`ANALYTICS_DATABASE_URL`)

### How it works today

Same PostgreSQL instance, separate pool. The SQL agent uses `analytics_session` instead of the main `async_session`. The `FactPopulator` uses the main session (it writes facts). The separation is in the connection pool configuration, not the database.

---

## 9. Worker Priority

### Current state

The worker already has priority-based job pickup:
```sql
ORDER BY priority ASC, created_at ASC
```
Lower number = higher priority. Existing priorities: evals at 100, reports at 200.

### Change

Analytics jobs at priority 500. They run when no evals or reports are pending. Analytics is derived data — it's OK to be seconds behind. Evals and reports are user-facing — they must be fast.

### Scaling

Run 3 worker instances instead of 1. Each worker uses `SELECT ... FOR UPDATE SKIP LOCKED` (already implemented) to pick different jobs without conflicts. No code changes needed — just `docker compose` scaling.

---

## 10. Before and After

### Before: User asks "which rules fail most across all runs?"

```
1. Sherlock calls analyze("which rules fail most?")
2. Inner LLM generates SQL with CROSS JOIN LATERAL jsonb_array_elements(...)
3. SQL unpacks every thread's JSON blob at query time
4. At 100K threads × 10 rules = 1M rows to scan and unpack
5. Query takes 15+ seconds or timeouts
6. LLM frequently generates wrong SQL (forgets ::jsonb cast, wrong lateral syntax)
7. User gets an error or waits forever
```

### After: Same question

```
1. Sherlock calls analyze("which rules fail most?")
2. Inner LLM generates: SELECT criterion_id, COUNT(*) FROM analytics_criterion_facts WHERE ... GROUP BY criterion_id
3. Simple indexed scan on a flat table
4. At 100K criterion rows: <200ms
5. No JSONB unpacking, no lateral joins, no cast issues
6. Query cache: if asked again within 2 minutes, instant response
7. User gets the answer in under a second
```

### Before: Evaluation completes

```
1. Eval runner marks run as completed
2. Summary stats stored in eval_runs.summary (JSON)
3. Thread details stored in thread_evaluations.result (JSON)
4. No further processing
5. Analytics queries must re-scan and re-unpack JSON every time
```

### After: Evaluation completes

```
1. Eval runner marks run as completed
2. Summary stats stored in eval_runs.summary (JSON) — unchanged
3. Thread details stored in thread_evaluations.result (JSON) — unchanged
4. Runner submits 'populate-analytics' job (priority 500)
5. Worker picks up job, FactPopulator extracts flat rows
6. Three fact tables populated: run_facts, eval_facts, criterion_facts
7. Analytics queries hit flat indexed tables — instant
```

### Before: Adding a new app with custom evaluators

```
1. Create evaluators for the new app
2. Run evaluations — results stored in thread_evaluations.result JSON
3. Chat assistant can't answer questions about the new app's criteria
4. Developer must write a new tool handler that understands the JSON shape
5. Deploy, test, iterate
```

### After: Adding a new app with custom evaluators

```
1. Create evaluators for the new app
2. Run evaluations — results stored in thread_evaluations.result JSON
3. populate-analytics job fires, extracts facts using the existing extractor for that eval_type
4. Fact tables populated with generic columns (evaluator_type='custom', evaluator_name=user's name)
5. Chat assistant immediately queries analytics_eval_facts — works out of the box
6. No new code unless the app introduces a completely new eval_type
```

---

## 11. Files Created/Modified Summary

### New files

| File | Purpose |
|------|---------|
| `backend/app/models/analytics_facts.py` | ORM models for 3 fact tables |
| `backend/app/models/analytics_log.py` | ORM models for analytics_jobs + agent_tool_logs + analytics_query_cache |
| `backend/app/services/analytics/__init__.py` | `submit_analytics_job()` helper |
| `backend/app/services/analytics/fact_populator.py` | Main populator class |
| `backend/app/services/analytics/types.py` | FactSet, PopulationResult, row dataclasses |
| `backend/app/services/analytics/extractors/__init__.py` | Extractor registry |
| `backend/app/services/analytics/extractors/batch_thread.py` | batch_thread extractor |
| `backend/app/services/analytics/extractors/call_quality.py` | call_quality extractor |
| `backend/app/services/analytics/extractors/adversarial.py` | adversarial extractor |
| `backend/app/services/analytics/extractors/full_eval.py` | full_evaluation extractor |
| `backend/app/services/analytics/extractors/custom_eval.py` | custom eval extractor |
| `backend/scripts/backfill_analytics_facts.py` | One-time backfill script |
| `alembic/versions/xxxx_add_analytics_tables.py` | Migration for all 6 tables |

### Modified files

| File | Change |
|------|--------|
| `backend/app/database.py` | Add `analytics_engine` + `analytics_session` |
| `backend/app/config.py` | Add `ANALYTICS_DATABASE_URL` env var |
| `backend/app/services/job_worker.py` | Register `populate-analytics` job type |
| `backend/app/services/evaluators/batch_runner.py` | Add `submit_analytics_job()` call after completion |
| `backend/app/services/evaluators/inside_sales_runner.py` | Same |
| `backend/app/services/evaluators/adversarial_runner.py` | Same |
| `backend/app/services/evaluators/voice_rx_runner.py` | Same |
| `backend/app/services/evaluators/custom_evaluator_runner.py` | Same |
| `backend/app/services/report_builder/tool_handlers.py` | Add tool logging in `dispatch_tool_call` |
| `backend/app/services/chat_engine/sql_agent.py` | Add EXPLAIN check, retry loop, cache, use analytics_session |
| `backend/app/services/chat_engine/semantic_model.yaml` | Point at fact tables |

### Unchanged

- All frontend code — the chat widget, store, components
- The eval runners' core logic — they still produce the same JSON results
- The report generation pipeline — it still reads from raw tables
- The existing `EvaluationAnalytics` cache — still used by reports

---

## 12. Scaling Profile

| Data volume | Before (JSONB) | After (fact tables) |
|-------------|---------------|---------------------|
| 10K threads | 1-5s rule queries | <100ms |
| 100K threads | 15-60s, frequent timeouts | <500ms |
| 1M threads | Unusable | <2s |
| 10M threads | Dead | Needs read replica (change one URL) |
