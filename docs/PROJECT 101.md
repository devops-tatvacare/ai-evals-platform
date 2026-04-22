# AI Evals Platform - Project 101

This is the primary product and architecture reference for the repository. Read it end to end if you are new to the codebase.

---

## WHAT THE PRODUCT IS

AI Evals Platform is a multi-tenant system for evaluating AI behavior in production workflows. It stores prompts, schemas, evaluators, runs, logs, reports, reviews, and analytics so teams can reproduce decisions instead of relying on one-off manual reviews.

The platform currently serves three app surfaces:

| Workspace | App ID | What it evaluates | Primary inputs |
| --- | --- | --- | --- |
| Voice Rx | `voice-rx` | Medical transcription and structured extraction quality | Audio files, transcripts, upload and API-based comparison flows |
| Kaira Bot | `kaira-bot` | Conversational AI quality | Chat sessions, CSV thread exports, adversarial cases |
| Inside Sales | `inside-sales` | AI-assisted sales call quality | LeadSquared call data and transcripts |

Across those workspaces, the platform provides:

- versioned prompts, schemas, and eval templates
- reusable evaluators (including per-app rules and saved adversarial test cases)
- background job execution with polling, cancellation, retries, and recovery
- a single `EvalRun` record for every evaluation outcome
- a review universe for human sign-off on runs
- a reporting pipeline with config/run/artifact persistence
- an analytics fact layer that powers dashboards and the Sherlock agent
- a cost tracking plane that records every LLM generation, resolves pricing, and rolls up spend per tenant, app, user, provider, and owner
- tenant-aware RBAC, invite links, and app-scoped access

---

## WHY IT EXISTS

### The problem

Teams using AI in production need more than a score. They need a system that can answer:

- What was evaluated?
- Which prompt, schema, and model configuration produced the result?
- Where exactly did the output fail?
- Can the same run be reproduced later?
- Can results be compared across time, evaluators, or workspaces?
- Can a human reviewer agree or disagree on a record-by-record basis?

That need is especially strong in the workflows represented here:

- clinical transcription, where segment-level mistakes matter
- conversational AI, where safety, compliance, and intent handling matter
- sales workflows, where teams need structured scorecards and trend reporting

### Product principles

1. Evidence beats intuition. Store the run, the configuration, and the logs.
2. Long work runs asynchronously. The UI should not own custom polling logic.
3. The frontend is a thin client. Business logic, persistence, and LLM calls live on the backend.
4. Multi-tenant rules are non-negotiable. Every data row belongs to a tenant.
5. Extensibility matters. New evaluators, reports, and analytics should fit the same primitives.
6. Analytics is downstream of evaluation. Fact tables are derived, not authored by hand.

---

## HOW THE PLATFORM WORKS

### Shared workflow

Most flows in the platform follow the same shape:

```text
1. Bring data in
   - upload a file
   - import CSV
   - pull from an external system (LeadSquared, Kaira)

2. Configure evaluation inputs
   - prompts
   - schemas
   - evaluator selection
   - LLM provider and model settings

3. Submit a background job
   - job row is created
   - frontend polls through submitAndPollJob()
   - worker claims and executes the job

4. Persist and review results
   - EvalRun is stored
   - dependent rows are written as needed
   - populate-analytics jobs fan out into fact tables
   - reviews, reports, and analytics consume the stored results
```

### Workspace: Voice Rx

Voice Rx evaluates medical transcription quality. It has two broad paths:

- upload-based transcription and critique
- API-oriented judge flows for structured extraction comparison

The core Voice Rx full evaluation pipeline is fixed:

```text
1. Transcription call
   - receives audio
   - uses Gemini with inline media via Part.from_bytes()
   - returns time-aligned transcript data

2. Critique call
   - text only
   - compares generated transcript against reference data
   - returns structured discrepancies via generate_json()

3. Server-side statistics
   - counts and aggregates are computed from stored records
   - the model is not trusted to self-report totals
```

That order is a hard invariant. Audio is never sent on the critique call.

### Workspace: Kaira Bot

Kaira Bot covers three major modes:

| Mode | Job type | Stored outcome |
| --- | --- | --- |
| Custom evaluator run | `evaluate-custom` / `evaluate-custom-batch` | `EvalRun` with `eval_type=custom` |
| Batch thread evaluation | `evaluate-batch` | aggregate `EvalRun` plus `thread_evaluations` rows |
| Adversarial evaluation | `evaluate-adversarial` | aggregate `EvalRun` plus `adversarial_evaluations` rows |

