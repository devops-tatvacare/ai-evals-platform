# CLAUDE.md

Operational source of truth for any agent working in this repository. Read fresh every turn — this file is authoritative and self-sufficient.

Mirror invariant: any edit to `CLAUDE.md` MUST land in `AGENTS.md` in the same commit, and vice versa. The two files are byte-identical save for the H1 title.

## Precedence

1. Direct user instruction.
2. This file.
3. Existing code patterns in the files you are touching.

## Mandate

- Platform is a multi-tenant RBAC-gated SaaS. Every plan, every code change, every query factors this in. No exceptions.
- TDD. Write the failing test before the production code. New behavior without a test fails review.
- Reuse before reinventing. If an abstraction exists, use it. If you cannot find one, ASK before writing a new one. Code merged after 2026-05-19 that reinvents an existing abstraction is rejected.
- Verify upstream and downstream impact for every change. Enumerate callers, state the impact in the PR or plan. Silent breakage is the bug class to eliminate.
- Never fabricate data, configs, file paths, or framework APIs. Verify against the live codebase, official docs, or `--help`. Flag uncertainty; never paper over it.

## Plans + Investigations workflow

- Plans live at `docs/plans/` (gitignored, on-disk only). Phase docs are markdown. Date-prefixed filenames or dated subdirs.
- Investigations live at `docs/investigations/`. Same rule: on-disk only, gitignored.
- When the user confirms a plan shipped, MOVE it to `docs/plans/done/`. Never mark "done" without user confirmation.
- When an investigation produces a plan and that plan ships, MOVE the investigation to `docs/investigations/done/`.
- Status convention: glance-able from folder location (`done/` vs top-level). No DONE markers inside files.
- Anything strategic, decisional, or research-grade lives in the Obsidian vault at `/Users/dhspl/Programs/tc-work/tatvacare-obsidian/Projects/ai-evals-platform/`, not the repo. The repo holds code + `docs/plans/` + `docs/investigations/` + the three top-level docs.

## Architecture mental models

1. Frontend is a thin client. Business logic, LLM calls, and persistence live on the backend.
2. `EvaluationRun` is the central polymorphic entity. One row per evaluation outcome; `eval_type` discriminates shape; cascade chain runs from listings/chat_sessions → evaluation_runs → dependent detail rows.
3. Long-running work executes as background jobs. Submit a job, poll it, load the result. Never block a request on multi-second work.
4. PostgreSQL is the source of truth. TanStack Query caches server data on the client; Zustand caches client-only state.
5. Sherlock is an OpenAI Agents SDK agent. Supervisor + named specialists registered via `as_tool`. ALL agent orchestration on this platform follows this pattern. No bespoke chat engines.
6. Analytics, reporting, and reviews consume `EvaluationRun` rows but persist their own fact / config / artifact tables. Request handlers never write fact tables directly.
7. Cost tracking is an observability plane. Every generation writes one `analytics.fact_llm_generation` row; rollups are rebuilt by jobs.
8. Provider connections (WhatsApp / Voice / CRM) are tenant + app-owned, Fernet-encrypted, referenced from node configs by `connection_id` UUID. Never by env var.

## Multi-tenant + RBAC invariants

- Every owned-data query MUST filter by `tenant_id`. User-owned resources additionally filter by `user_id`. Tenant + app + user is the default discrimination triple.
- Resources scoped at tenant level: tenants, applications, platform refs.
- Resources scoped at tenant + app level: app data, app settings, datasets, workflows, cohorts, evaluations.
- Resources scoped at tenant + app + user level: chat sessions, sherlock sessions, user-owned listings, personal LLM defaults.
- Every protected route MUST take `auth: AuthContext = Depends(get_auth_context)` or `require_permission(...)`. The only public routes live under `/api/auth/*`.
- Admin surfaces MUST require an admin role/permission. Never expose admin mutations to non-admin tokens.
- System library data lives under `SYSTEM_TENANT_ID` + `SYSTEM_USER_ID`.
- LLM settings are global per tenant + user at `app_id=""`. Do not pass an `app_id` for LLM settings lookup.

