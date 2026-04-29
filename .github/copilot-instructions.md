# Copilot Instructions

Mirror of `AGENTS.md` for GitHub Copilot. Defer to `AGENTS.md` on any rule precedence conflict.

## Architecture Mental Models

1. Frontend is a thin client. Business logic, LLM calls, and persistence live on the backend.
2. `EvaluationRun` is the central entity. Every evaluation outcome is one row; `eval_type` defines its shape.
3. Long-running work executes as background jobs. Submit a job, poll it, then load the result.
4. Zustand stores are frontend caches. PostgreSQL is the source of truth.
5. Evaluation runners call provider wrappers in `llm_base.py`, never provider SDKs directly.
6. Analytics, reporting, and reviews are separate domains that consume EvalRuns but store their own fact/config/artifact tables.
7. Sherlock is a constrained analytics agent with its own runtime session/turn/event tables; it never mutates eval data.
8. Cost tracking is an observability plane. Every LLM generation call records one `analytics.fact_llm_generation` row; aggregation and pricing resolution happen downstream, never in request handlers.

## Reuse These Abstractions

- LLM calls -> `backend/app/services/evaluators/llm_base.py`
- Async evaluations -> `submitAndPollJob()` from `src/services/api/jobPolling.ts`
- HTTP -> `apiRequest` / `apiUpload` / `apiDownload` from `src/services/api/client.ts`
- Resource APIs -> `src/services/api/*.ts`
- Navigation -> `src/config/routes.ts`
- User feedback -> `notificationService.success/error/info/warning`
- Diagnostics -> `logger` / `evaluationLogger`
- CSS merging -> `cn()` from `src/utils/cn.ts`
- UI primitives -> `src/components/ui/`
- Dropdowns -> `Select` from `src/components/ui/Select.tsx`
- Searchable/multi-select -> `Combobox` from `src/components/ui/Combobox.tsx`
- Pagination -> `Pagination` from `src/components/ui/Pagination.tsx`
- Filter pills -> `FilterPills` from `src/components/ui/FilterPills.tsx`
- Tables -> unified `DataTable` in `src/components/ui/DataTable/`
- Chart hex colors -> `resolveColor()` from `src/utils/statusColors.ts`
- LLM usage recording -> `LoggingLLMWrapper` + `make_usage_callback()` in `backend/app/services/evaluators/runner_utils.py`

## Current Registry

- Route groups (26): auth, listings, files, evaluators, chat, chat_engine, history, settings, tags, jobs, evaluation_runs (+ threads), llm, adversarial_config, adversarial_test_cases, admin, reports, report_builder (+ v2), inside_sales, apps, roles, rules, eval_templates, reviews, analytics_library, cost (+ cost admin)
- ORM tables (62): platform.tenants, platform.tenant_configurations, platform.users, platform.identity_refresh_tokens, platform.identity_invite_links, platform.applications, platform.access_roles, platform.access_role_application_grants, platform.access_role_permissions, platform.audit_event_logs, platform.evaluation_datasets, platform.application_uploaded_files, platform.library_prompt_definitions, platform.library_output_schema_definitions, platform.evaluators, platform.chat_sessions, platform.chat_messages, platform.application_event_history, platform.application_settings, platform.library_adversarial_test_cases, platform.application_tags, platform.background_jobs, platform.evaluation_runs, platform.evaluation_run_thread_results, platform.evaluation_run_adversarial_results, platform.evaluation_run_api_call_logs, platform.evaluation_reviews, platform.evaluation_review_items, platform.report_configurations, platform.report_generation_runs, platform.report_generated_artifacts, analytics.crm_call_record, analytics.crm_lead_record, analytics.log_crm_source_sync, platform.application_external_agent_connectors, platform.evaluation_templates, analytics.agg_evaluation_run, analytics.fact_evaluation, analytics.fact_evaluation_criterion, analytics.log_fact_population_run, analytics.log_sherlock_tool_call, analytics.cache_sql_query, platform.analytics_charts, platform.analytics_dashboards, platform.sherlock_agent_sessions, platform.sherlock_conversation_turns, platform.sherlock_turn_events, platform.sherlock_ontology_classes, platform.sherlock_ontology_entity_types, platform.sherlock_entity_resolvers, analytics.fact_llm_generation, analytics.ref_llm_model_pricing, analytics.ref_llm_model_alias, analytics.agg_llm_usage_daily, analytics.ref_llm_models_catalog, analytics.snapshot_llm_models_catalog, platform.scheduled_job_definitions, platform.scheduler_worker_heartbeats, analytics.dim_lead, analytics.fact_lead_stage_transition, analytics.fact_lead_activity, analytics.fact_lead_signal. Plus `public.alembic_version` (Alembic-owned, not in `Base.metadata`).

