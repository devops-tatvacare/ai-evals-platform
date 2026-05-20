# PROJECT 101 — AI Evals Platform

Primary product and architecture reference. Read end-to-end if new to the codebase.

---

## What it is

A multi-tenant SaaS for evaluating AI behavior in production workflows. Stores prompts, schemas, evaluators, runs, logs, reports, reviews, analytics, orchestration workflows, and cost telemetry so teams reproduce decisions instead of relying on ad-hoc reviews.

Three workspaces today:

| App | App ID | Evaluates | Primary inputs |
| --- | --- | --- | --- |
| Voice Rx | `voice-rx` | Medical transcription + structured extraction | Audio, transcripts |
| Kaira Bot | `kaira-bot` | Conversational AI | Chat sessions, CSV thread exports, adversarial cases |
| Inside Sales | `inside-sales` | AI-assisted call quality | LeadSquared calls + transcripts |

Cross-workspace capabilities: versioned prompts/schemas/templates, reusable evaluators, async job execution with cancellation + recovery, `EvaluationRun` as the polymorphic result row, human review universe, reporting v1 + v2 pipelines, analytics fact layer, Sherlock analytics agent, cost-tracking observability plane, orchestration workflow engine, tenant-aware RBAC + invite links.

---

## Product principles

1. Evidence beats intuition. Persist the run, the config, the logs.
2. Long work is async. The UI never owns custom polling.
3. Frontend is a thin client. Business logic, persistence, LLM calls live on the backend.
4. Multi-tenant rules are non-negotiable. Every owned row is tenant-scoped; most are tenant + app scoped; user-owned rows are tenant + app + user.
5. Reuse beats invention. Extend existing abstractions; do not re-roll them.
6. Analytics is downstream. Fact tables are derived, never hand-authored.

---

## How it works

### Shared flow

```text
Bring data in (upload, CSV, external sync)
  -> Configure inputs (prompts, schemas, evaluators, LLM call site)
  -> Submit background job
  -> Worker claims + executes
  -> EvaluationRun + detail rows persist
  -> populate-analytics fans into fact tables
  -> reviews, reports, Sherlock, dashboards consume
```

### Voice Rx pipeline (fixed)

```text
1. Transcription call with audio (Gemini Part.from_bytes for Vertex media)
2. Critique call with text only (compares transcript to reference)
3. Server-side statistics (model is never trusted to self-report totals)
```

Audio never travels on the critique call. That order is a hard invariant.

### Kaira Bot

| Mode | Job type | Result |
| --- | --- | --- |
| Custom evaluator | `evaluate-custom` / `evaluate-custom-batch` | `EvaluationRun` (`eval_type=custom`) |
| Batch thread | `evaluate-batch` | aggregate `EvaluationRun` + `evaluation_run_thread_results` |
| Adversarial | `evaluate-adversarial` | aggregate `EvaluationRun` + `evaluation_run_adversarial_results` |

Supporting capabilities: per-app rules catalog, saved adversarial test cases, persona/trait axes (persona = who the user is; trait = how they ask).

### Inside Sales

LeadSquared-backed call quality. `sync-external-source` jobs pull data into source tables (`crm_call_record`, `crm_lead_record`, `log_crm_source_sync`), then `evaluate-inside-sales` runs scoring. Serving endpoints (`/api/inside-sales/calls`, `/leads`, `/agents`) read from the source tables so evaluation does not depend on live LSQ availability.

### Orchestration

A workflow engine that drives outbound campaigns (CRM / WhatsApp / Voice / SMS / clinical) and resumes-on-webhook flows.

- Node registry uses capability-named nodes (`messaging.send_whatsapp_template`, `voice.place_call`, `crm.lsq_*`, `clinical.*`, plus shared source/filter/logic/sink).
- Vendor selected by `ProviderConnection` (tenant + app owned, Fernet-encrypted).
- Per-call → connection → provider-default credential fallback (e.g. `from_phone`).
- Webhooks resolve by per-connection token. Resume polling claims waiting rows.
- Cohort datasets (`cohort_datasets`, `cohort_dataset_versions`, `cohort_dataset_rows`) are first-class campaign sources.
- Run state: workflow runs + per-node steps + per-recipient state + per-recipient actions + per-recipient overrides.

### Sherlock

