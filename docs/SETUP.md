# AI Evals Platform Setup

This document is the operational setup guide for the repository. It is based on the current code and deployment files, not on older assumptions. Where `.env.backend.example` is shorter than the real configuration surface, treat `backend/app/config.py` plus the compose files as ground truth.

---

## 1. Deployment shape at a glance

### Local development

`docker-compose.yml` runs four services:

| Service | Port | Purpose |
| --- | --- | --- |
| `postgres` | 5432 | Local PostgreSQL database |
| `backend` | 8721 | FastAPI API |
| `worker` | none | Dedicated background job worker |
| `frontend` | 5173 | React development server |

### Production

`docker-compose.prod.yml` runs three services:

| Service | Port | Purpose |
| --- | --- | --- |
| `frontend` | 80 | nginx serving the SPA and proxying `/api/*` |
| `backend` | 8721 | FastAPI API |
| `worker` | none | Dedicated background job worker |

Production does not run PostgreSQL in the compose stack. It expects Azure Database for PostgreSQL and Azure Blob Storage.

---

## 2. Local development with Docker

### Prerequisites

- Docker Desktop
- Git
- Node.js if you also want to run frontend tooling outside Docker
- Python 3.12 with the project virtualenv if you also want to run backend tooling outside Docker
- At least one usable LLM configuration:
  - Gemini API key
  - OpenAI API key
  - Azure OpenAI credentials
  - Anthropic API key
  - or Gemini Vertex AI service account credentials

### Step 1: clone and enter the repository

```bash
git clone <repo-url>
cd ai-evals-platform
```

### Step 2: create the backend env file

```bash
cp .env.backend.example .env.backend
```

`.env.backend.example` is a starter file, not a full manifest. The complete variable reference is in section 6 below.

Minimum values to set before first run:

```env
JWT_SECRET=<random-64-char-hex>
DEFAULT_LLM_PROVIDER=gemini
```

You also need one usable provider configuration, for example:

```env
GEMINI_API_KEY=<your-key>
```

or:

```env
OPENAI_API_KEY=<your-key>
OPENAI_MODEL=<model-name>
DEFAULT_LLM_PROVIDER=openai
```

### Step 3: provide `service-account.json` if needed

The local compose stack mounts `./service-account.json` into both the `backend` and `worker` containers.

- If you use Gemini on Vertex AI with the Docker stack, place the real service account JSON at the repo root and set `GEMINI_SERVICE_ACCOUNT_PATH=/app/service-account.json`.
- If you run the backend directly outside Docker, use the local filesystem path instead.
- If you are not using Vertex AI locally, a placeholder file is enough:

```bash
touch service-account.json
```

### Step 4: start the stack

```bash
docker compose up --build
```

### Step 5: verify the services

| Service | URL / Port | Expected behavior |
| --- | --- | --- |
| Frontend | http://localhost:5173 | UI loads |
| Backend | http://localhost:8721/api/health | returns `{"status":"ok","database":"connected"}` |
| PostgreSQL | localhost:5432 | accepts local DB connections |
| Worker | container only | claims and runs jobs separately from the API |

### Common local commands

```bash
docker compose down
docker compose down -v
docker compose logs -f backend worker
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform
npm run dev:stack
npm run sync:guide
```

### First login

