# Multi-Evaluator Aggregation — Design Spec

**Date:** 2026-04-18
**Branch:** `feat/multi-evaluator-aggregation`

## Problem

Four bugs compound to make multi-evaluator eval runs silently broken once the second evaluator has a different primary-metric field name than `overall_score`:

1. [`inside_sales_runner.py:398`](../../../backend/app/services/evaluators/inside_sales_runner.py#L398) — `if overall_score is None` picks only the first evaluator's score; the rest are dropped from the run summary.
2. [`call_quality.py:52`](../../../backend/app/services/analytics/extractors/call_quality.py#L52) — hardcoded `output.get("overall_score")` writes `NULL` to `analytics_eval_facts.result_score` for any evaluator whose primary field is named differently. Charts and PDFs render blank.
3. [`inside_sales_aggregator.py:71`](../../../backend/app/services/reports/inside_sales_aggregator.py#L71) — reads `field.get("main_metric")` (snake_case), but the rest of the codebase stores `isMainMetric` (camelCase). Flag never matches, always falls back to hardcoded `"overall_score"`.
4. [`inside_sales_report_service.py:107`](../../../backend/app/services/reports/inside_sales_report_service.py#L107) + [`inside_sales_aggregator.py:36`](../../../backend/app/services/reports/inside_sales_aggregator.py#L36) — PDF report loads only evaluator #1's schema and reads `evals[0]` only; evaluators 2..N are invisible in the PDF.

All four trace to one root cause: code assumes one evaluator per run and/or a fixed `overall_score` field name.

## Principle

`output_schema[i].isMainMetric` (camelCase) is the single source of truth for the primary numeric field. Every layer uses `find_primary_field()` — no hardcoded field names anywhere.

## Changes

### 1. Shared helper — `backend/app/services/evaluators/output_schema_utils.py`

Add `primary_score(output: dict, schema: list[dict]) -> float | None`:

- Calls `find_primary_field(schema)`.
- If primary is numeric and present, returns `float(output[key])`.
- Returns `None` on any extraction failure. One canonical implementation used by runners, extractors, and aggregators.

### 2. Runner — `backend/app/services/evaluators/inside_sales_runner.py`

- Preload `{evaluator_id: output_schema}` for all evaluators attached to the run.
- Per-call: compute per-evaluator primary scores via the shared helper; persist `evaluations[]` as before.
- Remove the `if overall_score is None` guard. Keep `result.overall_score` as mean-across-evaluators for back-compat.
- New run-summary shape:

  ```
  summary = {
      "total": N, "evaluated": M, "failed": K,
      "evaluators": [
          {"id", "name", "primary_field", "primary_type",
           "average_score", "completed", "errors"},
          ...
      ],
      "average_score": mean(ev.average_score for numeric evaluators),  # back-compat, new semantics
      "overall_score": same,                                           # back-compat alias
      "evaluator_names": [...],                                         # back-compat
  }
  ```

### 3. Analytics extractor — `backend/app/services/analytics/extractors/call_quality.py`

- Signature stays the same (takes `run`, `threads`). Fetch evaluator schemas inside: `SELECT id, output_schema FROM evaluators WHERE id IN (...)` using evaluator_ids seen in `evaluations[]`.
- For each `ev`, resolve primary via `find_primary_field(schemas[ev.evaluator_id])` and write `result_score = primary_score(output, schema)`.
- `RunFactRow.avg_score` = mean of the collected per-evaluator numeric primaries (unchanged behavior, just no longer limited to `overall_score`-named fields).
- Async-aware: the extractor runs in the post-job finalize step, which is already async.

### 4. Report aggregator — `backend/app/services/reports/inside_sales_aggregator.py`

- Fix `main_metric` → `isMainMetric` (bug #3).
- Signature changes: `output_schemas: dict[str, list[dict]]` (evaluator_id → schema) instead of a single `output_schema`.
- `aggregate()` returns `{perEvaluator: {ev_id: {runSummary, dimensionBreakdown, complianceBreakdown, flagStats, agentSlices}}, combined: {avgQaScore, ...}}`.
- Back-compat: if the caller passes a single schema (existing callers), wrap it as `{_legacy_: schema}` and emit only `perEvaluator._legacy_` + combined. Tests cover both paths.

### 5. Report service — `backend/app/services/reports/inside_sales_report_service.py`

- `_load_evaluator_schema` → `_load_evaluator_schemas(run, thread_dicts) -> dict[str, list]`. Reads every `evaluator_id` seen in `evaluations[]` across all threads, fetches all schemas in one query.
- Passes the dict to `InsideSalesAggregator`.
- `InsideSalesReportPayload` gains `per_evaluator: dict[str, {runSummary, dimensionBreakdown, ...}]`; `run_summary` / `dimension_breakdown` continue to populate from `combined` for back-compat with the report adapter.

### 6. Frontend — `src/features/evalRuns/pages/RunList.tsx`

- `getRunScore()`: if `summary.evaluators?.length > 0`, use `summary.average_score` (already mean-of-means server-side) and append `(N evaluators)` badge for N > 1.
- Old runs fall through to existing heuristic.
- Tooltip on the badge lists per-evaluator names and averages.

### 7. Sherlock semantic model

- Add description on `analytics_eval_facts.result_score`: *"Primary numeric metric of the evaluator, auto-detected from the evaluator's `output_schema` `isMainMetric` flag. For multi-evaluator runs, filter by `evaluator_id` or `evaluator_name`."*
- No schema changes; `evaluator_id` already exists and now gets populated correctly.

## Non-goals (YAGNI)

- No DB migration (all JSONB).
- No UI to mark a "primary evaluator on the run" (per-evaluator breakdown is sufficient).
- No rename of `average_score` / `overall_score` (kept as back-compat aliases).
- No changes to voice-rx or adversarial runners (single-evaluator by design).
- No redesign of the evaluator registration flow.

## Testing

1. **Unit** — `test_inside_sales_aggregator_multi_evaluator.py`: two evaluators with different primary fields, assert `perEvaluator` keyed correctly and `combined.avgQaScore` is mean-of-means.
2. **Unit** — `test_call_quality_extractor_primary_field.py`: evaluator with `isMainMetric: true` on `empathy_score`; assert `EvalFactRow.result_score` = `output.empathy_score`, not NULL.
3. **Integration / e2e** — re-run the three inside-sales runs (GoodFlip-only, Feelsy-only, combined) used in the earlier verification doc; assert:
   - `summary.evaluators` has one entry per attached evaluator.
   - `summary.average_score` = mean of those entries' averages.
   - `analytics_eval_facts.result_score` is non-null for every evaluator row.
   - PDF report renders per-evaluator sections.

## Verification (go-live gate)

All green required: backend tests, `npx tsc -b`, `npm run build`, `npm run lint`, and the e2e re-run against the existing DB artifacts.