## Naming invariants (permanent — new code only)

- No app-specific or tenant-specific names in files, folders, classes, functions, variables, columns, routes, tables, job types, or string constants. `inside_sales_*`, `voice_rx_*`, `kaira_*`, `tatva_*`, `INSIDE_SALES_APP_ID`, `evaluate-inside-sales`, etc. are existing contamination — grandfathered, do not extend.
- New code is named for the CAPABILITY (`call_quality_runner`, `audio_transcribe_evaluate_worker`, `evaluation_selection_spec`, `dataset_binding_registry`). Per-app behaviour comes from `App.config` and the DB-seeded `apps` registry.
- Re-stating an app-named string in a new tuple, set, or dict still extends the breach. The right alternative is a runtime fixture or producer config rewrite.
- `app_id="inside-sales"` as a primary-key slug for the application row is fine. Only behaviour, file, and symbol names need to be generic.
- No competitor product names (Cursor, Linear, Vercel, ElevenLabs, etc.) in source, specs, comments, copy, or commit messages. Conversation only.

## Reuse these abstractions (canonical list)

Backend:
- LLM generation → call-site resolver in `llm_credentials/` (capability gating + tenant defaults + platform fallback). Direct provider SDK calls are forbidden.
- LLM usage recording → `LoggingLLMWrapper` + `make_usage_callback()` in `services/evaluators/runner_utils.py`.
- Cost tracking + pricing resolution → `cost_tracking` service + `pricing_cache`. Never hand-roll provider/model normalization.
- Async session → `Depends(get_db)`. Auth → `Depends(get_auth_context)`.
- Job submission → injects `tenant_id` + `user_id`; runners read from params.
- Sherlock chart payload → `report_builder/chat_handler._build_chart_payload` (typer → gate → picker → emitter).
- Provider integrations (WhatsApp / Voice / SMS / LSQ / clinical) → adapters in `orchestration/integrations/`; never instantiate provider SDKs in route handlers.
- Config strictness → `app.services.orchestration._config_strictness.strict_node_config_dict()` returns `ConfigDict(extra='forbid')`. All node `_Config(BaseModel)` classes use it unconditionally.

Frontend:
- HTTP → `apiRequest` / `apiUpload` / `apiDownload` from `src/services/api/client.ts`.
- Server-data fetch → `useQuery` / `useMutation` via `apiQueryFn` from `src/features/orchestration/queries/queryFn.ts`. Every hook routes through `apiQueryFn` so the 401-refresh-and-retry flow stays in effect.
- Async evaluations → `submitAndPollJob()` from `src/services/api/jobPolling.ts`.
- Resource APIs → `src/services/api/*.ts`.
- Navigation → `src/config/routes.ts`. No hardcoded URL literals.
- Notifications → `notificationService.{success|error|info|warning}`.
- Diagnostics → `logger` / `evaluationLogger`.
- CSS merging → `cn()` from `src/utils/cn.ts`. Never concatenate Tailwind classes with template literals.
- UI primitives → `src/components/ui/`.
- Dropdowns → `Select` (simple) / `Combobox` (searchable, multi-select). Never native HTML `<select>`.
- Pagination → `Pagination`. Filter pills → `FilterPills`. Lists → unified `DataTable`. Slide-overs → `RightSlideOverShell`.
- Charts that need hex → `resolveColor()` / `useResolvedColor` from `src/utils/statusColors.ts`.
- Contract validation → Zod 4 schemas in `src/features/orchestration/contracts/nodeConfig.ts`; `parseNodeConfig(nodeType, raw)` at every state-entry boundary.
- API error decoding → `decodeApiError` / `decodeApiErrorBody` / `summarizeApiErrorBody`. Never `String(detail)` on an error body.
- Sidebar primary actions → `apps.config.quickActions: PageActionSpec[]` resolved by `QUICK_ACTION_REGISTRY` in `src/features/quickActions/registry.ts`. Never branch on `appId` inside `Sidebar.tsx`.