Kaira-specific supporting capabilities:

- a published per-app rules catalog via `/api/rules`
- saved adversarial test cases via `/api/adversarial-test-cases`
- a persona/trait axis for adversarial probes: persona describes who the user is (e.g., Moriarty), traits describe how they ask

### Workspace: Inside Sales

Inside Sales evaluates call quality using LeadSquared-backed data. The flow is:

```text
1. Pull or load call records
2. Submit evaluate-inside-sales jobs
3. Run the scoring pipeline on the backend
4. Persist run-level and call-level outputs
5. Review dashboards, scorecards, and reports
```

Inside Sales now has first-class source tables (`source_call_records`, `source_lead_records`, `source_sync_runs` — generic CRM-backed storage, tenant/app partitioned) so collection-serving endpoints do not depend on live LeadSquared availability during evaluation.

#### Inside Sales collection-serving contract

- **Serving endpoints:** `GET /api/inside-sales/calls`, `GET /api/inside-sales/leads`, `GET /api/inside-sales/agents`
- **Detail / refresh endpoints:** `GET /api/inside-sales/leads/{prospect_id}`, `GET /api/inside-sales/leads/{prospect_id}/detail`
- **Canonical selection surface:** `resolve_call_selection()` in the backend evaluation pipeline; `GET /api/inside-sales/calls?scope=all` is a temporary migration bridge
- **Sync model:** `sync-external-source` jobs write into source tables and produce `source_sync_runs` entries

### Reviews

The review universe (`eval_reviews`, `eval_review_items`, `/api/reviews`) lets human reviewers sign off on individual eval records. Reviews are first-class entities with their own routes and store. The frontend surface lives under `src/features/reviews/` and is orchestrated by `reviewModeStore`.

### Reports and analytics

Reporting sits on top of completed runs. The platform supports:

- per-run report generation with `generate-report` (legacy `reports` route)
- cross-run analytics generation with `generate-cross-run-report`
- evaluator drafting support with `generate-evaluator-draft`
- a v2 report builder pipeline with durable config/run/artifact rows (`report_configs`, `report_runs`, `report_artifacts`) and two routes: `/api/report-builder` and `/api/report-builder/v2`

Analytics is a separate domain backed by its own tables:

- `analytics_charts`, `analytics_dashboards` — chart and dashboard definitions
- `analytics_jobs` — analytics execution queue (coordinated with the generic job worker)
- `analytics_run_facts`, `analytics_eval_facts`, `analytics_criterion_facts` — derived fact tables
- `analytics_query_cache` — caching layer for repeat queries

Analytics facts are populated by `populate-analytics` jobs; request handlers never write facts directly. The analytics service can read from a separate database via `ANALYTICS_DATABASE_URL`, falling back to `DATABASE_URL` when unset.

### Sherlock (constrained analytics agent)

Sherlock is a bounded LLM agent that answers analytics questions over the fact tables. Its execution trace persists in dedicated runtime tables:

- `sherlock_runtime_sessions` — one row per user conversation
- `sherlock_runtime_turns` — one row per user/agent turn
- `sherlock_runtime_events` — tool invocations and intermediate state
- `agent_tool_logs` — structured log of tool calls and their results

Key properties:

- Sherlock sessions are per-tenant, per-user, per-app. Always filter runtime rows by that triple.
- Sherlock never writes to `eval_runs` or analytics fact tables. It only reads and optionally binds chart output into `analytics_charts`.
- Chat streaming is handled by `chat_engine` (routes: `/api/chat-engine`); the frontend surface is `src/features/chat-widget/`.

### Cost tracking

Cost tracking is the observability plane for LLM spend. It is independent of evaluation results but consumes the same execution flow: every model generation produced by `LoggingLLMWrapper` writes a single `llm_usage` row with provider, model, token counts, duration, correlation id, owner type/id, subsystem, and polymorphic ownership keys. Request handlers never write to the usage or rollup tables.

Supporting tables:

- `llm_usage` — append-only fact table of generation calls
- `model_pricing` / `model_aliases` — tenant-scoped pricing with alias resolution
- `llm_usage_daily_rollup` — daily aggregate rebuilt by `populate-cost-rollup` jobs
- `models_dev_catalog` / `models_dev_snapshot` — read-through cache of the models.dev catalog used for pricing refresh

