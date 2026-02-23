# AI Evals Platform Setup

This guide has two separate tracks:

1. Local setup (Docker, recommended)
2. Azure setup (Container Apps + Static Web Apps)

---

## 1) Local Setup

### Prerequisites

- Docker Desktop installed and running.
- Git installed.
- At least one LLM API key (`GEMINI_API_KEY` or `OPENAI_API_KEY`).

### Step 1 - Clone and enter the repo

```bash
git clone <repo-url>
cd ai-evals-platform
```

### Step 2 - Configure backend environment

```bash
cp .env.backend.example .env.backend
```

Update `.env.backend` with at least one provider key:

```env
GEMINI_API_KEY=<your-gemini-key>
# or
OPENAI_API_KEY=<your-openai-key>
DEFAULT_LLM_PROVIDER=gemini
```

Optional (needed for adversarial runs against live Kaira API):

```env
KAIRA_API_URL=<kaira-api-url>
KAIRA_AUTH_TOKEN=<kaira-auth-token>
KAIRA_TEST_USER_ID=<test-user-id>
```

### Step 3 - Ensure `service-account.json` exists

Docker Compose binds `./service-account.json` into the backend container.
If you are not using service-account auth, create a placeholder file:

```bash
touch service-account.json
```

### Step 4 - Start all services

```bash
docker compose up --build

# Optional: include the guide app (http://localhost:5174)
docker compose --profile guide up --build
```

### Step 5 - Verify

- Frontend: http://localhost:5173
- Guide (when `guide` profile is enabled): http://localhost:5174
- Backend health: http://localhost:8721/api/health

Expected health response:

```json
{ "status": "ok", "database": "connected" }
```

### Local service map

| Service           | Container        | Port | URL                              |
| ----------------- | ---------------- | ---: | -------------------------------- |
| Frontend (Vite)   | `evals-frontend` | 5173 | http://localhost:5173            |
| Guide (optional)  | `evals-guide`    | 5174 | http://localhost:5174            |
| Backend (FastAPI) | `evals-backend`  | 8721 | http://localhost:8721/api/health |
| PostgreSQL 16     | `evals-postgres` | 5432 | n/a                              |

### Common local commands

```bash
# Stop containers (keep DB data)
docker compose down

# Stop containers and reset DB volume
docker compose down -v

# Include optional guide profile
docker compose --profile guide up --build

# Root npm aliases for the same commands
npm run dev:stack
npm run dev:guide

# Tail backend logs
docker compose logs -f backend

# Open database shell
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform
```

### Optional: run backend/frontend without Docker

Use this mainly for script debugging and targeted local runs.

Backend:

```bash
pyenv activate venv-python-ai-evals-arize
pip install -r backend/requirements.txt
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
```

Frontend (separate shell):

```bash
npm install
npm run dev
```

---

## 2) Azure Setup

Target deployment:

- Frontend: Azure Static Web Apps
- Backend: Azure Container Apps
- Database: Azure Database for PostgreSQL (Flexible Server)
- Files: Azure Blob Storage

### Prerequisites

- Azure CLI installed and logged in: `az login`
- Node.js + npm installed (for frontend build and SWA deploy)
- Permission to create resource group, DB, storage, ACR, container apps, and static web app

### Step 1 - Define deployment variables

Set these once in your shell (replace placeholders):

```bash
export RG="rg-ai-evals"
export LOCATION="eastus"

export PG_SERVER="<globally-unique-pg-server-name>"
export PG_DB="ai_evals_platform"
export PG_ADMIN_USER="evals_admin"
export PG_ADMIN_PASSWORD="<strong-password>"

export STORAGE_ACCOUNT="<globally-unique-storage-account>"
export STORAGE_CONTAINER="evals-files"

export ACR_NAME="<globally-unique-acr-name>"
export ACA_ENV="ai-evals-env"
export ACA_APP="ai-evals-backend"

export SWA_NAME="<globally-unique-static-web-app-name>"
```

### Step 2 - Create resource group and PostgreSQL

