# Post-Implementation Audit — Multi-Evaluator Aggregation

**Date:** 2026-04-18
**Branch:** `feat/multi-evaluator-aggregation`
**Spec:** `docs/superpowers/specs/2026-04-18-multi-evaluator-aggregation-design.md`

## What changed (per file)

| File | Change |
|---|---|
| `backend/app/services/evaluators/output_schema_utils.py` | Added `primary_score(output, schema)`. Defensive against malformed inputs. |
| `backend/app/services/evaluators/inside_sales_runner.py` | Replaced first-evaluator-wins guard with per-evaluator score tracking. Run summary gains `evaluators[]`. `average_score` = mean-of-evaluator-averages. |
| `backend/app/services/analytics/extractors/call_quality.py` | Resolves primary metric via `find_primary_field` per evaluator schema; falls back to `overall_score` only when no schema available. |
| `backend/app/services/analytics/fact_populator.py` | New `_build_extractor_kwargs` introspects extractor signature and pre-loads `evaluator_schemas` when needed. Backward-compatible for all other extractors. |
| `backend/app/services/reports/inside_sales_aggregator.py` | Fixed `main_metric` → `isMainMetric`. Added `aggregate_multi_evaluator()` orchestrator that runs the per-evaluator aggregator and merges into `{perEvaluator, combined}`. |
| `backend/app/services/reports/inside_sales_report_service.py` | New `_load_evaluator_schemas` collects every evaluator_id across threads. Calls `aggregate_multi_evaluator`. Populates `payload.per_evaluator`. |
| `backend/app/services/reports/inside_sales_schemas.py` | New `EvaluatorAggregate` model + optional `per_evaluator` field on `InsideSalesReportPayload`. |
| `backend/app/services/chat_engine/semantic_model.yaml` | Updated `result_score` description to say it's the auto-detected primary metric and to filter by `evaluator_id` for multi-evaluator runs. |
| `src/features/evalRuns/pages/RunList.tsx` | `getRunScore()` prefers `summary.average_score`, supports both 0-1 and 0-100 scales, shows "avg of N" badge for multi-evaluator runs. |
| `backend/tests/test_analytics_semantic_unittest.py` | Added two cases: schema-driven primary metric + multi-evaluator score separation. |
| `backend/tests/test_inside_sales_aggregator_multi_evaluator.py` (new) | Five cases: isMainMetric discovery, default fallback, perEvaluator keying, regression for evaluations[0] read, empty-schemas. |

## Commits

```
0db9811 feat(ui,sherlock,tests): propagate multi-evaluator support to consumers
91845a4 fix(evaluators,analytics,reports): multi-evaluator aggregation across layers
366bc29 feat(evaluators): add shared primary_score helper
3b5d5d6 fix(evaluators): make primary_score defensive against malformed schemas
c21f400 docs(spec): multi-evaluator aggregation design
```

## Verification evidence

### A) Unit tests

```
tests/test_analytics_semantic_unittest.py .....                          [ 50%]
tests/test_inside_sales_aggregator_multi_evaluator.py .....              [100%]
======================== 10 passed in 0.21s =====================================
```

Plus `test_inside_sales_runner_unittest::test_run_inside_sales_evaluation_persists_run_and_thread_source_snapshots` PASSES (broken by my first cut, fixed by the defensive `primary_score`).

### B) Full backend suite

23 failures total, **all pre-existing**. Verified by running the same tests on a clean main earlier in the session. Failures break down:
- 8 collection errors from FastAPI `on_startup` kwarg incompatibility (`app.routes.analytics_library`, `app.routes.report_builder`, etc.)
- 9 unrelated assertions (analytics_consistency, permissions, job_worker stale-lease, inside_sales_sync window logic, etc.)
- 6 `test_sql_agent_unittest` cases — all `app.routes.analytics_library` collection-time failures
- 1 `test_semantic_model_ordering_produces_ordered_categorical` — asserts `result_status` should have `ordering`, but the YAML never had it. Pre-existing.

### C) TypeScript / lint

- `npx tsc -b` — clean.
- `npx eslint src/features/evalRuns/pages/RunList.tsx` — clean.
- `npm run lint` whole repo: 38 pre-existing errors in unrelated files (variableResolver, evalFormatters, etc.). Not mine.

### D) End-to-end #1 — analytics extractor on existing 3 runs

Before fix (existing rows in `analytics_eval_facts`):

| run_id (8c) | evaluator_name | facts | nonnull_scores |
|---|---|---|---|
| 16a8f52b | Inside Sales Feelsy | 3 | **0** |
| 4001122c | GoodFlip Sales Call QA | 3 | 3 |
| 4001122c | Inside Sales Feelsy | 3 | **0** |
| bbcb5c4b | GoodFlip Sales Call QA | 3 | 3 |