Surfaces:

- User-facing routes under `/api/cost`: overview, spend, efficiency, entity drill-down, calls list, call detail, and pricing bundle
- Admin-facing routes under `/api/admin`: pricing edits, refresh, backfill-unpriced, and snapshot history
- Frontend: `src/features/cost/` with `costStore` and `src/services/api/costApi.ts`
- Non-app subsystems (Sherlock, report_builder, system_library) record usage with a populated `subsystem` field instead of an `app_id`

---

## CORE ABSTRACTIONS

### EvalRun is the center of the system

Every evaluation outcome lands in `eval_runs`. The `eval_type` field determines how to interpret the `result` payload.

```text
custom             single evaluator output
full_evaluation    Voice Rx full pipeline output
human              manual review / human-authored result
batch_thread       aggregate thread evaluation output
batch_adversarial  aggregate adversarial evaluation output
call_quality       inside-sales call evaluation output
```

Dependent detail rows hang off that core record:

```text
listings / chat_sessions
    -> eval_runs
        -> thread_evaluations
        -> adversarial_evaluations
        -> api_logs
        -> eval_review_items (via eval_reviews)
        -> analytics_*_facts (via populate-analytics)
```

### Jobs are the execution model

Long-running work is submitted as a job row and executed by the worker. The registered job types are:

| Job type | Purpose |
| --- | --- |
| `evaluate-voice-rx` | Voice Rx transcription and critique |
| `evaluate-custom` | Single custom evaluator run |
| `evaluate-custom-batch` | Batch custom evaluator execution |
| `evaluate-batch` | Thread batch evaluation |
| `evaluate-adversarial` | Adversarial testing |
| `evaluate-inside-sales` | Inside Sales scoring |
| `generate-report` | Single-run reporting |
| `generate-evaluator-draft` | Draft evaluator generation |
| `generate-cross-run-report` | Cross-run analytics reporting |
| `sync-external-source` | Pull upstream data (LeadSquared, Kaira) into source tables |
| `populate-analytics` | Fan out stored runs into analytics fact tables |
| `populate-cost-rollup` | Rebuild `llm_usage_daily_rollup` for a date range |

The queue layer supports more than simple FIFO processing. `job_worker.py` includes:

- queue classes: `interactive`, `standard`, `bulk`, `analytics`
- priorities
- retry scheduling for retry-safe job types
- leases and heartbeats
- per-tenant, per-app, per-user concurrency controls
- stale job and orphaned run recovery

### Provider layer

All model calls go through `backend/app/services/evaluators/llm_base.py`. Current providers:

| Provider | Notes |
| --- | --- |
| Gemini | Supports API key and service-account auth; uses `Part.from_bytes()` for Vertex media |
| OpenAI | API-key based |
| Azure OpenAI | Endpoint plus deployment configuration |
| Anthropic | API-key based |

Important Gemini rules:

- Vertex AI media uses `Part.from_bytes()`, not file uploads
- disabling thinking means omitting `thinking_config`
- model family 2.5 uses `thinking_budget`
- model family 3+ uses `thinking_level`

### Stores are frontend caches

The React app uses 17 Zustand stores:

`authStore`, `appStore`, `appSettingsStore`, `llmSettingsStore`, `globalSettingsStore`, `listingsStore`, `evaluatorsStore`, `evalTemplatesStore`, `chatStore`, `uiStore`, `miniPlayerStore`, `taskQueueStore`, `jobTrackerStore`, `crossRunStore`, `insideSalesStore`, `reviewModeStore`, `costStore`

These stores cache backend state. PostgreSQL is the source of truth.

### Tenant and RBAC model

Every row belongs to a tenant. Access control is enforced through:

- bearer-token auth on all non-auth routes
- `AuthContext` on protected backend routes
- roles, role permissions, and role app access
- a backend-owned permission catalog exposed to admin role tooling via `/api/admin/permission-catalog`
- owner-only surfaces that stay outside the grantable catalog, such as role lifecycle and tenant configuration
- invite links instead of open signup

Visibility is a separate layer from RBAC for shareable assets. The canonical visibility states are `private` and `shared`, and visibility-changing operations are guarded by `asset:share` rather than by generic edit permissions.

