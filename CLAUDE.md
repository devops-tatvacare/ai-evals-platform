# CLAUDE.md

Operational guide for Claude working in this repository. Prefer existing abstractions and patterns.
At session start, read `~/.claude` project memory for context from prior conversations.

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
- Server-data fetching/caching -> `useQuery` / `useMutation` from `@tanstack/react-query`. Wire every hook through `apiQueryFn` from `src/features/orchestration/queries/queryFn.ts` so `apiRequest`'s 401-refresh-and-retry flow stays in effect. Phase 14 ships this for orchestration ref-data only; the platform-wide rollout is Phase 15. Tests for new hooks live next to the feature, not the QueryClient.
- Sidebar primary-action menu items -> `apps.config.quickActions: PageActionSpec[]` resolved by `QUICK_ACTION_REGISTRY` in `src/features/quickActions/registry.ts`. Sidebar consumes via `<QuickActionsProvider>` render-prop — never branch on `appId` in `Sidebar.tsx` to add/remove menu items. Adding a new menu item = register one kind in the registry + emit the spec from the app config (DB seed today, per-tenant overlay later). Companion plan: `docs/plans/2026-05-15-tenant-account-setup-system/`.
- Runtime contract validation -> Zod 4 schemas (`zod@^4`). Hand-written schemas live in `src/features/orchestration/contracts/nodeConfig.ts` today; every schema carries `// TODO: replace with codegen from Pydantic in Phase 16`. Use `parseNodeConfig(nodeType, raw)` at every state-entry boundary — never re-implement the discriminator inline.
- Structured API error decoding -> `decodeApiError` / `decodeApiErrorBody` / `summarizeApiErrorBody` from `src/features/orchestration/contracts/errorDecoder.ts`. Never call `String(detail)` on a backend error body — it collapses arrays to `[object Object],[object Object]`. The decoder returns a discriminated union (`fieldErrors | message | unknown`); `<PublishErrorPanel>` renders all three.
- Platform `/logs` surface (Phase 15.1) — single page, four tabs, URL-driven via `?type=`. Tab keys → tab files: `evaluation-runs` → `EvaluationRunsTab`; `workflow-runs` → `WorkflowRunsTab`; `workflow-actions` → `WorkflowActionsTab`; `sherlock` → `SherlockTab`. Drill-down is **always a routed sub-page**, never an overlay: `/<app>/logs/runs/:runId`, `/<app>/logs/workflow-runs/:runId`, `/<app>/logs/workflow-actions/:actionId?run=<runId>`, `/<app>/logs/sherlock/:toolCallId`. Sub-pages mount inside `<PageSurface back={{ to: '/<app>/logs?type=...' }}>`. Tabs use `mountStrategy="active-only"` so inactive tabs tear down their TQ subscriptions. Slide-overs (`ActionDetailPanel`, `RunInspectorOverlay`) live on the **builder** page only — Logs shares their bodies (`ActionDetailContent`, `RunRecipientsPanel`, `RunActionsPanel`) but never the wrappers. Legacy `/logs?run_id=<id>` redirects to `/<app>/logs/runs/<id>`. Backend endpoints: `GET /api/orchestration/runs` (cross-workflow), `GET /api/orchestration/actions` (cross-run, app-gated), `GET /api/sherlock/tool-calls` (tenant + user scoped, with `/{id}` detail and `/distinct-tool-names`).

## Current Registry

