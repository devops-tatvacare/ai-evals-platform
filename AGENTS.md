# AGENTS.md

Operational guide for coding agents working in this repository. Prefer existing abstractions and patterns.

## Rule Precedence

1. Direct user instruction
2. This file
3. `.github/copilot-instructions.md`
4. Existing code patterns in touched files

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

- Route groups (27): auth, listings, files, evaluators, chat, chat_engine, history, settings, tags, jobs, evaluation_runs (+ threads), llm, adversarial_config, adversarial_test_cases, admin, reports, report_builder (+ v2), inside_sales, apps, roles, rules, eval_templates, reviews, analytics_library, cost (+ cost admin), scheduled_jobs
- ORM tables (62): platform.tenants, platform.tenant_configurations, platform.users, platform.identity_refresh_tokens, platform.identity_invite_links, platform.applications, platform.access_roles, platform.access_role_application_grants, platform.access_role_permissions, platform.audit_event_logs, platform.evaluation_datasets, platform.application_uploaded_files, platform.library_prompt_definitions, platform.library_output_schema_definitions, platform.evaluators, platform.chat_sessions, platform.chat_messages, platform.application_event_history, platform.application_settings, platform.library_adversarial_test_cases, platform.application_tags, platform.background_jobs, platform.evaluation_runs, platform.evaluation_run_thread_results, platform.evaluation_run_adversarial_results, platform.evaluation_run_api_call_logs, platform.evaluation_reviews, platform.evaluation_review_items, platform.report_configurations, platform.report_generation_runs, platform.report_generated_artifacts, analytics.crm_call_record, analytics.crm_lead_record, analytics.log_crm_source_sync, platform.application_external_agent_connectors, platform.evaluation_templates, analytics.agg_evaluation_run, analytics.fact_evaluation, analytics.fact_evaluation_criterion, analytics.log_fact_population_run, analytics.log_sherlock_tool_call, analytics.cache_sql_query, platform.analytics_charts, platform.analytics_dashboards, platform.sherlock_agent_sessions, platform.sherlock_conversation_turns, platform.sherlock_turn_events, platform.sherlock_ontology_classes, platform.sherlock_ontology_entity_types, platform.sherlock_entity_resolvers, analytics.fact_llm_generation, analytics.ref_llm_model_pricing, analytics.ref_llm_model_alias, analytics.agg_llm_usage_daily, analytics.ref_llm_models_catalog, analytics.snapshot_llm_models_catalog, platform.scheduled_job_definitions, platform.scheduler_worker_heartbeats, analytics.dim_lead, analytics.fact_lead_stage_transition, analytics.fact_lead_activity, analytics.fact_lead_signal. Plus `public.alembic_version` (Alembic-owned, not in `Base.metadata`).