System-owned library data is stored under the well-known system tenant and system user IDs.

---

## SYSTEM ARCHITECTURE

```text
Browser (React SPA)                      Backend (FastAPI)                      Data / Infra
+-----------------------------------+    +-----------------------------------+  +-----------------------------+
| 22 feature areas                  |    | 26 route groups                   |  | PostgreSQL (55 tables)      |
| 17 Zustand stores                 |    | provider layer                    |  | optional analytics DB       |
| api client + jobPolling.ts        |<-->| job worker + analytics populator  |  | Azure Blob or local files   |
| DataTable + UI primitives         |    | reports v1/v2, reviews, Sherlock  |  | Azure App Service / Docker  |
| routes + Sherlock chat widget     |    | evaluators, auth, RBAC, cost      |  | ACR + GitHub Actions        |
+-----------------------------------+    +-----------------------------------+  +-----------------------------+
            :5173 dev / :80 prod                      :8721
```

### Production service shape

`docker-compose.prod.yml` runs:

- `frontend`
- `backend`
- `worker`

There is no `postgres` container in production. Production uses Azure Database for PostgreSQL instead.

### Local development service shape

`docker-compose.yml` runs:

- `postgres`
- `backend`
- `worker`
- `frontend`

Both local and production container stacks use a dedicated worker process by setting `JOB_RUN_EMBEDDED_WORKER=false`.

If you run the backend directly with Uvicorn outside Docker, the default config enables the embedded worker unless you disable it.

---

## FRONTEND STRUCTURE

Top-level feature areas under `src/features/`:

| Feature area | Responsibility |
| --- | --- |
| `admin` | Tenant, user, and operational admin surfaces |
| `analytics` | Dashboards, charts, and summary views |
| `auth` | Login and signup flow |
| `chat-widget` | Sherlock chat surface and chart binding UI |
| `cost` | LLM spend dashboards, pricing admin, and calls drill-down |
| `credentialPool` | Credential management UI |
| `csvImport` | CSV ingestion flows |
| `evalRuns` | Run list and run-detail flows |
| `evals` | Evaluation-centric shared UI |
| `export` | Export actions and report outputs |
| `guide` | In-app guide and reference views |
| `insideSales` | Inside Sales workspace |
| `kaira` | Kaira Bot workspace |
| `kairaBotSettings` | Kaira-specific settings and tag management |
| `listings` | Listing management |
| `reportBuilder` | Report v2 builder surface |
| `reviews` | Human review of eval runs |
| `settings` | Global app settings, prompts, schemas, evaluators |
| `structured-outputs` | Structured output viewers and helpers |
| `transcript` | Transcript display and review |
| `upload` | Upload and validation flows |
| `voiceRx` | Voice Rx workspace |

Important shared frontend layers:

- `src/services/api/client.ts` for HTTP
- `src/services/api/jobPolling.ts` for async job lifecycle handling
- `src/config/routes.ts` for route construction
- `src/components/ui/` for primitives, including the unified `DataTable`
- `src/utils/cn.ts` for class merging

---

## BACKEND STRUCTURE

### Route groups

The backend currently registers 26 route groups:

`auth`, `listings`, `files`, `evaluators`, `chat`, `chat_engine`, `history`, `settings`, `tags`, `jobs`, `eval_runs` (+ `threads`), `llm`, `adversarial_config`, `adversarial_test_cases`, `admin`, `reports`, `report_builder` (+ `v2`), `inside_sales`, `apps`, `roles`, `rules`, `eval_templates`, `reviews`, `analytics_library`, `cost` (+ cost admin)

`prompts` and `schemas` are ORM-backed resources but do not have standalone routers; they are managed through `/api/settings` and related surfaces.

### ORM tables

The SQLAlchemy model layer currently defines 55 tables across six domains:

- **Core platform:** `tenants`, `users`, `refresh_tokens`, `invite_links`, `apps`, `tenant_configs`, `audit_log`, `api_logs`, `jobs`, `files`
- **Evaluation:** `listings`, `prompts`, `schemas`, `evaluators`, `eval_templates`, `eval_runs`, `thread_evaluations`, `adversarial_evaluations`, `adversarial_test_cases`, `tags`, `history`, `settings`, `evaluation_analytics`, `chat_sessions`, `chat_messages`, `external_agents`, `lsq_lead_cache`
- **RBAC:** `roles`, `role_app_access`, `role_permissions`
- **Generic CRM-backed source records (Inside Sales first consumer):** `source_call_records`, `source_lead_records`, `source_sync_runs`
- **Reports / reviews / analytics / agent runtime:** `report_configs`, `report_runs`, `report_artifacts`, `eval_reviews`, `eval_review_items`, `analytics_charts`, `analytics_dashboards`, `analytics_jobs`, `analytics_query_cache`, `analytics_run_facts`, `analytics_eval_facts`, `analytics_criterion_facts`, `agent_tool_logs`, `sherlock_runtime_sessions`, `sherlock_runtime_turns`, `sherlock_runtime_events`
- **Cost tracking:** `llm_usage`, `model_pricing`, `model_aliases`, `llm_usage_daily_rollup`, `models_dev_catalog`, `models_dev_snapshot`

### Startup and seeding

`backend/app/main.py` does several important things at startup:

1. validates critical config
2. creates tables
3. applies safe one-time migrations, including legacy visibility normalization and legacy `role_permissions` rewrites to canonical permission IDs
4. seeds defaults
5. bootstraps the first admin if needed
6. starts recovery and worker loops when embedded execution is enabled

### Seeded defaults

`seed_defaults.py` seeds:

- system tenant, system user, and the Owner system role
- app records for `voice-rx`, `kaira-bot`, and `inside-sales`
- default prompts and schemas

The Owner role is intentionally outside the grantable permission catalog. It retains full access through owner-only bypass semantics instead of through seeded grantable permissions.

Evaluators are not auto-seeded on startup. They must be seeded separately per app.

---

## REPRESENTATIVE DATA FLOWS

### Voice Rx upload evaluation

```text
file upload
 -> POST /api/files
 -> listing creation
 -> POST /api/jobs (evaluate-voice-rx)
 -> worker claims the job
 -> transcription call with audio
 -> critique call with text only
 -> EvalRun + ApiLog rows persist
 -> frontend polls job status and navigates to run detail
```

### Kaira batch evaluation

```text
CSV import
 -> listing or thread source creation
 -> POST /api/jobs (evaluate-batch)
 -> worker iterates rows and evaluators
 -> thread_evaluations rows persist
 -> aggregate EvalRun persists
 -> populate-analytics job fans facts into analytics_*_facts
 -> reports or Sherlock queries can consume the results
```

### Kaira adversarial workflow

```text
configure adversarial settings, personas, and saved test cases
 -> submit evaluate-adversarial
 -> worker executes adversarial probe sequence
 -> adversarial_evaluations rows persist
 -> aggregate EvalRun persists
```

### Inside Sales workflow

```text
sync-external-source job pulls LeadSquared data into source tables
 -> submit evaluate-inside-sales on mirrored selection
 -> scoring pipeline runs
 -> EvalRun and supporting outputs persist
 -> dashboards, reports, and Sherlock consume the stored results
```

### Sherlock analytics question

```text
user opens chat-widget
 -> POST /api/chat-engine creates sherlock_runtime_session
 -> each turn persists sherlock_runtime_turns + sherlock_runtime_events
 -> tool calls log into agent_tool_logs
 -> chart output binds into analytics_charts when surfaced
```

---

## OPERATIONAL CONVENTIONS

### API contract

Backend code uses `snake_case`. API JSON uses `camelCase` through the Pydantic schema layer.

### LLM settings scope

LLM settings are global per tenant and user, stored with `app_id=""`. App-specific settings use the actual app ID.

### Frontend async rule

Components should not own their own job polling loops. They must use `submitAndPollJob()`.

### Backend auth rule

`/api/auth/*` routes are the only public routes. Everything else requires bearer auth and tenant-aware filtering.

### File storage modes

The backend supports:

- `local`
- `azure_blob`

### Analytics database

By default the analytics service reads from the primary database. Setting `ANALYTICS_DATABASE_URL` routes analytics reads and fact writes to a separate Postgres instance, which is the intended production topology when analytics volume grows.

---

## IF YOU ARE NEW TO THE REPO

Start in this order:

1. `README.md` for a quick orientation
2. `docs/SETUP.md` for local or production setup
3. `backend/app/main.py` for startup and route registration
4. `backend/app/services/job_worker.py` for execution behavior
5. `src/services/api/jobPolling.ts` for frontend async orchestration
6. the workspace feature directory you are changing
