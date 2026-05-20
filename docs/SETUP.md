# SETUP — AI Evals Platform

Operational setup guide. Reflects the current code and deployment. Treat `backend/app/config.py` + the compose files as ground truth where this drifts.

For production deployment runbook, see `docs/DEVOPS-DETAILS.md`.

---

## 1. Deploy shapes

### Local (docker-compose.yml)

| Service | Port | Purpose |
| --- | --- | --- |
| `postgres` | 5432 | local DB |
| `backend` | 8721 | FastAPI |
| `worker` | none | dedicated job worker |
| `frontend` | 5173 | Vite dev server |

### Production (Azure Container Apps)

- `ai-evals-be-prod` — backend container; runs the worker loop in-process (`JOB_RUN_EMBEDDED_WORKER=True`). Single container today, no separate worker.
- `ai-evals-fe-prod` — frontend container.
- Azure Database for PostgreSQL (external to the app).
- Azure Blob Storage (external to the app).

`docker-compose.prod.yml` exists in the repo as reference for the production image build, but Container Apps deploys the backend image directly — it does not run `docker compose` in prod.

---

## 2. Local development with Docker

Prereqs: Docker Desktop, Git, at least one usable LLM credential (Gemini key / OpenAI key / Azure OpenAI / Anthropic key, OR a Vertex AI service account JSON for the system-tenant fallback).

```bash
git clone <repo-url>
cd ai-evals-platform
cp .env.backend.example .env.backend
touch service-account.json
docker compose up --build
```

Minimum env to set in `.env.backend` before first run:

```env
JWT_SECRET=<random 64-char hex>
LLM_CREDENTIAL_KEY=<Fernet key>
ORCHESTRATION_CONNECTION_KEY=<Fernet key>
```

Generate Fernet keys with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`LLM_CREDENTIAL_KEY` MUST be present before `alembic upgrade head` runs — migration 0047 backfills encrypted credential rows from the legacy `application_settings` blob. Loss of the key makes every tenant's stored LLM key unreadable. Back it up like `JWT_SECRET`.

Tenant LLM credentials are NOT env vars. Configure per-tenant via **Admin → AI Settings** (stored encrypted in `platform.tenant_llm_providers`). Sherlock falls back to a system-tenant Gemini service account when a tenant has no key — see step 3 below.

### Step 3: service-account.json (optional)

The local compose mounts `./service-account.json` into both `backend` and `worker`. Real Vertex AI flows require a real service account JSON; otherwise an empty `touch service-account.json` is enough to satisfy the mount.

If you actually need Vertex locally, set `GEMINI_SERVICE_ACCOUNT_PATH=/app/service-account.json` in `.env.backend`.

### Step 4: verify

| Check | URL | Expected |
| --- | --- | --- |
| Frontend | http://localhost:5173 | UI loads |
| Backend | http://localhost:8721/api/health | `{"status":"ok","database":"connected"}` |
| Postgres | localhost:5432 | accepts local connections |
| Worker | container only | logs show claim + execute cycles |

### Common local commands

```bash
docker compose down
docker compose down -v               # also drops the local DB
docker compose logs -f backend worker
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform
npm run dev:stack                    # FE + BE in dev mode
npm run sync:guide                   # regenerate the in-app guide
```

### First login

If `.env.backend` defines `ADMIN_EMAIL` + `ADMIN_PASSWORD` + `ADMIN_TENANT_NAME`, an empty DB will bootstrap an admin user on first startup. Rotate the password after first login.

---

## 3. Local development without Docker

### Backend only

```bash
pyenv activate venv-python-ai-evals-arize
pip install -r backend/requirements.txt
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
```

Default config runs the worker in-process. For parity with the containerized split:

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

## 4. Environment variable reference

Source of truth: `backend/app/config.py`. The list below is the current surface.

### Core

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform` | Primary DB |
| `ANALYTICS_DATABASE_URL` | empty | Optional separate analytics DB; falls back to `DATABASE_URL` |
| `FILE_STORAGE_TYPE` | `local` | `local` or `azure_blob` |
| `FILE_STORAGE_PATH` | `./backend/uploads` | Local upload dir |
| `API_PORT` | `8721` | Backend listen port |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `APP_BASE_URL` | `http://localhost:5173` | Public base URL for generated links + webhook URLs |
| `PDF_RENDER_BASE_URL` | empty | Optional internal frontend URL for backend-driven PDF; falls back to `APP_BASE_URL` |