- Zustand stores (17): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, evaluatorsStore, evalTemplatesStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore, reviewModeStore, costStore
- LLM providers: Gemini, OpenAI, Azure OpenAI, Anthropic
- Job types (12): evaluate-voice-rx, evaluate-batch, evaluate-adversarial, evaluate-custom, evaluate-custom-batch, evaluate-inside-sales, generate-report, generate-evaluator-draft, generate-cross-run-report, sync-external-source, populate-analytics, populate-cost-rollup
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`

## Invariants

- Preserve `EvaluationRun` polymorphism and the cascade chain from listings/chat_sessions to evaluation_runs to dependent detail rows.
- Voice Rx always runs transcription first with audio, then critique second with text only.
- Compute Voice Rx statistics server-side from stored records, not model self-reports.
- Every user-owned query must be tenant-scoped and auth-scoped.
- `/api/auth/*` routes are the only public routes. All other routes require bearer auth.
- LLM settings are global per tenant and user at `app_id=""`; do not pass an app ID for LLM settings lookup.
- System library data belongs to `SYSTEM_TENANT_ID` and `SYSTEM_USER_ID`.
- Gemini on Vertex AI uses `Part.from_bytes()` for media. To disable thinking, omit `thinking_config`. Use `thinking_budget` only for 2.5 models and `thinking_level` only for 3+ models.
- **Worker topology depends on the deploy target.** Local docker-compose runs a dedicated worker container with `JOB_RUN_EMBEDDED_WORKER=false`. Production today is a single Azure Container App (`ai-evals-be-prod`) deployed by `.github/workflows/ai-evals-be-prod-*.yml`; there is no separate worker deploy workflow, so unless the prod env var is overridden, the backend container runs with the default `JOB_RUN_EMBEDDED_WORKER=True` and owns the worker loop in-process.
- Analytics fact tables (`analytics_*_facts`) are populated by `populate-analytics` jobs from stored runs; never write to them from request handlers.
- `analytics.fact_llm_generation` rows are written by the `LoggingLLMWrapper` during every generation call; `analytics.agg_llm_usage_daily` is rebuilt by `populate-cost-rollup` jobs. Request handlers never write either table directly, and pricing resolution goes through `pricing_cache`.
- Sherlock runtime rows (`sherlock_agent_sessions` / `sherlock_conversation_turns` / `sherlock_turn_events`) are the only persistence for agent traces; chart binding goes through `analytics_charts`.
- Do not reintroduce `kaira-evals` as an app ID anywhere in the frontend or backend.
- Do not create subdirectory agent rule files. This file is the repo-wide source of truth.
- **Schema lives in Alembic, not in `startup_schema.py`.** That file no longer exists. Migrations are at `backend/alembic/versions/` and run via `alembic upgrade head` in `backend/entrypoint.sh` on every container boot. The baseline (`0001_baseline_prod`) captures prod schema as of 2026-04-27 and is stamped on prod, applied end-to-end on fresh dev/CI databases. Any schema change ships as a new revision file (model edit + matching migration in the same commit). Manifest-driven `COMMENT ON COLUMN` rows are synced separately by `backend/scripts/sync_column_comments.py` from the FastAPI lifespan; Alembic does not own them.
- Sherlock manifest columns carry a 3-axis taxonomy: `role` (dimension / measure / temporal / ordered_categorical / key / identifier), `data_type` (Vega-Lite: quantitative / temporal / ordinal / nominal / boolean / geo), and `semantic_type` (Metabase-style: pk / fk / category / id_hash / currency / percent / lat / lon / count / ratio / score / duration / none). The boot validator (`manifest_validator.validate_manifest_taxonomy`) warns when a measure is missing `semantic_type` and raises on role/data_type contradictions.
- Sherlock chart payloads are discriminated-union objects (`kind: 'chart' | 'kpi' | 'summary' | 'table' | 'empty'`) produced by `backend/app/services/report_builder/chat_handler._build_chart_payload`. The backend owns the decision: (1) `result_set_typer.type_result_set` builds a `TypedResultSet` from SQL rows + declared `output_columns` + manifest; (2) `chartability_gate.evaluate` returns an enumerated `reason_code` (`CG_EMPTY`/`CG_SINGLE_VALUE`/`CG_FIELD_CARD`/`CG_NO_MEASURE`/`CG_DEGENERATE_MEASURE`/`CG_ALL_IDS`/`CG_HIGH_CARD`); (3) `chart_type_picker.pick` returns one of 7 Vega-Lite marks (`bar`/`grouped_bar`/`stacked_bar`/`line`/`multi_line`/`area`/`pie`); (4) `vega_lite_emitter.emit` builds a Vega-Lite v5 spec validated against `vega-lite-schema-v5.json` before leaving the backend. The gate + picker are pure functions — no LLM, no I/O. The frontend branches on `payload.kind` and translates chart specs via `src/features/analytics/vegaLiteToRecharts.ts`; it never infers chart type, roles, or shapes.
- `sql_agent.generate_sql` returns `{sql, chart_title, output_columns}` only. It does **not** return `chart_type`, `x_key`, `y_keys`, or `alternatives` — those were superseded by the deterministic picker. The call goes through the OpenAI Responses API via `_call_llm_for_sql` with a strict JSON schema (`SQL_GENERATION_RESPONSE_SCHEMA`) and records a `sherlock_turn`-owned `analytics.fact_llm_generation` row so `done.usage` aggregates correctly.
- **Raw SQL must schema-qualify every renamed table.** DB default `search_path = "$user", public`; the `platform, public, analytics` change planned in migration 0007 was deferred to out-of-band infra in commit 92780a0. Inside `text("...")`, `op.execute("...")`, or any hand-written SQL, always write `platform.evaluators`, `analytics.fact_evaluation`, `analytics.ref_llm_model_pricing`, etc. — never bare names. ORM queries are safe because `__table_args__ = {"schema": ...}` already propagates. Bug that crashed prod on 2026-04-29: `CREATE INDEX ... ON evaluators (...)` in `evaluator_seed_catalog.py` resolved against `public.evaluators` (gone after roadmap-01) and raised `UndefinedTableError` inside `seed_all_defaults`, putting the backend in CrashLoopBackoff with exit code 3.
- **Seed data files in `backend/app/seeds/data/` follow `<schema>.<table>.json` naming.** Example: `analytics.ref_llm_model_pricing.json` (not `model_pricing.json`). When renaming a table, rename the matching seed file in the same commit; loaders such as `bootstrap_seed.py` look up the file by the new name and silently skip if missing.
- **Container App env vars stored as `value:` are returned in plaintext by `az containerapp show`.** Only `secretRef:`-bound values are redacted by Azure. Never run a CI workflow that prints the env block. Migrate sensitive vars to `secretRef:` against `az containerapp secret set`.

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
- Cost tracking lives under `/api/cost` (tenant/user views) and a cost-admin sub-router under `/api/admin` (pricing edits and refresh). Read-through pricing and model-alias resolution belong to the `cost_tracking` service; do not hand-roll provider/model normalization in routes.

## Backend Lifespan Boot Order

`backend/app/main.py` lifespan executes these steps in order; a crash anywhere here means the backend exits before serving traffic. Bisect by the last successful log line in container console logs.

1. `configure_logging`
2. `_validate_startup_config` — env-var checks; raises `RuntimeError` if `JWT_SECRET` missing or job-timing values inconsistent
3. `import app.services.job_worker` — registers all job handlers eagerly; `ImportError` here = boot crash before any DB connection
4. `engine.begin` → alembic_head SELECT + `sync_column_comments` (applies manifest-driven `COMMENT ON COLUMN`)
5. `run_manifest_validator`
6. `seed_all_defaults` — apps, system tenant/user, adversarial defaults, report prompts, report configs, eval templates, sherlock ontology, model pricing, cost rollup schedule, evaluator catalog reconciliation (creates `uq_evaluators_seed_scope` on `platform.evaluators`)
7. `seed_bootstrap_admin`
8. `validate_all_app_pack_ids`
9. `_cleanup_expired_refresh_tokens`
10. `recover_stale_jobs` / `recover_stale_eval_runs` / `recover_stale_source_sync_runs` (only when `JOB_RUN_EMBEDDED_WORKER=true`, prod default)
11. `worker_loop` / `recovery_loop` / `scheduler_tick_loop` started

## Debugging Prod When You Have No Azure Portal Access

Pattern proven on the 2026-04-29 outage. Entire diagnosis ran through GitHub Actions plus a read-only DSN; no portal access required.

**Symptoms:**
- Frontend 504; backend FQDN returns 503 then 30s timeouts.
- `pg_stat_activity` shows no backend DB sessions → container is exiting before opening a DB connection (or in a fast crash loop).
- Container Apps system events show repeated `ProcessExited exit code 3`.

**Reuse the deploy SP via GitHub Actions (read-only):**
- The deploy workflow authenticates via OIDC using `secrets.AIEVALSBEPROD_AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`. Same SP can run any read-only `az containerapp` command.
- Add a temporary `workflow_dispatch` workflow (DELETE IT after) that runs `az containerapp show / revision list / revision show / replica list / logs show --type system / logs show --type console`. Output appears in the Actions log.

**OIDC subject binding gotcha:**
- The SP's federated credential matches subject `repo:<owner>/<repo>:ref:refs/heads/prod` only. The diagnostic workflow file MUST exist on the `prod` branch and be triggered with `gh workflow run ... --ref prod`. Triggering from `main` or with `environment: <name>` fails with `AADSTS700213`.
- Pushing the workflow to `prod` triggers the deploy filter (`paths: '**'`) and rebuilds backend. Acceptable for one-time diagnosis; the rebuild produces the same image.

**Never print env vars in CI logs.** Container App env stored as `value:` is returned plaintext by `az containerapp show`. Skip env-dump steps; rely on system+console logs for diagnosis.

**Local read-only lifespan diagnostic:**
- Get the prod DSN, open a session, set `default_transaction_read_only = on`, then call each lifespan step. Postgres rejects writes with `cannot execute INSERT/UPDATE/DELETE/COMMENT in a read-only transaction`. Pre-write failures (`UndefinedTableError`, missing column, ImportError) are real bugs you can fix without container access.

**Common boot-failure root causes:**
- `UndefinedTableError: relation "X" does not exist` → unqualified raw SQL referencing a renamed table (see schema-qualifier invariant).
- Permission denied on `COMMENT`/DDL → connecting role isn't owner; verify with `pg_class.relowner`.
- `RuntimeError: <ENV> environment variable is required` → `_validate_startup_config` failure; revision env is missing a required key.
- `ImportError` from `app.services.job_worker` → some handler imports a model that references a removed table/column.

## Build, Run, Lint

```bash
docker compose up --build
docker compose down
docker compose logs -f backend worker

npm run build
npm run lint
npx tsc -b

pyenv activate venv-python-ai-evals-arize
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
PYTHONPATH=backend python -m app.worker
```

## References

- Product overview: `docs/PROJECT 101.md`
- Setup and env vars: `docs/SETUP.md`
- DevOps handover: `docs/devops-handover.md`
- Claude-specific guide: `CLAUDE.md`
- Copilot mirror: `.github/copilot-instructions.md`