## Upstream/downstream impact (mandatory)

Before any plan, phase, or non-trivial edit:

1. Enumerate every caller of the function, route, table, or column you touch (`grep`, `git grep`, IDE references).
2. Verify the contract change is safe across all callers, or update them in the same PR.
3. State the impact in the plan / PR description: "Touched X. Callers Y, Z verified. Caller W deferred because <reason>."
4. Cross-check the relevant manifest (`backend/app/services/chat_engine/manifests/<app-id>.yaml`), Zod schema, and Pydantic model when the change crosses the contract boundary.
5. Run `python -m app.services.orchestration.contract_audit` when an orchestration node contract changes.

Silent shape-drift is the bug class this rule eliminates. The 2026-05-15 inside-sales `min_duration` incident is the canonical example.

## Session state (frontend)

- Server-shaped reads (resource lists, ref-data, anything keyed by an API endpoint) MUST go through TanStack Query (`useQuery` / `useMutation`) via `apiQueryFn`.
- Zustand is reserved for client-only state: canvas selection, viewport, snapshot hashes, in-flight flags, modal open state, ephemeral UI.
- A new Zustand store needs an explicit justification ("why isn't this a query?"). Hand-rolled in-flight dedupe and stale-while-revalidate logic are the smell that pre-existed the TQ migration.
- Platform-wide TanStack rollout is incomplete. Stores like `evaluatorsStore`, `costStore`, `insideSalesStore` are pre-migration. When you touch one of these surfaces, call out the drift in the PR and propose the migration step.

## Code comments

- One-line comments only. Only when the WHY is non-obvious: a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader.
- Never restate WHAT. Well-named identifiers carry that.
- No "Phase 1 / Phase 2" markers. No "removed in commit X". No decision logs. No multi-paragraph docstrings on internal functions. Module docstrings: one sentence.
- If a comment is longer than the code it describes, delete it.

## Sherlock

- OpenAI Agents SDK driven. One supervisor agent, multiple specialists registered with `as_tool` (data, query_synthesis, authoring). Specialists do one thing and return a `SpecialistResult`.
- Sherlock is per-tenant + per-user + per-app. Never cross-scope.
- Sherlock is read-only over manifest-declared tables. It never mutates evaluation data.
- Runtime persistence: `platform.sherlock_agent_sessions` (one per tenant + user + app), `platform.sherlock_conversation_turns` (one per turn), `platform.sherlock_turn_events` (per supervisor + specialist event). These are the ONLY persistence for agent traces; no parallel logging tables.
- Continuation: `previous_response_id` chain on `sherlock_agent_sessions.last_response_id`. 30-day TTL; on stale, replay history with `previous_response_id=None`.
- Chart payloads are discriminated-union objects (`kind: 'chart' | 'kpi' | 'summary' | 'table' | 'empty'`) built backend-side by `result_set_typer → chartability_gate → chart_type_picker → vega_lite_emitter`. The frontend branches on `payload.kind`. Never infer chart type, roles, or shapes on the frontend.
- Manifests at `backend/app/services/chat_engine/manifests/<app-id>.yaml` drive catalog, vocabulary, surfaces, and `COMMENT ON COLUMN`. The boot validator enforces them. Do not hand-edit ORM catalog maps, hand-typed column comments, or app config data surfaces — change the manifest.
- Any future agent orchestration on this platform MUST follow the supervisor + specialist + Agents-SDK pattern. No bespoke chat engines.

## Schema + migrations