- Route groups (31): auth, listings, files, evaluators, chat, chat_engine, history, settings, tags, jobs, evaluation_runs (+ threads), llm, adversarial_config, adversarial_test_cases, admin, reports, report_builder (+ v2), inside_sales, apps, roles, rules, eval_templates, reviews, analytics_library, cost (+ cost admin), scheduled_jobs, orchestration_webhooks (public), orchestration, orchestration_connections, orchestration_datasets
- ORM tables (77): platform.tenants, platform.tenant_configurations, platform.users, platform.identity_refresh_tokens, platform.identity_invite_links, platform.applications, platform.access_roles, platform.access_role_application_grants, platform.access_role_permissions, platform.audit_event_logs, platform.evaluation_datasets, platform.application_uploaded_files, platform.library_prompt_definitions, platform.library_output_schema_definitions, platform.evaluators, platform.chat_sessions, platform.chat_messages, platform.application_event_history, platform.application_settings, platform.library_adversarial_test_cases, platform.application_tags, platform.background_jobs, platform.evaluation_runs, platform.evaluation_run_thread_results, platform.evaluation_run_adversarial_results, platform.evaluation_run_api_call_logs, platform.evaluation_reviews, platform.evaluation_review_items, platform.report_configurations, platform.report_generation_runs, platform.report_generated_artifacts, analytics.crm_call_record, analytics.crm_lead_record, analytics.log_crm_source_sync, platform.application_external_agent_connectors, platform.evaluation_templates, analytics.agg_evaluation_run, analytics.fact_evaluation, analytics.fact_evaluation_criterion, analytics.log_fact_population_run, analytics.log_sherlock_tool_call, analytics.cache_sql_query, platform.analytics_charts, platform.analytics_dashboards, platform.sherlock_agent_sessions, platform.sherlock_conversation_turns, platform.sherlock_turn_events, platform.sherlock_ontology_classes, platform.sherlock_ontology_entity_types, platform.sherlock_entity_resolvers, analytics.fact_llm_generation, analytics.ref_llm_model_pricing, analytics.ref_llm_model_alias, analytics.agg_llm_usage_daily, analytics.ref_llm_models_catalog, analytics.snapshot_llm_models_catalog, platform.scheduled_job_definitions, platform.scheduler_worker_heartbeats, analytics.dim_lead, analytics.fact_lead_stage_transition, analytics.fact_lead_activity, analytics.fact_lead_signal, analytics.log_clinical_action_outbox, orchestration.workflows, orchestration.workflow_versions, orchestration.workflow_triggers, orchestration.workflow_action_templates, orchestration.workflow_consent_records, orchestration.workflow_runs, orchestration.workflow_run_node_steps, orchestration.workflow_run_recipient_states, orchestration.workflow_run_recipient_actions, orchestration.workflow_run_recipient_overrides, orchestration.provider_connections, orchestration.cohort_datasets, orchestration.cohort_dataset_versions, orchestration.cohort_dataset_rows. Plus `public.alembic_version` (Alembic-owned, not in `Base.metadata`).
- Postgres schemas (3): `platform`, `analytics`, `orchestration`. The `orchestration` schema (added 2026-04-30 via Alembic 0019) hosts the workflow builder engine; cross-schema FKs reference `platform.tenants/users/applications/background_jobs/scheduled_job_definitions`. Per design spec docs/plans/orchestration/design-spec.md.

