# Accepted Drift — 2026-04-27

Items that exist in prod but are intentionally not modelled in `Base.metadata`. Baseline (`0001_baseline_prod`) carries them as-is. The CI gate (Phase 7) must whitelist these so they don't cause "model + migration mismatch" warnings.

## Extensions

- **`pg_trgm`** — required for the trigram GIN indexes below. Created in baseline (`CREATE EXTENSION IF NOT EXISTS pg_trgm`). Not represented in `Base.metadata` because SQLAlchemy declarative doesn't track extensions.

## Functional / expression indexes

SQLAlchemy can express these via `Index(..., postgresql_using='gin', ...)` with `text()` expressions, but the resulting model code is opaque and the autogenerate output is unreliable. We keep these in baseline only.

| Index | Table | Definition |
|---|---|---|
| `idx_eval_runs_search_id_trgm` | `eval_runs` | `gin (id::text gin_trgm_ops)` |
| `idx_eval_runs_search_summary_evaluator_trgm` | `eval_runs` | `gin (COALESCE(summary->>'evaluator_name','') gin_trgm_ops)` |
| `idx_eval_runs_search_config_evaluator_trgm` | `eval_runs` | `gin (COALESCE(config->>'evaluator_name','') gin_trgm_ops)` |
| `idx_eval_runs_search_batch_name_trgm` | `eval_runs` | `gin (COALESCE(batch_metadata->>'name','') gin_trgm_ops)` |
| `idx_jobs_submission_context_gin` | `jobs` | `gin (submission_context jsonb_path_ops)` |
| `idx_llm_usage_correlation_id` | `llm_usage` | `btree (correlation_id) WHERE correlation_id IS NOT NULL` |
| `idx_llm_usage_status_error` | `llm_usage` | `btree (tenant_id, created_at) WHERE status <> 'ok'` |

These indexes are load-bearing: trigram search powers the listings UI; partial indexes on `llm_usage` keep cost/error queries cheap. Do not drop.

## Constraint name mismatches (cosmetic)

These are the same constraints (same columns, same target, same delete behaviour), with different names. Renaming a constraint in prod is a non-trivial operation for zero benefit. Accept the mismatch.

| Table | Prod name | Models name (SQLAlchemy default) |
|---|---|---|
| `eval_runs` | `fk_eval_runs_latest_review_id` | `eval_runs_latest_review_id_fkey` |
| `report_configs` | `fk_report_configs_source_session_id` | `report_configs_source_session_id_fkey` |
| `source_call_records` (PK) | `inside_sales_calls_pkey` | `source_call_records_pkey` |
| `source_lead_records` (PK) | `inside_sales_leads_pkey` | `source_lead_records_pkey` |
| `source_sync_runs` (PK) | `inside_sales_sync_runs_pkey` | `source_sync_runs_pkey` |
| `source_call_records.tenant_id` FK | `inside_sales_calls_tenant_id_fkey` | `source_call_records_tenant_id_fkey` |
| `source_call_records.last_synced_by_user_id` FK | `inside_sales_calls_last_synced_by_user_id_fkey` | `source_call_records_last_synced_by_user_id_fkey` |
| `source_lead_records.tenant_id` FK | `inside_sales_leads_tenant_id_fkey` | `source_lead_records_tenant_id_fkey` |
| `source_lead_records.last_synced_by_user_id` FK | `inside_sales_leads_last_synced_by_user_id_fkey` | `source_lead_records_last_synced_by_user_id_fkey` |
| `source_sync_runs.tenant_id` FK | `inside_sales_sync_runs_tenant_id_fkey` | `source_sync_runs_tenant_id_fkey` |
| `source_sync_runs.requested_by_user_id` FK | `inside_sales_sync_runs_requested_by_user_id_fkey` | `source_sync_runs_requested_by_user_id_fkey` |

Origin: tables were renamed (`inside_sales_*` → `source_*`) in `startup_schema.py` PL/pgSQL block. Postgres preserves constraint names across `ALTER TABLE RENAME`, so the legacy names stuck.

## Default-literal cast quirk

- `source_lead_records.prospect_stage` — both DBs now have the column as `text` (after the bucket-A model fix). Prod's default literal is still `''::character varying` because the original column was VARCHAR when the default was set; the implicit type-widen left the cast tag intact. Models declare `''::text`. Equivalent value at runtime; not worth a migration.

## Not in this list

- The duplicate FKs on `analytics_charts` and `analytics_dashboards` (`fk_analytics_*_source_session_id`) — those are bucket D, not C. They are dropped by `0003`, not accepted.

## What this list is NOT

- It is not a list of bugs.
- It is not a permanent waiver. Any time we touch one of these objects, reconsider whether the drift should still be accepted.
- It is not an excuse to add more drift. New schema goes through Alembic only.