- Zustand stores (17): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, evaluatorsStore, evalTemplatesStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore, reviewModeStore, costStore
- LLM providers: Gemini, OpenAI, Azure OpenAI, Anthropic
- Job types (12): evaluate-voice-rx, evaluate-batch, evaluate-adversarial, evaluate-custom, evaluate-custom-batch, evaluate-inside-sales, generate-report, generate-evaluator-draft, generate-cross-run-report, sync-external-source, populate-analytics, populate-cost-rollup
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`

## Frontend Rules

- TypeScript strict; avoid `any`.
- Use single quotes and semicolons, matching local file style.
- Use `@/` imports for internal modules and `import type` for type-only imports.
- Keep new files on named exports unless the local pattern requires default exports.
- In components, select Zustand slices instead of reading whole stores.
- In async callbacks, use `useStore.getState()`.
- Parse dates at API boundaries, not inline in components.
- No Tailwind class concatenation with template literals. Always use `cn()` for conditional classes.

## Design System Rules

- All colors MUST use CSS variables from `src/styles/globals.css`. No hex literals in `.tsx` files.
- The only files allowed to contain hex color values are `src/styles/globals.css`, `src/utils/statusColors.ts`, and `src/features/guide/styles/guide.css`.
- Z-index MUST use tokens: `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-popover(150)`, `--z-modal(200)`, `--z-tooltip(300)`, `--z-max(999)`.
- Use `<Select>` for simple dropdowns, `<Combobox>` for searchable/multi-select. No native HTML `<select>`.
- Use `<Pagination>` for all paginated lists. No copy-pasting Previous/Next button blocks.
- Use `<FilterPills>` for filter toggle pill groups.
- Use the unified `<DataTable>` for list surfaces; do not hand-roll table markup.
- For chart/canvas libraries (Recharts, D3) that need hex values, use `resolveColor()` from `src/utils/statusColors.ts` or the `useResolvedColor` hook.
- Justified exceptions: D3 visualization configs, Mermaid template strings in guide pages, `report-print.css`.
- HTTP method colors use `--color-http-get/post/put/patch/delete` tokens.
- Gap type colors use `--color-gap-underspec/silent/leakage/conflicting` tokens.

## Backend Rules

- Python internals use `snake_case`; API JSON uses camelCase through `CamelModel` and `CamelORMModel`.
- Route handlers use async sessions with `Depends(get_db)`.
- Protected routes use `auth: AuthContext = Depends(get_auth_context)` or `require_permission(...)`.
- Never use `db.get()` for tenant-owned user data; use filtered `select()` queries.
- Job submission injects `tenant_id` and `user_id`; runners read them from params.
- Update model, schema, `seed_defaults.py`, and affected routes together when changing persisted data.
- Use stable `HTTPException.detail` strings for client-facing errors.
- Analytics queries may use a separate `ANALYTICS_DATABASE_URL`; default is to fall back to `DATABASE_URL`.

## Common Pitfalls

- Most backend list/get endpoints require `app_id`.
- `settings` uses `app_id=""` for global LLM settings, not `null`.
- `listing.source_type` matters; do not mix upload and API-flow assumptions.
- Report generation has two surfaces: legacy `reports` and the v2 `report_builder` / `report_builder_v2` pipeline backed by `report_configurations` / `report_generation_runs` / `report_generated_artifacts`.
- Sherlock sessions are per-user per-app; always filter `sherlock_agent_sessions` / `sherlock_conversation_turns` / `sherlock_turn_events` by tenant/user/app.
- Cost tracking lives under `/api/cost` (tenant/user views) and a cost-admin sub-router under `/api/admin`. `analytics.fact_llm_generation` rows are written by `LoggingLLMWrapper`; rollups rebuild via `populate-cost-rollup` jobs.
- Do not reintroduce `kaira-evals` as an app ID anywhere in the frontend or backend.
- **Schema lives in Alembic, not in `startup_schema.py`.** That file no longer exists. Migrations are at `backend/alembic/versions/` and run via `alembic upgrade head` in `backend/entrypoint.sh` on every container boot. Any schema change ships as a new revision file (model edit + matching migration in the same commit). Manifest-driven `COMMENT ON COLUMN` rows are synced separately by `backend/scripts/sync_column_comments.py` from the FastAPI lifespan; Alembic does not own them.

## Post-Roadmap-01 Schema Rules

- **Raw SQL must schema-qualify renamed tables.** DB default `search_path = "$user", public`; the `platform, public, analytics` change planned in migration 0007 was deferred to out-of-band infra in commit 92780a0. Inside `text("...")`, `op.execute("...")`, or any hand-written SQL, always write `platform.evaluators`, `analytics.fact_evaluation`, `analytics.ref_llm_model_pricing`, etc. ORM queries are safe (`__table_args__ = {"schema": ...}`). The 2026-04-29 prod CrashLoopBackoff was a missed schema qualifier in `evaluator_seed_catalog.py`.
- **Seed data files in `backend/app/seeds/data/` follow `<schema>.<table>.json` naming** (e.g. `analytics.ref_llm_model_pricing.json`). Rename the file when renaming the table; loaders look up by the new name and silently skip if missing.
- **Worker topology depends on the deploy target.** Local docker-compose uses `JOB_RUN_EMBEDDED_WORKER=false` with a dedicated worker container. Prod is a single Container App and runs with `JOB_RUN_EMBEDDED_WORKER=true` — backend owns the worker loop in-process.

## Backend Lifespan Boot Order

`backend/app/main.py` lifespan in order. A crash anywhere = backend exits before serving. Bisect from the last successful console log line.

1. `configure_logging`, `_validate_startup_config` (env-var checks)
2. `import app.services.job_worker` (registers handlers; `ImportError` = boot crash)
3. `engine.begin` → alembic_head SELECT + `sync_column_comments`
4. `run_manifest_validator`
5. `seed_all_defaults` (apps, system tenant/user, adversarial defaults, report prompts/configs, eval templates, sherlock ontology, model pricing, cost rollup schedule, evaluator catalog — last step creates `uq_evaluators_seed_scope`)
6. `seed_bootstrap_admin`
7. `validate_all_app_pack_ids`
8. `_cleanup_expired_refresh_tokens`
9. `recover_stale_jobs` / `recover_stale_eval_runs` / `recover_stale_source_sync_runs` (embedded worker)
10. `worker_loop` / `recovery_loop` / `scheduler_tick_loop` started

## Debugging Prod Without Azure Portal Access

Used 2026-04-29 to recover backend from CrashLoopBackoff with no portal/CLI.

**Recognize:** frontend 504, backend FQDN 503 then timeout, `pg_stat_activity` shows no backend sessions, system events spam `ProcessExited exit code 3`.

**Reuse the deploy SP via Actions (read-only):** add a `workflow_dispatch`-only diagnostic workflow that uses `azure/login@v2` with the existing `secrets.AIEVALSBEPROD_AZURE_*` secrets, and runs `az containerapp show / revision list / revision show / replica list / logs show --type system / logs show --type console`. Delete the workflow when done.

**OIDC subject binding:** SP federated cred is bound to `refs/heads/prod`. Workflow MUST live on `prod` branch and be triggered with `--ref prod`. Pushing to `prod` redeploys backend (`paths: '**'`); same image, accept the cost.

**Never print the env block.** Container App vars stored as `value:` come back plaintext. Use system+console logs only.

**Local lifespan probe:** open a session against the prod DSN, set `default_transaction_read_only = on`, walk each lifespan step. Postgres rejects writes specifically; pre-write failures are real bugs.