- Alembic is the only schema truth. Migrations live at `backend/alembic/versions/`. `alembic upgrade head` runs on every container boot via `backend/entrypoint.sh`.
- Baseline `0001_baseline_prod` captures prod schema and is stamped on prod; fresh dev/CI applies end-to-end.
- There is no `startup_schema.py`, no bootstrap-create script. Schema change = new revision + matching ORM edit in the same commit.
- Three Postgres schemas: `platform`, `analytics`, `orchestration`. The default search path is `"$user", public` — every raw SQL string (`text(...)`, `op.execute(...)`, hand-written SQL in seeds, indexes, triggers) MUST schema-qualify: `platform.evaluators`, `analytics.fact_evaluation`, etc. ORM queries propagate the schema via `__table_args__` and are safe. Bare names crash boot.
- `COMMENT ON COLUMN` comes from manifests via `sync_column_comments` in the FastAPI lifespan. Alembic does not own column comments.
- Verify table shape and runtime gates against the real source: read the ORM model file, run `\d schema.table` against the live DB (docker-compose Postgres on `localhost:5432`), trace runtime gates at the actual consumer. Unit-test mocks paper over shape drift; a docker-compose migrate + backend boot is the only acceptance gate.

## Seed defaults

- Avoid `seed_defaults` edits when a post-release SQL `INSERT` / `UPDATE` achieves the same outcome. A multi-tenant platform should not encode per-tenant rows as platform-wide seeds.
- `seed_defaults` is acceptable ONLY for genuinely platform-wide bootstrap: `SYSTEM_TENANT_ID` rows, capability-pack registry, model catalog ref data, evaluator seed catalog.
- Per-tenant config, per-tenant credentials, per-tenant LLM defaults, per-tenant overlays — these belong in the DB, inserted via admin UI or a runbook SQL, never via a seed file edit.
- When a row update is the right answer, give a SQL statement, not a seed_defaults change.

## LLM call sites

- Every LLM generation flows through a capability-named call site (`sherlock.data_specialist`, `eval.transcription`, `eval.critique`, `report.narrative`, etc.).
- Resolution order: per-call override → `TenantCallSiteDefault` for the capability → platform fallback. Sherlock keeps tenant-specific preservation rows when the platform fallback moves.
- `TenantLLMDeployment` forward-declares model + declared capabilities. `TenantLLMCredential` carries the encrypted provider credential (Fernet via `LLM_CREDENTIAL_KEY`).
- Capability gating: admin/builder dropdowns only surface deployments whose declared capabilities cover the call site. Never expose a deployment that lacks the capability.
- Provider auth: Vertex AI and similar honor a three-tier per-call → connection → provider-default fallback for IDs like `from_phone`. Empty string at any tier delegates to the next.
- Logging: `LoggingLLMWrapper` writes one `analytics.fact_llm_generation` per generation. `populate-cost-rollup` jobs rebuild `analytics.agg_llm_usage_daily`. Request handlers never write either table directly.
- Never call provider SDKs directly. Never hand-roll model normalization, pricing math, or capability resolution.

## Worker topology

- Worker topology depends on the deploy target.
- Local docker-compose: dedicated `worker` container, `JOB_RUN_EMBEDDED_WORKER=false`.
- Production today (Azure Container App `ai-evals-be-prod`): single backend container, `JOB_RUN_EMBEDDED_WORKER=True` default. Backend owns the worker loop in-process. There is no separate worker deploy workflow.
- Any plan or doc claiming prod has a dedicated worker is stale until a worker deploy pipeline is added.

## Frontend rules

- TypeScript strict. Never `any`. `import type` for type-only imports. `@/` alias for internal modules.
- Single quotes and semicolons match local file style.
- Named exports unless the local pattern requires default exports.
- Select Zustand slices in components; never read whole stores. In async callbacks use `useStore.getState()`.
- Parse dates at the API boundary, not inline in components.
- Conditional Tailwind classes use `cn()`. No template-literal class concatenation (JIT scanner bug).
- Test files live next to the feature, not the QueryClient.

## Backend rules

- Python internals `snake_case`. API JSON `camelCase` via `CamelModel` / `CamelORMModel`.
- Route handlers are async with `Depends(get_db)`.
- Never `db.get()` for tenant-owned user data. Use filtered `select()` with tenant + user predicates.
- Update model, schema, route, AND seed (if any) in the same commit when changing persisted data.
- `HTTPException.detail` strings are stable client-facing errors. Do not paraphrase across versions.
- Analytics may use `ANALYTICS_DATABASE_URL`; defaults to `DATABASE_URL`.
- Never reference a removed table or unqualified renamed table inside `text(...)`. Re-grep before commit.