### Storage + uploads

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_STORAGE_CONNECTION_STRING` | empty | Blob connection string |
| `AZURE_STORAGE_CONTAINER` | `evals-files` | Blob container |
| `MAX_UPLOAD_SIZE_MB` | `100` | Upload limit |
| `ALLOWED_UPLOAD_MIMES` | built-in list | Allowed upload MIME types |

### Auth + bootstrap

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | empty (REQUIRED) | JWT signing secret |
| `JWT_ALGORITHM` | `HS256` | JWT algorithm |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime |
| `ADMIN_EMAIL` | empty | Bootstrap admin email |
| `ADMIN_PASSWORD` | empty | Bootstrap admin password |
| `ADMIN_TENANT_NAME` | empty | Bootstrap tenant name |
| `ADMIN_TENANT_ALLOWED_DOMAINS` | empty | Comma-separated signup domain allowlist |
| `AUTH_RATE_LIMIT` | `10/minute` | login / signup / refresh rate |
| `COST_PRICING_REFRESH_RATE_LIMIT` | `5/minute;50/hour` | `/api/admin/cost/pricing/refresh` rate |

### LLM credential encryption

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_CREDENTIAL_KEY` | empty (REQUIRED) | Fernet key encrypting `platform.tenant_llm_providers.api_key_encrypted`. Must be set BEFORE `alembic upgrade head`. |
| `GEMINI_SERVICE_ACCOUNT_PATH` | empty | System-tenant Gemini SA fallback path. Sherlock uses it when no tenant Gemini key is configured. Planned-deprecation. |

Tenant LLM provider keys themselves (Gemini / OpenAI / Azure OpenAI / Anthropic) are configured per-tenant in **Admin → AI Settings**, not env vars. There is no `GEMINI_API_KEY`, `OPENAI_API_KEY`, `AZURE_OPENAI_*`, `ANTHROPIC_API_KEY`, `DEFAULT_LLM_PROVIDER`, or `EVAL_TEMPERATURE` in this stack.

### Orchestration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ORCHESTRATION_CONNECTION_KEY` | empty (REQUIRED) | Fernet key encrypting `orchestration.provider_connections` secrets |
| `ORCHESTRATION_DEFAULT_TENANT_ID` | `00000000-0000-0000-0000-000000000001` | Default tenant for first-boot seed |
| `ORCHESTRATION_DEFAULT_APP_ID` | `inside-sales` | Default app for first-boot seed |
| `ORCHESTRATION_EVENT_WEBHOOK_SECRET` | empty | Shared secret for the generic event webhook surface |

### Provider one-time bootstrap (read once on first boot)

These are read once to seed default `ProviderConnection` rows on a fresh DB. After that, edits go through the in-app **Connections** page; env values are ignored. Planned-removal.

| Variable | Provider |
| --- | --- |
| `BOLNA_API_KEY`, `BOLNA_BASE_URL`, `BOLNA_WEBHOOK_SECRET` | Bolna (voice) |
| `WATI_BASE_URL`, `WATI_TENANT_ID`, `WATI_API_TOKEN`, `WATI_WEBHOOK_SECRET` | WATI (WhatsApp) |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_BASE_URL` | SMS |
| `LSQ_WEBHOOK_SECRET` | LeadSquared webhook |

### Inside Sales (LSQ outbound)

| Variable | Default | Purpose |
| --- | --- | --- |
| `LSQ_BASE_URL` | empty | LSQ API base URL |
| `LSQ_ACCESS_KEY` | empty | LSQ access key |
| `LSQ_SECRET_KEY` | empty | LSQ secret key |

### Kaira

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAIRA_API_URL` | empty | Kaira API base URL |
| `KAIRA_AUTH_TOKEN` | empty | Kaira auth token |
| `KAIRA_TEST_USER_ID` | empty | Kaira test user |