On the first startup against an empty database, the backend can bootstrap an admin user from:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_TENANT_NAME`

Those values are only used when there are no users in the database yet.

---

## 3. Local development without Docker

### Backend only

```bash
pyenv activate venv-python-ai-evals-arize
pip install -r backend/requirements.txt
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
```

With the default config, running `uvicorn` directly starts the embedded worker inside the API process.

If you want parity with the containerized setup, disable the embedded worker and run the dedicated worker process:

```bash
export JOB_RUN_EMBEDDED_WORKER=false
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
PYTHONPATH=backend python -m app.worker
```

### Frontend only

```bash
npm install
npm run dev
```

---

## 4. Production setup on Azure

### Production architecture

The repository is currently wired for:

- Azure App Service running `docker-compose.prod.yml`
- Azure Container Registry for images
- Azure Database for PostgreSQL for application data
- Azure Blob Storage for file storage

### Azure resources to provision

| Resource | Purpose |
| --- | --- |
| App Service (Linux, multi-container) | Runs `frontend`, `backend`, and `worker` |
| Azure Container Registry | Stores `evals-frontend` and `evals-backend` images |
| Azure Database for PostgreSQL | Primary database |
| Azure Blob Storage | Uploaded files |
| Key Vault | Recommended for secret storage |

### CI/CD trigger

Deployments are tag-triggered:

```bash
git tag v1.2.0
git push origin v1.2.0
```

The current workflow in `.github/workflows/deploy.yml`:

1. builds the backend image from `backend/Dockerfile.prod`
2. builds the frontend image from `Dockerfile.frontend.prod`
3. pushes both images to ACR with the git tag and `latest`
4. deploys `docker-compose.prod.yml` to Azure App Service

### GitHub secrets used by the current workflow

| Secret | Used for |
| --- | --- |
| `AZURE_CREDENTIALS` | Azure login in GitHub Actions |
| `ACR_LOGIN_SERVER` | image names and registry login |
| `ACR_USERNAME` | registry login |
| `ACR_PASSWORD` | registry login |
| `AZURE_WEBAPP_NAME` | target App Service name |

`AZURE_RESOURCE_GROUP` is useful for manual Azure CLI commands but is not used by the current GitHub Actions workflow.

### Production runtime notes

- `frontend` listens on port 80.
- nginx proxies `/api/*` to `backend:8721`.
- `worker` runs `python -m app.worker`.
- `JOB_RUN_EMBEDDED_WORKER` should stay `false` in containerized production because there is a dedicated worker service.
- `FILE_STORAGE_TYPE` should be `azure_blob` in production.

---

## 5. Post-deploy checks

### Health check

```bash
curl "https://<your-app>.azurewebsites.net/api/health"
```

Expected response:

```json
{"status":"ok","database":"connected"}
```

### First access checklist

1. log in with the bootstrap admin credentials
2. seed default evaluators per app if needed
3. create roles and app access rules
4. generate invite links
5. rotate the bootstrap admin password

Evaluator seeding endpoints:

```text
POST /api/evaluators/seed-defaults?appId=voice-rx
POST /api/evaluators/seed-defaults?appId=kaira-bot
POST /api/evaluators/seed-defaults?appId=inside-sales
```

---

## 6. Environment variable reference

This section is the complete reference for the current configuration surface. It includes variables from `backend/app/config.py` and additional runtime or deploy-time variables referenced by `docker-compose.prod.yml` and `backend/entrypoint.sh`.

### Core application settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform` | Primary database connection string |
| `ANALYTICS_DATABASE_URL` | empty | Optional separate analytics database. Falls back to `DATABASE_URL` when empty |
| `FILE_STORAGE_TYPE` | `local` | `local` or `azure_blob` |
| `FILE_STORAGE_PATH` | `./backend/uploads` | Local upload directory |
| `API_PORT` | `8721` | Backend listen port |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `APP_BASE_URL` | `http://localhost:5173` | Public base URL used in generated links |

### File storage and upload controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_STORAGE_CONNECTION_STRING` | empty | Blob Storage connection string |
| `AZURE_STORAGE_CONTAINER` | `evals-files` | Blob container name |
| `MAX_UPLOAD_SIZE_MB` | `100` | Upload size limit |
| `ALLOWED_UPLOAD_MIMES` | built-in comma-separated list | Allowed upload MIME types |

### Provider and model settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEFAULT_LLM_PROVIDER` | `gemini` | Default provider selection |
| `EVAL_TEMPERATURE` | `0.1` | Evaluation temperature |
| `GEMINI_API_KEY` | empty | Gemini API key |
| `GEMINI_AUTH_METHOD` | `api_key` | `api_key` or `service_account` |
| `GEMINI_SERVICE_ACCOUNT_PATH` | empty | Local path to service account JSON |
| `GEMINI_MODEL` | empty | Default Gemini model |
| `OPENAI_API_KEY` | empty | OpenAI API key |
| `OPENAI_MODEL` | empty | Default OpenAI model |
| `AZURE_OPENAI_API_KEY` | empty | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | empty | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_VERSION` | `2025-03-01-preview` | Azure OpenAI API version |
| `AZURE_OPENAI_MODEL` | empty | Azure OpenAI deployment name |
| `ANTHROPIC_API_KEY` | empty | Anthropic API key |
| `ANTHROPIC_MODEL` | empty | Default Anthropic model |

### Auth and bootstrap settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | empty | Required secret for JWT signing |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access-token lifetime |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh-token lifetime |
| `ADMIN_EMAIL` | empty | Bootstrap admin email |
| `ADMIN_PASSWORD` | empty | Bootstrap admin password |
| `ADMIN_TENANT_NAME` | empty | Bootstrap tenant name |
| `ADMIN_TENANT_ALLOWED_DOMAINS` | empty | Comma-separated allowed signup domains |
| `AUTH_RATE_LIMIT` | `10/minute` | Rate limit for login, signup, and refresh |
| `COST_PRICING_REFRESH_RATE_LIMIT` | `5/minute;50/hour` | Rate limit for the `/api/admin/cost/pricing/refresh` endpoint |

### Kaira and adversarial settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAIRA_API_URL` | empty | Kaira API base URL |
| `KAIRA_AUTH_TOKEN` | empty | Kaira auth token |
| `KAIRA_TEST_USER_ID` | empty | Test user ID used by Kaira flows |
| `ADVERSARIAL_MAX_TURNS` | `10` | Max turns per adversarial conversation |
| `ADVERSARIAL_TURN_DELAY` | `1.5` | Delay between adversarial turns |
| `ADVERSARIAL_CASE_DELAY` | `3.0` | Delay between adversarial cases |

### Inside Sales integration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LSQ_BASE_URL` | empty | LeadSquared API base URL |
| `LSQ_ACCESS_KEY` | empty | LeadSquared access key |
| `LSQ_SECRET_KEY` | empty | LeadSquared secret key |

### Job worker settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `JOB_MAX_CONCURRENT` | `12` | Global worker concurrency ceiling |
| `JOB_POLL_INTERVAL_SECONDS` | `1.0` | Poll interval for worker loop |
| `JOB_HEARTBEAT_INTERVAL_SECONDS` | `15.0` | Lease heartbeat cadence |
| `JOB_LEASE_SECONDS` | `60` | Lease duration |
| `JOB_STALE_TIMEOUT_MINUTES` | `30` | Stale job recovery threshold |
| `JOB_MAX_ATTEMPTS` | `3` | Default retry budget |
| `JOB_RETRY_BASE_DELAY_SECONDS` | `5` | Backoff base delay |
| `JOB_RETRY_MAX_DELAY_SECONDS` | `120` | Backoff cap |
| `JOB_TENANT_MAX_CONCURRENT` | `8` | Per-tenant concurrency cap |
| `JOB_APP_MAX_CONCURRENT` | `5` | Per-app concurrency cap |
| `JOB_USER_MAX_CONCURRENT` | `3` | Per-user concurrency cap |
| `JOB_INTERACTIVE_MAX_CONCURRENT` | `0` | Interactive queue cap; `0` means inherit global cap |
| `JOB_STANDARD_MAX_CONCURRENT` | `0` | Standard queue cap; `0` means inherit global cap |
| `JOB_BULK_MAX_CONCURRENT` | `4` | Bulk queue cap |
| `JOB_ANALYTICS_MAX_CONCURRENT` | `1` | Analytics queue cap (populate-analytics, sync-external-source) |
| `JOB_CLAIM_WINDOW_MULTIPLIER` | `10` | Candidate claim window multiplier |
| `JOB_CLAIM_WINDOW_MAX` | `100` | Candidate claim window cap |
| `JOB_RUN_EMBEDDED_WORKER` | `true` | Run worker in-process when not using a dedicated worker service |

### Logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Log level used by `app/logging_config.py` |
| `LOG_FORMAT` | `json` | `json` for structured logs or `console` for human-readable output |

### Production-only or deploy-time variables

| Variable | Where it is used | Purpose |
| --- | --- | --- |
| `GEMINI_SERVICE_ACCOUNT_JSON` | `docker-compose.prod.yml`, `backend/entrypoint.sh` | Base64-encoded service account JSON decoded to `/app/service-account.json` at startup |
| `ACR_LOGIN_SERVER` | `.github/workflows/deploy.yml`, `docker-compose.prod.yml` | ACR hostname used in image references |
| `IMAGE_TAG` | `.github/workflows/deploy.yml`, `docker-compose.prod.yml` | Deploy tag used for image selection |

---

## 7. Production-specific configuration checklist

For Azure App Service, make sure these runtime values are set before the first deploy:

- `DATABASE_URL`
- `FILE_STORAGE_TYPE=azure_blob`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `CORS_ORIGINS`
- `APP_BASE_URL`
- `JWT_SECRET`
- bootstrap admin values if you want first-run bootstrap
- provider credentials for the model stack you plan to use
- `JOB_RUN_EMBEDDED_WORKER=false`

If you are using Gemini through Vertex AI in production, also set:

- `GEMINI_AUTH_METHOD=service_account`
- `GEMINI_SERVICE_ACCOUNT_JSON=<base64-encoded-json>`

---

## 8. Useful commands

```bash
# Frontend
npm run dev
npm run build
npm run lint
npx tsc -b

# Local stack
docker compose up --build
docker compose down
docker compose logs -f backend worker

# Backend only
pyenv activate venv-python-ai-evals-arize
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
PYTHONPATH=backend python -m app.worker
```

---

## 9. Orchestration — Tenant Rollout (Connections-driven, Phase 10)

Provider credentials are now tenant-owned, per-account, and configured via
the in-app **Connections** page — env vars are honoured only as a one-time
bootstrap on first boot. To enable the seeded "Default MQL Concierge"
workflow for a tenant:

1. **Set the encryption key.** A single process-level Fernet key is
   required. Generate with `python -c "from cryptography.fernet import
   Fernet; print(Fernet.generate_key().decode())"` and set
   `ORCHESTRATION_CONNECTION_KEY=<base64 fernet key>` on the backend.
   Treat with the same rigor as `JWT_SECRET` — losing it makes every
   stored connection unreadable.
2. **(Optional) Set `ORCHESTRATION_PUBLIC_BASE_URL`** to your backend
   origin (e.g. `https://api.example.com`). Used to compose full
   webhook URLs in the connections list. Without it, the UI shows a
   relative path the operator can prepend manually.
3. **Open the Connections page** at
   `/inside-sales/orchestration/connections`. Create one connection per
   provider you intend to use:
   - **Bolna** — paste `api_key`, `base_url` (default
     `https://api.bolna.ai`), and your `from_phone`. The connection's
     **Webhook URL** is shown as a copy-to-clipboard button — paste it
     into your Bolna dashboard so call-end events route back to this
     tenant.
   - **WATI** — paste `base_url`, `wati_tenant_id`, `api_token`. Copy the
     webhook URL into your WATI dashboard.
   - **LeadSquared** — paste `access_key`, `secret_key`, `region_host`.
     LSQ is outbound-only; no webhook URL is generated.
   - **MSG91 / AiSensy** — fill the matching fields when needed.
   Click **Test** on each row to verify credentials before publishing.
4. **Clone the seeded workflow:**
   ```bash
   POST /api/orchestration/workflows/clone
   {
     "sourceWorkflowId": "<system mql-concierge-default workflow id>",
     "newSlug": "<tenant-prefix>-concierge",
     "newName": "<Tenant> Concierge",
     "targetAppId": "inside-sales"
   }
   ```
   (or use the UI: Campaigns → row with **Platform** badge → **Clone for
   Tenant**.) The clone strips any system-owned `connection_id`s; if any
   were stripped the cloned workflow lands as a draft with rebind-required
   fields highlighted in the builder.
5. **Bind connections in the builder.** Open the cloned workflow, click
   each `crm.*` node, and pick the matching connection from the
   **Connection** combobox in the inspector. For Bolna calls and WATI
   sends, expand the **Variable mappings** field to bind agent variables
   to recipient payload fields or static values.
6. **Configure WATI templates** in your Meta-approved WATI dashboard —
   names must match the seeded `template_name` values
   (`concierge_priority_v1`, `concierge_qualify_v1`,
   `concierge_nurture_v1`).
7. **Add a cron trigger** to the cloned workflow: `0 9 * * *` for daily
   9 AM IST runs.
8. **Test:** click **Run Now** on the workflow, watch the run-detail
   page via the live SSE canvas, and verify recipients move through the
   pipeline.

> **Deprecation note.** Pre-Phase-10 env vars
> (`BOLNA_API_KEY`, `BOLNA_BASE_URL`, `BOLNA_WEBHOOK_SECRET`,
> `BOLNA_FROM_PHONE`, `WATI_*`, `AISENSY_*`, `MSG91_*`, orchestration's
> `LSQ_*`) are read once on first boot to seed default connections, then
> ignored at runtime. New deployments should configure connections in the
> UI directly — env values are advisory and will be removed in a later
> phase.