## Design system rules

- All colors MUST come from CSS variables in `src/styles/globals.css`. Hex literals are allowed only in `globals.css`, `src/utils/statusColors.ts`, and `src/features/guide/styles/guide.css`. D3 / Recharts configs use `resolveColor()`.
- Z-index MUST use tokens: `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-popover(150)`, `--z-modal(200)`, `--z-tooltip(300)`, `--z-max(999)`. No raw z-index numbers.
- HTTP method colors → `--color-http-{get|post|put|patch|delete}`. Gap colors → `--color-gap-{underspec|silent|leakage|conflicting}`.
- `<Modal>` is reserved for confirmations (`<ConfirmDialog>`). All other forms / editors / peeks / panels mount inside `RightSlideOverShell`.
- Always check light + dark mode before shipping.
- A repeatable visual becomes a named component in `src/components/ui/`. No copy-pasted UI blocks. No one-off inline styled blocks.
- Tables stay compact: short column headers, truncated paths (first 10 + last 20 chars), no wasted horizontal space.
- User-visible copy (descriptions, labels, tooltips, palette text) reads like a SaaS product (Zapier / n8n / HubSpot tone). No casual phrasing ("send people"), no engine jargon ("cohort / predicate / outbox"). Get user approval for the before→after copy table before editing.

## Test discipline

- TDD. Failing test first.
- Never call external APIs (WATI / AiSensy / Bolna / Twilio / LSQ / OpenAI / Gemini / Anthropic / Azure OpenAI) live from tests. Tests assert code shape and contracts against verbatim doc fixtures.
- After fixing an error, re-run the exact command that produced it. `tsc` passing is not enough — check router type, async context, lazy loads, and run the feature in a browser for UI changes.
- Verify table shape with a docker-compose migrate + backend boot for any schema/seed change. `unittest.mock` / FakeSession is not a substitute.

## Admin surfaces

- Every admin route uses an admin-scoped permission gate. Non-admin tokens get 403.
- Admin pages do not mount the chat widget. `MainLayout` gates `<ChatWidget />` behind `!isAdminPath()`.
- Admin mutations write audit events to `platform.audit_event_logs`.

## Current registry (snapshot — verify against live code)