### Adversarial tuning

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADVERSARIAL_MAX_TURNS` | `10` | Max turns per adversarial conversation |
| `ADVERSARIAL_TURN_DELAY` | `1.5` | Inter-turn delay |
| `ADVERSARIAL_CASE_DELAY` | `3.0` | Inter-case delay |

### Job worker

| Variable | Default | Purpose |
| --- | --- | --- |
| `JOB_RUN_EMBEDDED_WORKER` | `true` | Run worker in-process; set `false` when a dedicated worker container exists |
| `JOB_MAX_CONCURRENT` | `12` | Global ceiling |
| `JOB_TENANT_MAX_CONCURRENT` | `8` | Per-tenant cap |
| `JOB_APP_MAX_CONCURRENT` | `5` | Per-app cap |
| `JOB_USER_MAX_CONCURRENT` | `3` | Per-user cap |
| `JOB_INTERACTIVE_MAX_CONCURRENT` | `0` (inherit global) | Interactive queue cap |
| `JOB_STANDARD_MAX_CONCURRENT` | `0` (inherit global) | Standard queue cap |
| `JOB_BULK_MAX_CONCURRENT` | `4` | Bulk queue cap |
| `JOB_ANALYTICS_MAX_CONCURRENT` | `1` | Analytics queue cap |
| `JOB_POLL_INTERVAL_SECONDS` | `1.0` | Poll cadence |
| `JOB_HEARTBEAT_INTERVAL_SECONDS` | `15.0` | Lease heartbeat cadence |
| `JOB_LEASE_SECONDS` | `60` | Lease duration |
| `JOB_STALE_TIMEOUT_MINUTES` | `30` | Stale recovery threshold |
| `JOB_MAX_ATTEMPTS` | `3` | Default retry budget |
| `JOB_RETRY_BASE_DELAY_SECONDS` | `5` | Retry backoff base |
| `JOB_RETRY_MAX_DELAY_SECONDS` | `120` | Retry backoff cap |
| `JOB_CLAIM_WINDOW_MULTIPLIER` | `10` | Candidate claim window multiplier |
| `JOB_CLAIM_WINDOW_MAX` | `100` | Candidate claim window cap |
| `SCHEDULER_TICK_INTERVAL_SECONDS` | `60` | Scheduler tick cadence |

### Logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | `app/logging_config.py` log level |
| `LOG_FORMAT` | `json` | `json` or `console` |

### Deploy-time only

These are consumed by `docker-compose.prod.yml` and `backend/entrypoint.sh`, not by the FastAPI settings object.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `GEMINI_SERVICE_ACCOUNT_JSON` | `entrypoint.sh` | base64-encoded SA JSON decoded to `/app/service-account.json` at container startup |
| `ACR_LOGIN_SERVER` | `docker-compose.prod.yml` reference | ACR hostname |
| `IMAGE_TAG` | `docker-compose.prod.yml` reference | image tag selection |

---

## 5. Production checklist

For Container Apps (`ai-evals-be-prod`):

- `DATABASE_URL` — Azure DB for PostgreSQL DSN.
- `FILE_STORAGE_TYPE=azure_blob`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`.
- `CORS_ORIGINS` — public origin only.
- `APP_BASE_URL` — public origin (drives webhook URLs).
- `JWT_SECRET` (Fernet-grade entropy).
- `LLM_CREDENTIAL_KEY` (Fernet — required before migration 0047 runs).
- `ORCHESTRATION_CONNECTION_KEY` (Fernet).
- Bootstrap admin values (only if you want first-run bootstrap).
- `JOB_RUN_EMBEDDED_WORKER` left at the default `true` (single-container prod).

Optional: Sherlock system-tenant SA fallback — `GEMINI_SERVICE_ACCOUNT_JSON` (base64) + `GEMINI_SERVICE_ACCOUNT_PATH=/app/service-account.json`.

All secret values MUST be stored as Container App `secretRef:`, NEVER as `value:` — `value:` is plaintext in `az containerapp show`.

### Post-deploy checks

```bash
curl https://<your-host>/api/health
# expected: {"status":"ok","database":"connected"}
```

Then: log in with bootstrap admin → seed evaluators per app → create roles + app grants → generate invite links → rotate bootstrap password.

Evaluator seeding endpoints (admin only):

```text
POST /api/evaluators/seed-defaults?appId=voice-rx
POST /api/evaluators/seed-defaults?appId=kaira-bot
POST /api/evaluators/seed-defaults?appId=inside-sales
```

---

## 6. Useful commands

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

# Migrations
docker compose run --rm migrate
PYTHONPATH=backend alembic -c backend/alembic.ini upgrade head
PYTHONPATH=backend alembic -c backend/alembic.ini revision --autogenerate -m "<message>"
```

---

## 7. Orchestration tenant rollout

Provider credentials are tenant-owned, configured via the in-app **Connections** page (`/inside-sales/orchestration/connections`). Env vars are read once on first boot only.

1. **Set `ORCHESTRATION_CONNECTION_KEY`** on the backend. Treat with the same rigor as `JWT_SECRET` — losing it makes every stored connection unreadable.
2. **Webhook URLs** compose from `APP_BASE_URL`: `{APP_BASE_URL}/api/orchestration/webhooks/{provider}/{token}`. No tenant or app id appears in the URL — the per-connection token resolves both at receive time.
3. **Create connections** per provider (Bolna / WATI / LSQ / MSG91 / AiSensy / SMS). Click **Test** before publishing. Copy each connection's webhook URL into the provider dashboard.
4. **Clone the seeded workflow** (`mql-concierge-default`) via UI or `POST /api/orchestration/workflows/clone`. The clone strips foreign `connection_id`s; a clone needing rebinding lands as a draft.
5. **Bind connections** in the builder per node. For dispatch nodes, expand **Variable mappings** to bind agent variables to recipient payload fields.
6. **Configure templates** in the provider dashboard (e.g. WATI template names must match the seeded `template_name` values).
7. **Add trigger** (cron, webhook, or manual Run Now).
8. **Verify** via Run Now + the run-detail SSE canvas.

See `docs/DEVOPS-DETAILS.md` for production-side specifics.
