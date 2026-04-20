# AGENTS.md

Operational guide for coding agents working in this repository. Prefer existing abstractions and patterns.

## Rule Precedence

1. Direct user instruction
2. This file
3. `.github/copilot-instructions.md`
4. Existing code patterns in touched files

## Architecture Mental Models

1. Frontend is a thin client. Business logic, LLM calls, and persistence live on the backend.
2. `EvalRun` is the central entity. Every evaluation outcome is one row; `eval_type` defines its shape.
3. Long-running work executes as background jobs. Submit a job, poll it, then load the result.
4. Zustand stores are frontend caches. PostgreSQL is the source of truth.
5. Evaluation runners call provider wrappers in `llm_base.py`, never provider SDKs directly.
6. Analytics, reporting, and reviews are separate domains that consume EvalRuns but store their own fact/config/artifact tables.
7. Sherlock is a constrained analytics agent with its own runtime session/turn/event tables; it never mutates eval data.

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

## Current Registry

- Route groups (26): auth, listings, files, prompts, schemas, evaluators, chat, chat_engine, history, settings, tags, jobs, eval_runs, threads, llm, adversarial_config, adversarial_test_cases, admin, reports, report_builder, report_builder_v2, inside_sales, apps, roles, rules, eval_templates, reviews, analytics_library
- ORM tables (49): tenants, users, refresh_tokens, listings, eval_runs, thread_evaluations, adversarial_evaluations, api_logs, tags, prompts, lsq_lead_cache, jobs, schemas, chat_sessions, chat_messages, audit_log, evaluation_analytics, files, invite_links, external_agents, apps, tenant_configs, adversarial_test_cases, evaluators, history, settings, roles, role_app_access, role_permissions, eval_templates, analytics_charts, analytics_jobs, analytics_query_cache, analytics_run_facts, analytics_eval_facts, analytics_criterion_facts, analytics_dashboards, agent_tool_logs, report_runs, report_configs, report_artifacts, eval_reviews, eval_review_items, inside_sales_calls, inside_sales_leads, inside_sales_sync_runs, sherlock_runtime_sessions, sherlock_runtime_turns, sherlock_runtime_events
- Zustand stores (16): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, evaluatorsStore, evalTemplatesStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore, reviewModeStore
- LLM providers: Gemini, OpenAI, Azure OpenAI, Anthropic
- Job types (11): evaluate-voice-rx, evaluate-batch, evaluate-adversarial, evaluate-custom, evaluate-custom-batch, evaluate-inside-sales, generate-report, generate-evaluator-draft, generate-cross-run-report, sync-external-source, populate-analytics
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`

## Invariants

- Preserve `EvalRun` polymorphism and the cascade chain from listings/chat_sessions to eval_runs to dependent detail rows.
- Voice Rx always runs transcription first with audio, then critique second with text only.
- Compute Voice Rx statistics server-side from stored records, not model self-reports.
- Every user-owned query must be tenant-scoped and auth-scoped.
- `/api/auth/*` routes are the only public routes. All other routes require bearer auth.
- LLM settings are global per tenant and user at `app_id=""`; do not pass an app ID for LLM settings lookup.
- System library data belongs to `SYSTEM_TENANT_ID` and `SYSTEM_USER_ID`.
- Gemini on Vertex AI uses `Part.from_bytes()` for media. To disable thinking, omit `thinking_config`. Use `thinking_budget` only for 2.5 models and `thinking_level` only for 3+ models.
- Local and production compose stacks run a dedicated worker with `JOB_RUN_EMBEDDED_WORKER=false`.
- Analytics fact tables (`analytics_*_facts`) are populated by `populate-analytics` jobs from stored runs; never write to them from request handlers.
- Sherlock runtime rows (`sherlock_runtime_sessions/turns/events`) are the only persistence for agent traces; chart binding goes through `analytics_charts`.
- Do not reintroduce `kaira-evals` as an app ID anywhere in the frontend or backend.
- Do not create subdirectory agent rule files. This file is the repo-wide source of truth.
- Sherlock manifest columns carry a 3-axis taxonomy: `role` (dimension / measure / temporal / ordered_categorical / key / identifier), `data_type` (Vega-Lite: quantitative / temporal / ordinal / nominal / boolean / geo), and `semantic_type` (Metabase-style: pk / fk / category / id_hash / currency / percent / lat / lon / count / ratio / score / duration / none). The boot validator (`manifest_validator.validate_manifest_taxonomy`) warns when a measure is missing `semantic_type` and raises on role/data_type contradictions.
- Sherlock chart payloads are discriminated-union objects (`kind: 'chart' | 'kpi' | 'summary' | 'table' | 'empty'`) produced by `backend/app/services/report_builder/chat_handler._build_chart_payload`. The backend owns the decision: (1) `result_set_typer.type_result_set` builds a `TypedResultSet` from SQL rows + declared `output_columns` + manifest; (2) `chartability_gate.evaluate` returns an enumerated `reason_code` (`CG_EMPTY`/`CG_SINGLE_VALUE`/`CG_FIELD_CARD`/`CG_NO_MEASURE`/`CG_DEGENERATE_MEASURE`/`CG_ALL_IDS`/`CG_HIGH_CARD`); (3) `chart_type_picker.pick` returns one of 7 Vega-Lite marks (`bar`/`grouped_bar`/`stacked_bar`/`line`/`multi_line`/`area`/`pie`); (4) `vega_lite_emitter.emit` builds a Vega-Lite v5 spec validated against `vega-lite-schema-v5.json` before leaving the backend. The gate + picker are pure functions — no LLM, no I/O. The frontend branches on `payload.kind` and translates chart specs via `src/features/analytics/vegaLiteToRecharts.ts`; it never infers chart type, roles, or shapes.
- `sql_agent.generate_sql` returns `{sql, chart_title, output_columns}` only. It does **not** return `chart_type`, `x_key`, `y_keys`, or `alternatives` — those were superseded by the deterministic picker. The call goes through the OpenAI Responses API via `_call_llm_for_sql` with a strict JSON schema (`SQL_GENERATION_RESPONSE_SCHEMA`) and records a `sherlock_turn`-owned `llm_usage` row so `done.usage` aggregates correctly.

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
- Report generation has two surfaces: legacy `reports` and the v2 `report_builder` / `report_builder_v2` pipeline backed by `report_configs` / `report_runs` / `report_artifacts`.
- Sherlock sessions are per-user per-app; always filter `sherlock_runtime_*` by tenant/user/app.

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