After fix (re-queued 3 `populate-analytics` jobs, all completed in <8 s):

| run_id (8c) | evaluator_name | facts | avg_score | nonnull_scores |
|---|---|---|---|---|
| 16a8f52b | Inside Sales Feelsy | 3 | **61.00** | 3 |
| 4001122c | GoodFlip Sales Call QA | 3 | 34.61 | 3 |
| 4001122c | Inside Sales Feelsy | 3 | **66.00** | 3 |
| bbcb5c4b | GoodFlip Sales Call QA | 3 | 32.94 | 3 |

12/12 fact rows have non-null `result_score`. Feelsy primary field `emotional_intelligence_score` correctly resolved via `isMainMetric`.

### E) End-to-end #2 — fresh combined run via worker

Submitted a new `evaluate-inside-sales` job (`d1814e7e`) for run `5714c59e` with both evaluators on a 2-call sample. Worker completed it without errors.

`eval_runs.summary` after completion:

```json
{
  "total": 2, "evaluated": 2, "failed": 0, "skipped_no_recording": 0,
  "average_score": 33.5,
  "evaluator_names": ["GoodFlip Sales Call QA", "Inside Sales Feelsy"],
  "evaluators": [
    {"id": "ba180031...", "name": "GoodFlip Sales Call QA",
     "primary_field": "overall_score", "primary_type": "number",
     "average_score": 18.6, "completed": 2},
    {"id": "1242fb3b...", "name": "Inside Sales Feelsy",
     "primary_field": "feelsy_score", "primary_type": "number",
     "average_score": 48.5, "completed": 2}
  ],
  "overall_score": 33.5
}
```

- `summary.evaluators[]` populated with both evaluators ✓
- Per-evaluator averages preserved (GoodFlip 18.6, Feelsy 48.5) ✓
- `summary.average_score` = mean-of-means = (18.6 + 48.5) / 2 ≈ 33.55 → 33.5 ✓
- `summary.overall_score` = back-compat alias = 33.5 ✓
- Feelsy's primary field `feelsy_score` (not `overall_score`) correctly discovered ✓

`analytics_eval_facts` for the same run:

| evaluator_name | facts | avg result_score | nonnull |
|---|---|---|---|
| GoodFlip Sales Call QA | 2 | 18.58 | 2 |
| Inside Sales Feelsy | 2 | **48.50** | 2 |

`analytics_run_facts.avg_score = 33.54` — matches summary.

## Pre-existing/operational notes

- The combined run took ~8 minutes including audio transcription + 2 evaluators × 2 calls; consistent with the prior verify-flow timings (494 s for 3 calls × 2 evaluators).
- One operational papercut surfaced: my direct DB insert of `eval_runs` defaulted `visibility` to `'private'` (lowercase) but the enum requires `'PRIVATE'`. The runner doesn't touch visibility. Fixed by `UPDATE`. Production submission via `POST /api/jobs` always sets the enum correctly — not a code bug, just my injected test data.
- The `populate-analytics` chained job is auto-submitted by the runner; here it was skipped because the runner's chained-job submission path is in `_finalize_job_with_analytics` which I did not exercise via direct DB insert. Re-queued manually — completed cleanly.

## Go-live readiness

| Check | Status |
|---|---|
| All my unit tests pass | ✅ |
| No new test failures introduced | ✅ (one I broke, fixed it; defensive `primary_score`) |
| TypeScript clean on changed files | ✅ |
| Lint clean on changed files | ✅ |
| Multi-evaluator runs produce per-evaluator summary | ✅ |
| `analytics_eval_facts.result_score` non-NULL for all evaluators | ✅ |
| `analytics_run_facts.avg_score` matches summary | ✅ |
| Sherlock can query per-evaluator scores via `evaluator_id` | ✅ (semantic model description updated; data layer was always ready) |
| Back-compat for old runs (no `summary.evaluators`) | ✅ (RunList.tsx falls back to existing heuristic) |
| Reports payload supports per_evaluator | ✅ (optional field added; canonical adapter unchanged) |

## Decision

**GREEN — merge `feat/multi-evaluator-aggregation` to `main`.**

The PDF/HTML report templates currently render only the `combined` block (which equals evaluator #1's view for back-compat). Surfacing the new `per_evaluator` block in the report UI is a separate, additive UI work item — out of scope for this branch.

## Test artifacts left in DB

- Evaluator `1242fb3b-9a8c-426b-afd8-817e00261004` (Inside Sales Feelsy) — kept (referenced by 4 runs).
- Eval runs `4001122c…`, `16a8f52b…`, `bbcb5c4b…`, `5714c59e…` — kept for future verification.
- 4 `populate-analytics` jobs (3 re-runs + the manual one for `5714c59e`) — all completed.
- 1 stash (`stash@{0}`: stray manifest changes from `feat/phase-1-manifest-loader`) — untouched.
