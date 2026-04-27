# Drift Report — 2026-04-27

Inputs:
- `prod_schema_snapshot.sql` — `pg_dump --schema-only --no-owner --no-privileges` of prod (`ai_evals_platform` @ `10.60.16.8`).
- `/tmp/models_schema.sql` — `pg_dump` of a throwaway Postgres after `Base.metadata.create_all()` (59 tables).
- `diff_prod_to_models.sql` (115 lines) and `diff_models_to_prod.sql` (134 lines) — `migra --unsafe` both directions, regenerated after Bucket A reconciliation.

Buckets per `03-drift-audit.md`:
- **A** — model stale, prod right → fix the model.
- **B** — prod stale, model right → catch-up migration after baseline.
- **C** — accept drift, no action → record in `drift_accepted.md`.
- **D** — cleanup needed in prod → planned migration after baseline.

Tables in prod = 60. Tables in models = 59. Difference = `lsq_lead_cache` (prod-only, dead).

## Caveat

Prod dump was taken **without** `--no-comments`. The drift-audit protocol called for stripping comments. `migra` doesn't compare `pg_description` rows in default mode, so the diff isn't polluted, but the snapshot file still carries Sherlock manifest comments. They'll be re-applied by `sync_column_comments.py` post-baseline anyway, so no functional harm.

## Decision log

- **Original A5/A6 (analytics_charts/dashboards source_session_id FK)** — investigation showed prod has DUPLICATE FK constraints: both the SQLAlchemy-default `*_source_session_id_fkey` AND a manually-added `fk_*_source_session_id`. Models declare the FK correctly. **Reclassified to bucket D** — drop the redundant `fk_*` constraints.
- **Original B3 (source_lead_records column types)** — first-pass classification had the direction reversed. Models had `String(255)`/`String(50)` (VARCHAR); prod had `text`. User decision: keep TEXT. **Reclassified to bucket A** — change models from `String(...)` to `Text`. No prod migration.
- **B2 (sherlock_runtime_sessions.scratchpad default)** — first-pass classification had the direction reversed. Prod default contains `composed_report` key; model default does NOT (deliberately removed per code comment at `sherlock_runtime.py:24-27` — Sherlock Core no longer stores report-builder-specific state, legacy rows tolerated on load). **Catch-up DDL is to REMOVE the key from prod's default**, not add it.

## Bucket A — RESOLVED

| # | Object | Resolution |
|---|---|---|
| ~~A1~~ | `evaluators` partial unique index | Replaced `idx_evaluators_seed_scope` btree with `uq_evaluators_seed_scope` partial unique. |
| ~~A2~~ | `jobs.idempotency_key` partial unique | Added `uq_jobs_user_idempotency_key`. |
| ~~A3~~ | `llm_usage.idempotency_key` partial unique | Added `uq_llm_usage_idempotency_key`. |
| ~~A4~~ | `sherlock_runtime_turns.correlation_id` partial index | Added `postgresql_where=text('correlation_id IS NOT NULL')`. |
| ~~A7~~ | `source_lead_records` 11 columns | Changed `String(255)`/`String(50)` to `Text` for: `agent_name`, `agent_name_normalized`, `condition`, `condition_normalized`, `email`, `first_name`, `intent_to_pay`, `last_name`, `phone`, `plan_name`, `source_campaign`. |

Re-ran `migra` both directions. None of the A1–A4/A7 items appear in either diff. Bucket A empty.

## Bucket B — prod is stale, catch-up migration after baseline

Ship as `0002_catchup_indexes_and_defaults.py` (Phase 3).

| # | Object | DDL needed in prod |
|---|---|---|
| B1 | `report_configs.source_session_id` btree index | `CREATE INDEX ix_report_configs_source_session_id ON report_configs (source_session_id);` |
| B2 | `sherlock_runtime_sessions.scratchpad` default | `ALTER ... SET DEFAULT '<JSON without composed_report key>'::jsonb` — align prod with the deliberate model default. Existing rows are unaffected; only new inserts use the new default. App code already tolerates either shape. |

All expand-only / metadata-only; zero-downtime safe.

## Bucket C — accepted drift

Recorded in `drift_accepted.md`. Summary:

- `pg_trgm` extension (not tracked in `Base.metadata`).
- 7 expression / partial indexes that SQLAlchemy can't model cleanly (4 trigram GIN on `eval_runs`, GIN on `jobs.submission_context`, partial btree on `llm_usage.correlation_id` and `llm_usage.status`).
- 11 constraint name mismatches on single FKs/PKs (eval_runs, report_configs, source_call_records, source_lead_records, source_sync_runs). Same definition, different names — renaming is cosmetic.
- `source_lead_records.prospect_stage` default cast — both DBs now have the column as TEXT, but prod's default literal is `''::character varying` (set when the column was VARCHAR; survived the implicit type widen). Models declare `''::text`. Equivalent value at runtime.

## Bucket D — cleanup migrations after baseline

Ship as `0003_drop_redundant_constraints_and_lsq.py` (Phase 3).

| # | Object | Action |
|---|---|---|
| D1 | `lsq_lead_cache` table | Drop. Removed from models in commit `50baf9f`. |
| D2 | `analytics_charts.fk_analytics_charts_source_session_id` | Drop. Duplicate of `analytics_charts_source_session_id_fkey`. |
| D3 | `analytics_dashboards.fk_analytics_dashboards_source_session_id` | Drop. Duplicate of `analytics_dashboards_source_session_id_fkey`. |

D2/D3: pure dedupe. Both names reference the same column with the same `ON DELETE SET NULL` behaviour; the SQLAlchemy-default `*_fkey` keeps enforcing referential integrity.

## Acceptance state

- [x] `migra prod → models` diff captured.
- [x] `migra models → prod` diff captured.
- [x] Bucket A empty (verified via two re-runs of `migra` after each round of model edits).
- [x] `drift_report.md` written.
- [x] `drift_accepted.md` written.
- [x] `follow_up_migrations.md` written.
- [x] `prod_schema_snapshot.sql` committed.
- [ ] Solo-dev sign-off (you read this and agree).
