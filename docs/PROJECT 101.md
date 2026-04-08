# AI Evals Platform - Project 101

This is the primary product and architecture reference for the repository. Read it end to end if you are new to the codebase.

---

## WHAT THE PRODUCT IS

AI Evals Platform is a multi-tenant system for evaluating AI behavior in production workflows. It stores prompts, schemas, evaluators, runs, logs, and reports so teams can reproduce decisions instead of relying on one-off manual reviews.

The platform currently serves three app surfaces:

| Workspace | App ID | What it evaluates | Primary inputs |
| --- | --- | --- | --- |
| Voice Rx | `voice-rx` | Medical transcription and structured extraction quality | Audio files, transcripts, upload and API-based comparison flows |
| Kaira Bot | `kaira-bot` | Conversational AI quality | Chat sessions, CSV thread exports, adversarial cases |
| Inside Sales | `inside-sales` | AI-assisted sales call quality | LeadSquared call data and transcripts |

Across those workspaces, the platform provides:

- versioned prompts and schemas
- reusable evaluators
- background job execution with polling, cancellation, retries, and recovery
- a single `EvalRun` record for every evaluation outcome
- exported reports and cross-run analytics
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

That need is especially strong in the workflows represented here:

- clinical transcription, where segment-level mistakes matter
- conversational AI, where safety, compliance, and intent handling matter
- sales workflows, where teams need structured scorecards and trend reporting

### Product principles

1. Evidence beats intuition. Store the run, the configuration, and the logs.
2. Long work runs asynchronously. The UI should not own custom polling logic.
3. The frontend is a thin client. Business logic, persistence, and LLM calls live on the backend.
4. Multi-tenant rules are non-negotiable. Every data row belongs to a tenant.
5. Extensibility matters. New evaluators and reports should fit the same primitives.

---

## HOW THE PLATFORM WORKS

### Shared workflow

Most flows in the platform follow the same shape:

```text
1. Bring data in
   - upload a file
   - import CSV
   - pull from an external system

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
   - reports and analytics can be generated later
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

Kaira-specific supporting capabilities now also include:

- a published per-app rules catalog via `/api/rules`
- saved adversarial test cases via `/api/adversarial-test-cases`

### Workspace: Inside Sales

Inside Sales evaluates call quality using LeadSquared-backed data. The flow is:

```text
1. Pull or load call records
2. Submit evaluate-inside-sales jobs
3. Run the scoring pipeline on the backend
4. Persist run-level and call-level outputs
5. Review dashboards, scorecards, and reports
```

#### Inside Sales collection-serving contract

Phase 1 defines the boundary for source-backed collection surfaces before mirror
tables land:

- **Serving endpoints:** `GET /api/inside-sales/calls`, `GET /api/inside-sales/leads`, `GET /api/inside-sales/agents`
- **Detail / refresh endpoints:** `GET /api/inside-sales/leads/{prospect_id}`, `GET /api/inside-sales/leads/{prospect_id}/detail`
- **Canonical selection surface:** `resolve_call_selection()` in the backend evaluation pipeline; `GET /api/inside-sales/calls?scope=all` is only a temporary bridge and should not define the long-term serving model

| Collection | Record identity | Filter set | Sort semantics | Pagination / total semantics | Freshness semantics |
| --- | --- | --- | --- | --- | --- |
| Calls | `activity_id` | `date_from`, `date_to`, `agents`, `prospect_id`, `direction`, `status`, `duration_min`, `duration_max`, `has_recording`, `event_codes` | Newest first by `callStartTime`, fallback `createdOn` | Filters resolve before pagination; totals stay exact over the filtered dataset; `scope=all` is migration-only | Live upstream today; mirror-backed with explicit freshness metadata after cutover |
| Leads | `prospect_id` | `date_from`, `date_to`, `agents`, `stage`, `mql_min`, `condition`, `city`, `prospect_id` | Current behavior preserves resolver/upstream order; no client-selectable sort is advertised yet | Filters resolve before pagination; totals stay exact over the filtered dataset | Live upstream today; mirror-backed with explicit freshness metadata after cutover |

First Postgres serving cutover set:

- `GET /api/inside-sales/calls`
- `GET /api/inside-sales/leads`
- `GET /api/inside-sales/agents`

Migration notes:

- Keep `CallListResponse`, `LeadListResponse`, and `AgentListResponse` stable while the serving source moves behind the routes.
- Preserve exact filtered totals and filter-before-pagination semantics when query execution moves into SQL.
- Keep lead lookup and lead drilldown flows outside the collection-serving cutover until a dedicated mirror-backed detail path is defined.
- Remove `scope=all` from interactive list-serving responsibility once canonical selection flows are fully isolated.

### Reports and analytics

Reporting sits on top of completed runs. The platform supports:

- per-run report generation with `generate-report`
- cross-run analytics generation with `generate-cross-run-report`
- evaluator drafting support with `generate-evaluator-draft`

Generated report content is cached in `evaluation_analytics`.

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

The queue layer now supports more than simple FIFO processing. `job_worker.py` includes:

- queue classes: `interactive`, `standard`, `bulk`
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

The React app uses 16 Zustand stores:

`authStore`, `appStore`, `appSettingsStore`, `llmSettingsStore`, `globalSettingsStore`, `listingsStore`, `schemasStore`, `promptsStore`, `evaluatorsStore`, `chatStore`, `uiStore`, `miniPlayerStore`, `taskQueueStore`, `jobTrackerStore`, `crossRunStore`, `insideSalesStore`

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
| 18 feature areas                  |    | 22 route groups                   |  | PostgreSQL (29 tables)      |
| 16 Zustand stores                 |    | provider layer                    |  | Azure Blob or local files   |
| api client + jobPolling.ts        |<-->| job worker and recovery loops     |  | Azure App Service / Docker  |
| route constants + UI primitives   |    | reports, evaluators, auth, RBAC   |  | ACR + GitHub Actions        |
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
| `analytics` | Dashboards and summary views |
| `auth` | Login and signup flow |
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
| `settings` | Global app settings, prompts, schemas, evaluators |
| `structured-outputs` | Structured output viewers and helpers |
| `transcript` | Transcript display and review |
| `upload` | Upload and validation flows |
| `voiceRx` | Voice Rx workspace |

Important shared frontend layers:

- `src/services/api/client.ts` for HTTP
- `src/services/api/jobPolling.ts` for async job lifecycle handling
- `src/config/routes.ts` for route construction
- `src/components/ui/` for primitives
- `src/utils/cn.ts` for class merging

---

## BACKEND STRUCTURE

### Route groups

The backend currently registers 22 route groups:

`auth`, `listings`, `files`, `prompts`, `schemas`, `evaluators`, `chat`, `history`, `settings`, `tags`, `jobs`, `eval_runs`, `threads`, `llm`, `adversarial_config`, `adversarial_test_cases`, `admin`, `reports`, `inside_sales`, `apps`, `roles`, `rules`

### ORM tables

The SQLAlchemy model layer currently defines 29 tables:

`tenants`, `users`, `refresh_tokens`, `listings`, `eval_runs`, `thread_evaluations`, `adversarial_evaluations`, `api_logs`, `tags`, `prompts`, `lsq_lead_cache`, `jobs`, `schemas`, `chat_sessions`, `chat_messages`, `audit_log`, `evaluation_analytics`, `files`, `invite_links`, `external_agents`, `apps`, `tenant_configs`, `adversarial_test_cases`, `evaluators`, `history`, `settings`, `roles`, `role_app_access`, `role_permissions`

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
 -> reports can be generated later
```

### Kaira adversarial workflow

```text
configure adversarial settings and saved test cases
 -> submit evaluate-adversarial
 -> worker executes adversarial probe sequence
 -> adversarial_evaluations rows persist
 -> aggregate EvalRun persists
```

### Inside Sales workflow

```text
load LeadSquared data
 -> submit evaluate-inside-sales
 -> scoring pipeline runs
 -> EvalRun and supporting outputs persist
 -> dashboards and reports consume the stored results
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

---

## IF YOU ARE NEW TO THE REPO

Start in this order:

1. `README.md` for a quick orientation
2. `docs/SETUP.md` for local or production setup
3. `backend/app/main.py` for startup and route registration
4. `backend/app/services/job_worker.py` for execution behavior
5. `src/services/api/jobPolling.ts` for frontend async orchestration
6. the workspace feature directory you are changing