```bash
az group create --name "$RG" --location "$LOCATION"

az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --location "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_ADMIN_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --public-access 0.0.0.0

az postgres flexible-server db create \
  --resource-group "$RG" \
  --server-name "$PG_SERVER" \
  --database-name "$PG_DB"
```

Build the DB URL used by backend:

```bash
export DATABASE_URL="postgresql+asyncpg://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB}?ssl=require"
```

Note: if your DB password has URL-special characters, URL-encode it before building `DATABASE_URL`.

### Step 3 - Create Blob Storage

```bash
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS

az storage container create \
  --name "$STORAGE_CONTAINER" \
  --account-name "$STORAGE_ACCOUNT"

export AZURE_STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RG" \
  --query connectionString -o tsv)
```

### Step 4 - Build backend image in ACR

Create `backend/Dockerfile.prod` (no `--reload`):

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/uploads
EXPOSE 8721
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8721", "--workers", "4"]
```

Create registry and push image:

```bash
az acr create --resource-group "$RG" --name "$ACR_NAME" --sku Basic --admin-enabled true

az acr build \
  --registry "$ACR_NAME" \
  --image evals-backend:latest \
  ./backend -f ./backend/Dockerfile.prod
```

### Step 5 - Deploy backend to Azure Container Apps

```bash
az containerapp env create \
  --name "$ACA_ENV" \
  --resource-group "$RG" \
  --location "$LOCATION"

export ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

az containerapp create \
  --name "$ACA_APP" \
  --resource-group "$RG" \
  --environment "$ACA_ENV" \
  --image "${ACR_NAME}.azurecr.io/evals-backend:latest" \
  --registry-server "${ACR_NAME}.azurecr.io" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --target-port 8721 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --env-vars \
    DATABASE_URL="$DATABASE_URL" \
    FILE_STORAGE_TYPE=azure_blob \
    AZURE_STORAGE_CONNECTION_STRING="$AZURE_STORAGE_CONNECTION_STRING" \
    AZURE_STORAGE_CONTAINER="$STORAGE_CONTAINER" \
    CORS_ORIGINS="https://<your-frontend-domain>" \
    GEMINI_API_KEY="<your-gemini-key>" \
    OPENAI_API_KEY="<your-openai-key>" \
    DEFAULT_LLM_PROVIDER=gemini
```

Get backend FQDN:

```bash
export BACKEND_FQDN=$(az containerapp show \
  --name "$ACA_APP" \
  --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn -o tsv)
```

### Step 6 - Deploy frontend to Static Web Apps

Build frontend:

```bash
npm ci
npm run build
```

Create `staticwebapp.config.json` in project root:

```json
{
  "routes": [
    {
      "route": "/api/*",
      "rewrite": "https://REPLACE_WITH_BACKEND_FQDN/api/*"
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

Replace `REPLACE_WITH_BACKEND_FQDN` with `${BACKEND_FQDN}`, then copy into build output:

```bash
cp staticwebapp.config.json dist/staticwebapp.config.json
```

Create SWA and deploy:

```bash
az staticwebapp create \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --location eastus2 \
  --sku Standard

export DEPLOY_TOKEN=$(az staticwebapp secrets list \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --query "properties.apiKey" -o tsv)

npm install -g @azure/static-web-apps-cli
swa deploy ./dist --deployment-token "$DEPLOY_TOKEN"
```

### Step 7 - Finalize CORS and validate

Get frontend hostname and set backend CORS:

```bash
export FRONTEND_HOST=$(az staticwebapp show \
  --name "$SWA_NAME" \
  --resource-group "$RG" \
  --query defaultHostname -o tsv)

az containerapp update \
  --name "$ACA_APP" \
  --resource-group "$RG" \
  --set-env-vars CORS_ORIGINS="https://${FRONTEND_HOST}"
```

Validate:

```bash
curl "https://${BACKEND_FQDN}/api/health"
```

Then open `https://${FRONTEND_HOST}` and run one complete evaluation flow.

### Production hardening checklist

- Move API keys and DB credentials into Container Apps secrets (not plain env values).
- Restrict PostgreSQL network access after deployment.
- Add custom domain and TLS on Static Web Apps.
- Set monitoring/alerts for backend health and job failure rates.