- Postgres schemas: `platform`, `analytics`, `orchestration`. Cross-schema FKs go FROM `orchestration` TO `platform`.
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`.
- LLM providers: Gemini (AI Studio + Vertex), OpenAI, Azure OpenAI, Anthropic.
- Route groups: auth, listings, files, evaluators, chat, chat_engine, history, settings, tags, jobs, evaluation_runs (+ threads), llm, llm_assist, adversarial_config, adversarial_test_cases, admin, admin_ai_settings, reports, report_builder (+ v2), inside_sales, apps, roles, rules, eval_templates, reviews, analytics_library, cost (+ cost admin), scheduled_jobs, orchestration_webhooks (public), orchestration, orchestration_connections, orchestration_datasets, orchestration_cohorts.
- Job types: `evaluate-voice-rx`, `evaluate-batch`, `evaluate-adversarial`, `evaluate-custom`, `evaluate-custom-batch`, `evaluate-inside-sales`, `generate-report`, `generate-evaluator-draft`, `generate-cross-run-report`, `sync-external-source`, `populate-analytics`, `populate-cost-rollup`, `backfill-facts-from-mirror`, `backfill-lead-signals`, `backfill-stage-transitions`, `run-workflow`, `resume-waiting-cohorts`.
- Zustand stores (under active migration to TanStack Query): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, evaluatorsStore, evalTemplatesStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore, reviewModeStore, costStore, workflowBuilderStore.
- Sherlock manifest set: per-app YAML at `backend/app/services/chat_engine/manifests/<app-id>.yaml`. Semantic models at `backend/app/services/chat_engine/semantic_models/<app-id>.yaml`.
- Orchestration node registry: capability-named (`messaging.send_whatsapp_template`, `voice.place_call`, `crm.lsq_*`, `clinical.*`, plus shared source / filter / logic / sink). Vendor selected by `ProviderConnection`.

## Common pitfalls

- Most backend list/get endpoints require an `app_id`.
- `settings` uses `app_id=""` for global LLM settings, not `null`.
- `listing.source_type` matters; do not mix upload and API-flow assumptions.
- Sherlock sessions: always filter by `tenant_id` + `user_id` + `app_id`.
- Cost APIs: `/api/cost` for tenant/user views; admin sub-router under `/api/admin` for pricing.
- Provider connection GET responses strip secrets; PATCH preserves omitted secret keys (blank submission does not overwrite stored credentials).
- Every dispatch action writes `payload.contact` and `provider_correlation_id`. New dispatch nodes that skip this break cross-channel reporting.
- Reporting v1 (`reports`) and v2 (`report_builder` / `report_builder_v2`) are separate surfaces. Match the surface to the data flow you are touching.
- Relocations get clean moves. No temporary redirects, no compat shims, no legacy scaffolding — even if the plan suggests it.
- When prod fails inside an app-named legacy file, check the worktree for an in-flight generic replacement before patching the legacy.

## Debugging prod

- Read the deploy workflow files in `.github/workflows/` to see which Service Principal is bound to which environment.
- For diagnostics without portal access, run read-only `az containerapp ...` commands inside a one-off GitHub Action that uses the existing deploy OIDC binding. The federated credential subject is bound to a specific branch — your diagnostic workflow file MUST exist on that branch and be triggered with the matching `--ref`.
- NEVER print env vars in CI logs. Container App env stored as `value:` returns plaintext in `az containerapp show`. Use `secretRef:` for anything sensitive.
- When the backend will not boot, bisect by the last successful lifespan log line. Lifespan order: configure_logging → validate_startup_config → import job_worker → alembic check + sync_column_comments → manifest_validator → seed_all_defaults → seed_bootstrap_admin → validate_app_pack_ids → recover_stale_jobs → worker loops.
- Replay lifespan locally against the prod DSN with `default_transaction_read_only=on`. Pre-write failures (UndefinedTable, missing column, ImportError, env validator) are real bugs. Write attempts surface as read-only-transaction errors and are not your bug.
- Common boot failures: unqualified raw SQL referencing a renamed table, missing column on a renamed table, permission denied on `COMMENT` or DDL (wrong relation owner), missing env var, ImportError in eagerly-loaded job handlers.
- Do not destructively recover (force push, hard reset, drop revision) without explicit user authorization. Diagnose, then propose.

## Commit conventions

Every commit landing after 2026-05-19 MUST follow Conventional Commits.

- Prefix MUST be one of: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `style:`, `perf:`, `build:`, `ci:`. Optional scope in parens, e.g. `feat(orchestration):` or `fix(cohorts-P1):`.
- Subject line: imperative, ≤ 70 chars, no trailing period.
- Body: 2–3 lines maximum. State WHAT changed and WHY in plain prose. No bullet lists, no per-file enumerations, no Phase markers.
- No `--no-verify`, no skipped hooks, no `--amend` on shared commits.
- Never commit unless the user explicitly says "commit". "lock in", "save", "write it" are NOT commit authorization.

Example:

```
feat(orchestration): add saved-cohort source node

Introduces source.saved_cohort backed by CohortDefinition rows so workflows
can reuse versioned cohorts. Builder picker lists tenant-scoped cohorts only.
```

## Build, run, lint

```
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

## Mirror invariant

`CLAUDE.md` and `AGENTS.md` are mirrors. Any change to one MUST land in the other in the same commit. The only permitted difference is the H1 heading. PR review rejects any commit that updates one without the other.