- Zustand stores (18): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, evaluatorsStore, evalTemplatesStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore, reviewModeStore, costStore, workflowBuilderStore
- LLM providers: Gemini, OpenAI, Azure OpenAI, Anthropic
- Job types (17): evaluate-voice-rx, evaluate-batch, evaluate-adversarial, evaluate-custom, evaluate-custom-batch, evaluate-inside-sales, generate-report, generate-evaluator-draft, generate-cross-run-report, sync-external-source, populate-analytics, populate-cost-rollup, backfill-facts-from-mirror (Phase 4 — mirror→fact projection backfill), backfill-lead-signals (Phase 5 — LLM extraction from CRM lead mirror → fact_lead_signal), backfill-stage-transitions (Phase 6 — CRM lead mirror → fact_lead_stage_transition seed rows; no LLM), run-workflow (orchestration engine — Phase 1), resume-waiting-cohorts (orchestration resume poller — Phase 4, schedulable platform_managed, runs every minute)
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`
- Seeded orchestration workflows: `mql-concierge-default` (crm, app=`inside-sales` — replaces the old AI Concierge spec; tenants clone via `POST /api/orchestration/workflows/clone`); `dm2-adherence-watch` (clinical, app=`inside-sales` — outbox-backed clinical pathway demo, no live EMR consumer in v1).
- Orchestration node registry: 20 handlers — 10 shared (source/filter/logic/sink/core), 5 crm (`crm.send_wati`, `crm.place_bolna_call`, `crm.send_sms`, `crm.lsq_update_stage`, `crm.lsq_log_activity`), 5 clinical (`clinical.schedule_lab`, `clinical.assign_care_team_task`, `clinical.send_pro_assessment`, `clinical.emr_write`, `clinical.escalation_uptier`).

## Invariants

- **Generic naming, app behaviour from config — MUST FOLLOW INDEFINITELY.** Going forward, no new file, folder, module, class, function, variable, route, table, column, job type, or string constant may be named after a specific app or tenant (`inside_sales_*`, `voice_rx_*`, `kaira_*`, `tatva_*`, `INSIDE_SALES_APP_ID`, `evaluate-inside-sales`, etc.). New code is named for the **capability** (`call_quality_runner`, `audio_transcribe_evaluate_worker`, `evaluation_selection_spec`, `dataset_binding_registry`); per-app behaviour comes from app config (DB-seeded `App.config` and the `apps` registry the run-detail / quick-actions / Sherlock manifest paths already use). The current platform is heavily contaminated with app-named code (`inside_sales_runner.py`, `voice_rx_*` tables, `kaira_*` historical references, hardcoded `app_id='…'` literals); existing names stay until each app's structural rewrite, but **net-new code MUST NOT extend the contamination**. PR review explicitly rejects new app-named symbols. Reason: silent shape-drift bugs (the 2026-05-15 inside-sales `min_duration` incident) compound when a single app's runner / mapper / selector each carry the app name and the contract between them goes unchecked. Companion plan: `docs/plans/2026-05-15-eval-runner-config-driven/README.md` (worked example for inside-sales).
- Preserve `EvaluationRun` polymorphism and the cascade chain from listings/chat_sessions to evaluation_runs to dependent detail rows.
- Voice Rx always runs transcription first with audio, then critique second with text only.
- Compute Voice Rx statistics server-side from stored records, not model self-reports.
- Every user-owned query must be tenant-scoped and auth-scoped.
- `/api/auth/*` routes are the only public routes. All other routes require bearer auth.
- LLM settings are global per tenant and user at `app_id=""`; do not pass an app ID for LLM settings lookup.
- System library data belongs to `SYSTEM_TENANT_ID` and `SYSTEM_USER_ID`.
- Gemini on Vertex AI uses `Part.from_bytes()` for media. To disable thinking, omit `thinking_config`. Use `thinking_budget` only for 2.5 models and `thinking_level` only for 3+ models.
- **Worker topology depends on the deploy target.** Local docker-compose runs a dedicated worker container with `JOB_RUN_EMBEDDED_WORKER=false`. Production today is a single Azure Container App (`ai-evals-be-prod`) deployed by `.github/workflows/ai-evals-be-prod-*.yml`; there is no separate worker deploy workflow, so unless the prod env var is overridden, the backend container runs with the default `JOB_RUN_EMBEDDED_WORKER=True` and owns the worker loop in-process. Any plan or doc claiming prod has a dedicated worker container is stale until a worker deploy pipeline is added.
- Analytics fact tables (`analytics_*_facts`) are populated by `populate-analytics` jobs from stored runs; never write to them from request handlers.
- `analytics.fact_llm_generation` rows are written by the `LoggingLLMWrapper` during every generation call; `analytics.agg_llm_usage_daily` is rebuilt by `populate-cost-rollup` jobs. Request handlers never write either table directly, and pricing resolution goes through `pricing_cache`.
- Sherlock runtime rows (`sherlock_agent_sessions` / `sherlock_conversation_turns` / `sherlock_turn_events`) are the only persistence for agent traces; chart binding goes through `analytics_charts`.
- Do not reintroduce `kaira-evals` as an app ID anywhere in the frontend or backend.
- Provider connections are tenant + app-owned, credential-encrypted (Fernet via `ORCHESTRATION_CONNECTION_KEY`), and referenced from node configs by `connection_id` UUID — never by env var. GET responses on `/api/orchestration/connections*` strip plaintext secret values; PATCH preserves omitted secret keys (blank submissions never overwrite stored credentials). Webhooks resolve by per-connection `webhook_token`; cloning a credential-backed system workflow strips foreign `connection_id`s and the clone lands as a draft when rebinding is required.
- **Every dispatch action MUST write `payload.contact` and `provider_correlation_id`** (migrations 0027/0028). `payload.contact` is the channel-agnostic recipient handle (Bolna `recipient_phone`, WATI `whatsapp_number`, SMS `phone`, LSQ / clinical `recipient_id`). `provider_correlation_id` is the channel-agnostic upstream id stamped at dispatch time (Bolna single → `execution_id`, Bolna batch → `batch_id`, WATI → `localMessageId`, LSQ activity → `ProspectActivityId`, LSQ stage → `recipient_id`, clinical → outbox row id). Reporting reads one column instead of `COALESCE`'ing across channel-specific JSONB keys. The shared reconciler (`_reconciler.apply_terminal_event`) propagates both into child outcome rows so `action_type='bolna_answered'` rows stay joinable to the upstream call. New dispatch nodes that ship without these fields will silently break cross-channel queries.
- **Provider caller-id (`from_phone`) follows a three-tier fallback**: per-call override on the dispatch node (e.g. `crm.place_bolna_call.from_phone`) > connection-saved `from_phone` (passed through `BolnaService.default_from_phone`) > Bolna's per-agent default. Empty string at any tier delegates to the next. The connection resolver MUST pass `config.get('from_phone')` to integration constructors; without it an empty per-call override silently drops to the agent default and calls dial without caller-id.
- **All orchestration node `_Config(BaseModel)` classes use `extra='forbid'` unconditionally.** Strictness is sourced from `app.services.orchestration._config_strictness.strict_node_config_dict()` which always returns `ConfigDict(extra='forbid')` — no env flag, no rollback hatch. The previous `ORCHESTRATION_BUILDER_V2` gate was removed because silent drops of unknown keys were the bug class that let the authoring agent fabricate fields like `prospect_ids` and `condition` without anyone noticing. Adding a field to a published-workflow contract is a breaking change — declare it on the Pydantic model AND mirror it in the matching Zod schema in `src/features/orchestration/contracts/nodeConfig.ts` in the same commit. After Phase 16 the Zod side becomes generated and only Pydantic moves. Run `python -m app.services.orchestration.contract_audit --output /tmp/audit.csv --only-published` against prod-like data when you suspect a stored definition carries fabricated fields; non-zero rows are now hard publish errors.
- **Orchestration builder lifecycle is derived, not toggled** (Phase 14 / Phase B). The store keeps `committedDataHash`, `currentDataHash`, `committedLayoutHash`, `currentLayoutHash`, `inFlight`, `lastSaveOutcome`, `lastPublishOutcome`. Header pill / save / publish button state read `useLifecycleState()` (one discriminated union: `clean-draft | dirty-draft | clean-published | dirty-published-edits | saving | save-failed | publishing | publish-failed`). Layout-only changes (`updateNodePosition`) recompute the layout hash but never the data hash, so dragging a node never flips the pill to "Published · unsaved edits". Do not reintroduce a boolean `dirty` flag.
- **Server data → TanStack Query. Client-only state → Zustand.** Server-shaped reads (resource lists, ref-data, anything keyed by an API endpoint) belong in `useQuery` / `useMutation` so dedupe, stale-while-revalidate, and 401 refresh come for free. Zustand is reserved for client-only state (canvas selection, viewport, snapshot hashes, in-flight flags, modal open state). New stores must justify why they aren't a query — the pre-Phase-14 `evaluatorsStore` / `costStore` / `insideSalesStore` hand-rolled in-flight dedupe is the smell to look for; that surface migrates in Phase 15.
- Do not create subdirectory agent rule files such as `agents/` or `.cursor/`. This file is the Claude-specific source of truth.
- **Schema lives in Alembic, not in `startup_schema.py`.** That file no longer exists. Migrations are at `backend/alembic/versions/` and run via `alembic upgrade head` in `backend/entrypoint.sh` on every container boot. The baseline (`0001_baseline_prod`) captures prod schema as of 2026-04-27 and is stamped on prod, applied end-to-end on fresh dev/CI databases. Any schema change ships as a new revision file (model edit + matching migration in the same commit). Manifest-driven `COMMENT ON COLUMN` rows are synced separately by `backend/scripts/sync_column_comments.py` from the FastAPI lifespan; Alembic does not own them.
- **Schema-aware groundwork (Roadmap 01).** Alembic env runs with `include_schemas=True` and pins `version_table_schema='public'`. Every `CatalogTable` has an `effective_schema` (`pg_schema or 'public'`); helpers (`manifest.lookup_column`, `comment_emitter`, `manifest_validator`, `catalog_tools` `information_schema` queries, SQL-validator schema-prefix recognition, `vocabulary.ColumnTarget`) accept `schema.table.column` qualifiers. As tables move, manifests start declaring `pg_schema:` explicitly (for example `evaluation_runs` now resolves to `platform`). See `docs/plans/2026-04-24-implementation-sequence/roadmap-01-foundation-postgres-two-schemas.md` §9.6.
- Sherlock catalog tables, data surfaces, column roles, and per-app vocabulary live in `backend/app/services/chat_engine/manifests/<app-id>.yaml`. Do not edit the ORM catalog map, hand-typed `COMMENT ON COLUMN` lists, `apps.config.chat.dataSurfaces`, or the TOOLS block of `prompts/base.py` — add or change the manifest and let the generators (tool_description_generator, prompt_generator, comment_emitter) and the boot validator (manifest_validator) propagate.
- Sherlock manifest columns carry a 3-axis taxonomy: `role` (dimension / measure / temporal / ordered_categorical / key / identifier), `data_type` (Vega-Lite: quantitative / temporal / ordinal / nominal / boolean / geo), and `semantic_type` (Metabase-style: pk / fk / category / id_hash / currency / percent / lat / lon / count / ratio / score / duration / none). The boot validator (`manifest_validator.validate_manifest_taxonomy`) warns when a measure is missing `semantic_type` and raises on role/data_type contradictions.
- Sherlock chart payloads are discriminated-union objects (`kind: 'chart' | 'kpi' | 'summary' | 'table' | 'empty'`) produced by `backend/app/services/report_builder/chat_handler._build_chart_payload`. The backend owns the decision: (1) `result_set_typer.type_result_set` builds a `TypedResultSet` from SQL rows + declared `output_columns` + manifest; (2) `chartability_gate.evaluate` returns an enumerated `reason_code` (`CG_EMPTY`/`CG_SINGLE_VALUE`/`CG_FIELD_CARD`/`CG_NO_MEASURE`/`CG_DEGENERATE_MEASURE`/`CG_ALL_IDS`/`CG_HIGH_CARD`); (3) `chart_type_picker.pick` returns one of 7 Vega-Lite marks (`bar`/`grouped_bar`/`stacked_bar`/`line`/`multi_line`/`area`/`pie`); (4) `vega_lite_emitter.emit` builds a Vega-Lite v5 spec validated against `vega-lite-schema-v5.json` before leaving the backend. The gate + picker are pure functions — no LLM, no I/O. The frontend branches on `payload.kind` and translates chart specs via `src/features/analytics/vegaLiteToRecharts.ts`; it never infers chart type, roles, or shapes.
- `sql_agent.generate_sql` returns `{sql, chart_title, output_columns}` only. It does **not** return `chart_type`, `x_key`, `y_keys`, or `alternatives` — those were superseded by the deterministic picker. The call goes through the OpenAI Responses API via `_call_llm_for_sql` with a strict JSON schema (`SQL_GENERATION_RESPONSE_SCHEMA`) and records a `sherlock_turn`-owned `analytics.fact_llm_generation` row so `done.usage` aggregates correctly.
- **Raw SQL must schema-qualify every renamed table.** DB default `search_path = "$user", public`; the `platform, public, analytics` change planned in migration 0007 was deferred to out-of-band infra in commit 92780a0. Inside `text("...")`, `op.execute("...")`, or any hand-written SQL, always write `platform.evaluators`, `analytics.fact_evaluation`, `analytics.ref_llm_model_pricing`, etc. — never bare names. ORM queries are safe because `__table_args__ = {"schema": ...}` already propagates. Bug that crashed prod on 2026-04-29: `CREATE INDEX ... ON evaluators (...)` in `evaluator_seed_catalog.py` resolved against `public.evaluators` (gone after roadmap-01) and raised `UndefinedTableError` inside `seed_all_defaults`, putting the backend in CrashLoopBackoff with exit code 3.
- **Seed data files in `backend/app/seeds/data/` follow `<schema>.<table>.json` naming.** Example: `analytics.ref_llm_model_pricing.json` (not `model_pricing.json`). When renaming a table, rename the matching seed file in the same commit; loaders such as `bootstrap_seed.py` look up the file by the new name and silently skip if missing.
- **Container App env vars stored as `value:` are returned in plaintext by `az containerapp show`.** Only `secretRef:`-bound values are redacted by Azure. Never run a CI workflow that prints the env block. Migrate sensitive vars to `secretRef:` against `az containerapp secret set`. The 2026-04-29 prod debug session leaked plaintext credentials (`JWT_SECRET`, `ADMIN_PASSWORD`, `LSQ_*`, `AZURE_STORAGE_CONNECTION_STRING`, `GEMINI_SERVICE_ACCOUNT_JSON`, DB password) into Action logs because the template was `value:`-only — all are pending rotation.

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

- **No centered modals for new surfaces.** `<Modal>` from `src/components/ui/Modal.tsx` is reserved for confirmation dialogs (`<ConfirmDialog>`). Every form, editor, peek pane, detail panel, and run-inspector surface mounts inside `RightSlideOverShell` from `@/components/ui` — header / body / footer markup is consumer-owned. When you encounter a legacy `<Modal>` for a non-confirmation flow, treat it as a migration target.
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
4. `engine.begin` → `SELECT version_num FROM public.alembic_version` + `sync_column_comments` (applies manifest-driven `COMMENT ON COLUMN`; permission denied here means connecting role isn't owner of target tables)
5. `run_manifest_validator` — Sherlock manifest YAMLs vs live DB schema
6. `seed_all_defaults` — apps, system tenant/user, adversarial defaults, report prompts, report configs, eval templates, sherlock ontology, model pricing (`analytics.ref_llm_model_pricing.json`), cost rollup schedule, `reconcile_evaluator_seed_catalog` (creates `uq_evaluators_seed_scope` on `platform.evaluators`)
7. `seed_bootstrap_admin` — opens its own session, idempotent
8. `validate_all_app_pack_ids` — capability pack registry vs every app's `config.chat.capabilities`
9. `_cleanup_expired_refresh_tokens` — DELETE on `platform.identity_refresh_tokens`
10. `recover_stale_jobs` / `recover_stale_eval_runs` / `recover_stale_source_sync_runs` (only when `JOB_RUN_EMBEDDED_WORKER=true`, which is the prod default)
11. `worker_loop` / `recovery_loop` / `scheduler_tick_loop` started as `asyncio.create_task`

## Debugging Prod When You Have No Azure Portal Access

This pattern was used to recover prod on 2026-04-29 from a backend CrashLoopBackoff with no portal/CLI access — the entire diagnosis ran via GitHub Actions and a read-only DSN.

**Symptoms to recognize:**
- Frontend returns 504; backend FQDN returns 503 then 30s timeouts.
- `pg_stat_activity` shows no backend DB sessions → container is exiting before opening a DB connection (or in a fast crash loop).
- Container Apps system events show repeated `ProcessExited exit code 3`.

**Reuse the deploy SP via GitHub Actions (read-only):**
- The repo's deploy workflow authenticates via OIDC using `secrets.AIEVALSBEPROD_AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID`. Same SP can run any read-only `az containerapp` command.
- Add a temporary `workflow_dispatch` workflow (DELETE IT after) that runs: `az containerapp show`, `revision list`, `revision show`, `replica list`, `logs show --type system`, `logs show --type console`. Output appears in the Actions log.

**OIDC subject binding gotcha:**
- The SP's federated credential matches subject `repo:<owner>/<repo>:ref:refs/heads/prod` only. The diagnostic workflow file MUST exist on the `prod` branch and be triggered with `gh workflow run ... --ref prod`. Triggering from `main` or with `environment: <name>` fails with `AADSTS700213`.
- Pushing the workflow to `prod` triggers the deploy filter (`paths: '**'`) and rebuilds backend. Acceptable for one-time diagnosis since the rebuild produces the same image.

**Never print env vars in CI logs.** Container App env stored as `value:` (rather than `secretRef:`) is returned plaintext by `az containerapp show`. Skip env-dump steps; rely on system+console logs for diagnosis. (See the related invariant.)

**Local read-only lifespan diagnostic:**
- Get the prod DSN, open a session, set `default_transaction_read_only = on` on the connection, then call each lifespan step in turn. Postgres rejects writes with a specific `cannot execute INSERT/UPDATE/DELETE/COMMENT in a read-only transaction` error. Pre-write failures (`UndefinedTableError`, missing column, ImportError) are real bugs you can fix without reaching the container.

**Common boot-failure root causes (from this incident):**
- `UndefinedTableError: relation "X" does not exist` → unqualified raw SQL referencing a renamed table (see schema-qualifier invariant).
- `seed file missing at /app/...` → warning only, lifespan continues; not a boot blocker on its own.
- `permission denied for relation X` on a `COMMENT` or DDL → connecting role isn't owner of the target table; verify with `pg_class.relowner`.
- `RuntimeError: <ENV> environment variable is required` → `_validate_startup_config` failure; check the revision's env block.
- `ImportError` deep in `app.services.job_worker` → some handler module imports a model that references a removed table/column.

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
- Agent guide: `AGENTS.md`
- Copilot mirror: `.github/copilot-instructions.md`