OpenAI Agents SDK agent — one supervisor + named specialists registered via `as_tool` (data, query_synthesis, authoring). Read-only over manifest-declared tables; never mutates eval data.

Runtime persistence:

- `sherlock_agent_sessions` — one per tenant + user + app
- `sherlock_conversation_turns` — one per turn
- `sherlock_turn_events` — per supervisor + specialist event
- `log_sherlock_tool_call` — structured tool call log under analytics schema

Chart output uses a discriminated-union payload (`chart | kpi | summary | table | empty`) built backend-side by `result_set_typer → chartability_gate → chart_type_picker → vega_lite_emitter`. The frontend never infers chart type.

Manifests at `backend/app/services/chat_engine/manifests/<app-id>.yaml` drive catalog, vocabulary, surfaces, and `COMMENT ON COLUMN`. Semantic models at `semantic_models/<app-id>.yaml`. The boot validator enforces both.

### Reviews

`evaluation_reviews` + `evaluation_review_items` + `/api/reviews`. Human reviewers sign off on individual records. FE under `src/features/reviews/`, orchestrated by `reviewModeStore`.

### Reports

| Surface | Routes | Tables |
| --- | --- | --- |
| Legacy | `/api/reports` | per-run report rows |
| v2 builder | `/api/report-builder` and `/api/report-builder/v2` | `report_configurations`, `report_generation_runs`, `report_generated_artifacts` |
| Cross-run | `generate-cross-run-report` job | folded into `/analytics` hero |
| Evaluator drafting | `generate-evaluator-draft` job | drafts via LLM-assisted overlay |

### Analytics

Separate domain backed by `analytics.*` tables:

- Definitions: `analytics_charts`, `analytics_dashboards`
- Facts: `fact_evaluation`, `fact_evaluation_criterion`, `fact_lead_stage_transition`, `fact_lead_activity`, `fact_lead_signal`
- Dimensions: `dim_lead`
- Aggregates: `agg_evaluation_run`, `agg_llm_usage_daily`
- Logs: `log_fact_population_run`, `log_sherlock_tool_call`, `log_crm_source_sync`, `log_clinical_action_outbox`
- Cache: `cache_sql_query`

Facts are populated by `populate-analytics` and `backfill-*` jobs. Request handlers never write facts directly.

### Cost tracking

Observability plane for LLM spend. Every generation through `LoggingLLMWrapper` writes one `analytics.fact_llm_generation` row (provider, model, token counts, duration, correlation id, owner triple, subsystem). `populate-cost-rollup` rebuilds `analytics.agg_llm_usage_daily`. Pricing resolution goes through `cost_tracking` + `pricing_cache`; never hand-roll provider/model normalization.

Surfaces: `/api/cost/*` for tenant/user views; admin sub-router under `/api/admin/cost/*` for pricing edits + refresh + backfill + snapshots. FE: `src/features/cost/`.

---

## Core abstractions

### `EvaluationRun` is central

Every evaluation outcome lands in `platform.evaluation_runs`. `eval_type` discriminates the result shape:

```
custom              single evaluator output
full_evaluation     Voice Rx transcribe + critique
human               manual human-authored result
batch_thread        aggregate thread evaluation
batch_adversarial   aggregate adversarial evaluation
call_quality        inside-sales call evaluation
```

Cascade:

```
listings / chat_sessions
  -> evaluation_runs
      -> evaluation_run_thread_results
      -> evaluation_run_adversarial_results
      -> evaluation_run_api_call_logs
      -> evaluation_review_items (via evaluation_reviews)
      -> analytics.fact_evaluation (via populate-analytics)
```

### Jobs

17 registered job types:

```
evaluate-voice-rx
evaluate-batch
evaluate-adversarial
evaluate-custom
evaluate-custom-batch
evaluate-inside-sales
generate-report
generate-evaluator-draft
generate-cross-run-report
sync-external-source
populate-analytics
populate-cost-rollup
backfill-facts-from-mirror
backfill-lead-signals
backfill-stage-transitions
run-workflow
resume-waiting-cohorts
```

The worker (`backend/app/services/job_worker.py`) supports queue classes (`interactive`, `standard`, `bulk`, `analytics`), priorities, leases + heartbeats, retry scheduling, stale recovery, orphaned-run reconciliation, and per-tenant/app/user concurrency caps.

### LLM call sites

Every generation flows through a capability-named call site resolved in `llm_credentials/`:

- Resolution: per-call override → `TenantCallSiteDefault` for the capability → platform fallback. Sherlock keeps tenant-specific preservation rows.
- `TenantLLMDeployment` forward-declares model + declared capabilities. `TenantLLMCredential` carries Fernet-encrypted provider auth (`LLM_CREDENTIAL_KEY`).
- Capability gating: admin/builder dropdowns surface only deployments whose declared capabilities cover the call site.
- Direct provider SDK calls are forbidden.

### Provider integrations (orchestration)

`backend/app/services/orchestration/integrations/`: adapters per vendor (WATI, AiSensy, Bolna, MSG91, LSQ, clinical outbox). Selected at runtime by `ProviderConnection`. Never instantiate provider SDKs in route handlers.

### Frontend state

- Server data → TanStack Query via `apiQueryFn` (401-refresh + dedupe).
- Client-only state → Zustand (canvas selection, viewport, snapshot hashes, in-flight flags).
- Stores still pre-migration: `evaluatorsStore`, `costStore`, `insideSalesStore`. Call out the drift when you touch one.

### Tenant + RBAC

- Every owned-data query filters by `tenant_id`. User-owned rows additionally filter by `user_id`.
- Permission gating via `AuthContext` + `require_permission(...)`. Admin surfaces require an admin role.
- Roles, role-permission grants, role-application grants are RBAC-DB-resident.
- Invite links replace open signup.
- Visibility (`private` / `shared`) is a separate layer from RBAC for shareable assets; visibility changes guarded by `asset:share`.
- System library data: `SYSTEM_TENANT_ID` + `SYSTEM_USER_ID`.

---

## System shape

```text
Browser (React SPA)                Backend (FastAPI)                 Data + Infra
+------------------------+         +------------------------+        +-------------------------+
| 22+ feature areas      |         | 33 route groups        |        | PostgreSQL (3 schemas,  |
| 18 Zustand stores      |         | provider + integration |        | ~80 tables)             |
| TanStack Query         | <-----> | layers                 |        | optional analytics DB   |
| api client + polling   |         | job worker + scheduler |        | Azure Blob Storage      |
| DataTable + UI prims   |         | reports v1/v2, reviews |        | Azure Container Apps    |
| ChatWidget (Sherlock)  |         | Sherlock + analytics   |        | Azure Container Registry|
+------------------------+         +------------------------+        +-------------------------+
            :5173 dev / :443 prod              :8721
```

### Postgres schemas (3)

- `platform` — tenants, users, identity, RBAC, apps, settings, evaluations, evaluators, library data, scheduler, sherlock runtime, tenant LLM providers.
- `analytics` — facts, aggregates, logs, dimensions, ref tables, cache.
- `orchestration` — workflows, versions, triggers, runs, recipient state, provider connections, cohort datasets, action templates.

Cross-schema FKs go FROM `orchestration` TO `platform`.

### Deploy targets

- **Local**: `docker-compose.yml` runs `postgres + backend + worker + frontend`.
- **Production**: Azure Container Apps. `ai-evals-be-prod` runs the backend image with `JOB_RUN_EMBEDDED_WORKER=True` (worker loop in-process). `ai-evals-fe-prod` runs the frontend. There is no separate worker container in prod today.

---

## Backend structure

### Route groups (33)

`auth`, `listings`, `files`, `evaluators`, `chat`, `chat_engine`, `history`, `settings`, `tags`, `jobs`, `evaluation_runs` (+ threads), `llm`, `llm_assist`, `adversarial_config`, `adversarial_test_cases`, `admin`, `admin_ai_settings`, `reports`, `report_builder` (+ v2), `inside_sales`, `apps`, `roles`, `rules`, `eval_templates`, `reviews`, `analytics_library`, `cost` (+ cost admin), `scheduled_jobs`, `orchestration_webhooks` (public), `orchestration`, `orchestration_connections`, `orchestration_datasets`, `orchestration_cohorts`.

`prompts` and `schemas` are ORM-backed resources managed through `/api/settings` and related surfaces (no standalone router).

### Schema + migrations

Alembic is the only schema truth. Migrations at `backend/alembic/versions/`. `alembic upgrade head` runs on every container boot via `backend/entrypoint.sh`. Baseline `0001_baseline_prod` is stamped on prod; fresh dev/CI applies end-to-end. There is no `startup_schema.py` and no bootstrap-create script. Every raw SQL string (`text(...)`, `op.execute(...)`, hand-written SQL in seeds) must schema-qualify (`platform.evaluators`, `analytics.fact_evaluation`, etc.).

### Lifespan boot order

`configure_logging → validate_startup_config → import job_worker → alembic check + sync_column_comments → manifest_validator → seed_all_defaults → seed_bootstrap_admin → validate_app_pack_ids → cleanup_expired_refresh_tokens → recover_stale_jobs (embedded worker only) → worker + recovery + scheduler-tick loops`.

### Seed defaults

Seed only platform-wide bootstrap: system tenant + user, Owner role, app records, default prompts/schemas, model pricing ref data, evaluator seed catalog, sherlock ontology. Per-tenant config / credentials / LLM defaults belong in DB inserts via admin UI or runbook SQL, NOT in seed files.

---

## Frontend structure

Top-level features under `src/features/`: `admin`, `analytics`, `auth`, `chat-widget`, `cost`, `credentialPool`, `csvImport`, `evalRuns`, `evals`, `export`, `guide`, `insideSales`, `kaira`, `kairaBotSettings`, `listings`, `orchestration`, `reportBuilder`, `reviews`, `settings`, `structured-outputs`, `transcript`, `upload`, `voiceRx`.

Shared layers: `src/services/api/client.ts` (HTTP), `src/services/api/jobPolling.ts` (`submitAndPollJob`), `src/config/routes.ts`, `src/components/ui/` (primitives + unified `DataTable`), `src/utils/cn.ts`, `src/utils/statusColors.ts`.

---

## Representative flows

### Voice Rx upload

```
upload -> POST /api/files
       -> listing creation
       -> POST /api/jobs (evaluate-voice-rx)
       -> worker claims
       -> transcription (audio) -> critique (text only)
       -> EvaluationRun + api_call_logs persist
       -> FE polls + navigates to run-detail
```

### Kaira batch

```
CSV import -> listing
           -> POST /api/jobs (evaluate-batch)
           -> worker iterates rows + evaluators
           -> thread results persist
           -> aggregate EvaluationRun
           -> populate-analytics -> analytics.fact_evaluation
```

### Inside Sales

```
sync-external-source -> crm_call_record + crm_lead_record + log_crm_source_sync
                     -> evaluate-inside-sales on resolved selection
                     -> scoring pipeline runs
                     -> EvaluationRun + call-level outputs
                     -> dashboards, reports, Sherlock consume
```

### Orchestration campaign

```
seeded workflow clone -> bind ProviderConnection
                     -> cron trigger or Run Now
                     -> run-workflow job
                     -> per-node steps + per-recipient state
                     -> dispatch action -> provider integration
                     -> webhook resume polling
                     -> log_clinical_action_outbox / crm logs
```

### Sherlock question

```
ChatWidget -> POST /api/report-builder/v2/chat/stream (SSE)
           -> turn_orchestrator opens sherlock_conversation_turn
           -> supervisor -> data_specialist.as_tool (submit_sql)
           -> bouncer + verified queries
           -> chart payload (typed) emits Vega-Lite spec
           -> FE branches on payload.kind
           -> sherlock_turn_events persist; chart binds into analytics_charts if saved
```

---

## Operational invariants

- API contract: backend `snake_case`; API JSON `camelCase` via `CamelModel` / `CamelORMModel`.
- LLM settings scope: global per tenant + user at `app_id=""`.
- Public routes: `/api/auth/*` and `/api/orchestration/webhooks/*` only. Everything else requires bearer auth + tenant filtering.
- File storage: `local` or `azure_blob`. Production = `azure_blob`.
- Analytics DB: `ANALYTICS_DATABASE_URL` if separate, else `DATABASE_URL`.
- Worker topology depends on deploy target. Prod single-container backend defaults `JOB_RUN_EMBEDDED_WORKER=true`. Local compose runs a dedicated worker with `JOB_RUN_EMBEDDED_WORKER=false`.

---

## New to the repo

Read in this order:

1. `README.md`
2. `docs/SETUP.md`
3. This file
4. `CLAUDE.md` (operational rules)
5. `backend/app/main.py` (startup + route registration)
6. `backend/app/services/job_worker.py` (execution behavior)
7. `src/services/api/jobPolling.ts` (FE async)
8. The workspace feature directory you are changing
