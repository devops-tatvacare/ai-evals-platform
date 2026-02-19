# AI Evals Platform — Setup Guide

## Local Development (Docker Compose)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
- No Python, Node.js, or PostgreSQL needed on your machine.

### Step 1: Clone and configure environment

```bash
git clone <repo-url>
cd ai-evals-platform
cp .env.backend.example .env.backend
```

Edit `.env.backend` and add at least one LLM API key:

```env
GEMINI_API_KEY=your-gemini-api-key
# or
OPENAI_API_KEY=your-openai-api-key
DEFAULT_LLM_PROVIDER=gemini   # or "openai"
```

Optional — for Kaira Bot adversarial testing:
```env
KAIRA_API_URL=https://your-kaira-endpoint
KAIRA_AUTH_TOKEN=your-token
KAIRA_TEST_USER_ID=your-test-user-id
```

### Step 2: Start all services

```bash
docker compose up --build
```

First run downloads images and installs dependencies. Subsequent starts are fast.

### Step 3: Open the app

Go to **http://localhost:5173** in your browser.

### What starts

| Service         | Container        | Port | URL                                 |
|-----------------|------------------|------|-------------------------------------|
| PostgreSQL 16   | `evals-postgres` | 5432 | —                                   |
| FastAPI backend | `evals-backend`  | 8721 | http://localhost:8721/api/health    |
| Vite frontend   | `evals-frontend` | 5173 | http://localhost:5173               |

Startup order: PostgreSQL (with health check) → Backend (waits for DB) → Frontend (waits for backend).

On first start, the backend auto-creates all database tables and seeds default prompts, schemas, and evaluators.

### Hot reload

| What you edit                        | What reloads                          |
|--------------------------------------|---------------------------------------|
| `src/**/*.tsx`, `src/**/*.ts`        | Vite HMR (instant browser update)     |
| `backend/app/**/*.py`                | Uvicorn auto-reload (~1 second)       |
| `docker-compose.yml`                 | Requires `docker compose up --build`  |
| `requirements.txt` / `package.json`  | Requires `docker compose up --build`  |

### Stop services

```bash
docker compose down            # Stop all services, keep data
docker compose down -v         # Stop and wipe database (fresh start)
```

### Useful commands

```bash
# Tail backend logs
docker compose logs -f backend

# Open a shell in the backend container
docker exec -it evals-backend bash

# Open a psql shell to the database
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform

# Run a one-off Python command in backend
docker exec -it evals-backend python -c "from app.config import settings; print(settings.DATABASE_URL)"
```

### Troubleshooting

**Port already in use**: Check what's using 5432, 8721, or 5173:
```bash
lsof -i :5432
```

**Backend can't connect to database**: Check `docker compose logs postgres`. The backend waits for PostgreSQL's health check.

**Frontend shows "Network Error"**: Backend isn't running. Check `docker compose logs backend`.

**Stale node_modules after pulling**: Run `docker compose down && docker compose up --build`.

### Environment variables reference

| Variable                         | Default                   | Description                                  |
|----------------------------------|---------------------------|----------------------------------------------|
| `DATABASE_URL`                   | Set by Docker Compose     | PostgreSQL async connection string           |
| `FILE_STORAGE_TYPE`              | `local`                   | `local` or `azure_blob`                      |
| `FILE_STORAGE_PATH`              | `./backend/uploads`       | Local file storage directory                 |
| `API_PORT`                       | `8721`                    | Backend server port                          |
| `CORS_ORIGINS`                   | `http://localhost:5173`   | Comma-separated allowed origins              |
| `GEMINI_API_KEY`                 | —                         | Google Gemini API key                        |
| `GEMINI_AUTH_METHOD`             | `api_key`                 | `api_key` or `service_account`               |
| `GEMINI_SERVICE_ACCOUNT_PATH`    | —                         | Path to service account JSON (Vertex AI)     |
| `GEMINI_MODEL`                   | `gemini-3-flash-preview`  | Default Gemini model                         |
| `OPENAI_API_KEY`                 | —                         | OpenAI API key                               |
| `OPENAI_MODEL`                   | `gpt-4o`                  | Default OpenAI model                         |
| `DEFAULT_LLM_PROVIDER`           | `gemini`                  | `gemini` or `openai`                         |
| `EVAL_TEMPERATURE`               | `0.1`                     | LLM temperature for evaluations              |
| `KAIRA_API_URL`                  | —                         | Kaira Bot API endpoint                       |
| `KAIRA_AUTH_TOKEN`               | —                         | Kaira Bot auth token                         |
| `KAIRA_TEST_USER_ID`             | —                         | User ID for adversarial testing              |
| `AZURE_STORAGE_CONNECTION_STRING`| —                         | Azure Blob connection string (production)    |
| `AZURE_STORAGE_CONTAINER`        | `evals-files`             | Azure Blob container name                    |

---

## Production Deployment (Azure Cloud)

### Architecture

```
Internet
  → Azure Static Web Apps (React build — static files, SPA routing)
      → /api/* proxied to backend
  → Azure Container Apps (FastAPI backend)
      → Azure Database for PostgreSQL Flexible Server
      → Azure Blob Storage (file uploads)
```

### Step 1: Create a resource group

```bash
az login
az group create --name rg-evals --location eastus
```

### Step 2: Create Azure Database for PostgreSQL

```bash
az postgres flexible-server create \
  --resource-group rg-evals \
  --name evals-db-server \
  --location eastus \
  --admin-user evals_admin \
  --admin-password '<strong-password>' \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --public-access 0.0.0.0
```

Create the database:

```bash
az postgres flexible-server db create \
  --resource-group rg-evals \
  --server-name evals-db-server \
  --database-name ai_evals_platform
```

Note the connection string:
```
postgresql+asyncpg://evals_admin:<password>@evals-db-server.postgres.database.azure.com:5432/ai_evals_platform?ssl=require
```

### Step 3: Create Azure Blob Storage

```bash
az storage account create \
  --name evalsfilestorage \
  --resource-group rg-evals \
  --location eastus \
  --sku Standard_LRS

az storage container create \
  --name evals-files \
  --account-name evalsfilestorage
```

Get the connection string:
```bash
az storage account show-connection-string \
  --name evalsfilestorage \
  --resource-group rg-evals \
  --query connectionString -o tsv
```

### Step 4: Create Azure Container Registry

```bash
az acr create \
  --resource-group rg-evals \
  --name evalsregistry \
  --sku Basic \
  --admin-enabled true
```

### Step 5: Build and push the backend image

Create `backend/Dockerfile.prod`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/uploads
EXPOSE 8721
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8721", "--workers", "4"]
```

Build and push:
```bash
az acr build --registry evalsregistry --image evals-backend:latest ./backend -f ./backend/Dockerfile.prod
```

### Step 6: Deploy backend to Azure Container Apps

```bash
# Create Container Apps environment
az containerapp env create \
  --name evals-env \
  --resource-group rg-evals \
  --location eastus

# Get ACR credentials
ACR_PASSWORD=$(az acr credential show --name evalsregistry --query "passwords[0].value" -o tsv)

# Create the container app
az containerapp create \
  --name evals-backend \
  --resource-group rg-evals \
  --environment evals-env \
  --image evalsregistry.azurecr.io/evals-backend:latest \
  --registry-server evalsregistry.azurecr.io \
  --registry-username evalsregistry \
  --registry-password "$ACR_PASSWORD" \
  --target-port 8721 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --env-vars \
    DATABASE_URL='postgresql+asyncpg://evals_admin:<password>@evals-db-server.postgres.database.azure.com:5432/ai_evals_platform?ssl=require' \
    FILE_STORAGE_TYPE=azure_blob \
    AZURE_STORAGE_CONNECTION_STRING='<blob-connection-string>' \
    AZURE_STORAGE_CONTAINER=evals-files \
    CORS_ORIGINS='https://your-domain.com' \
    GEMINI_API_KEY='<key>' \
    OPENAI_API_KEY='<key>' \
    DEFAULT_LLM_PROVIDER=gemini
```

Note the backend FQDN from the output (e.g., `evals-backend.<hash>.eastus.azurecontainerapps.io`).

### Step 7: Build and deploy frontend to Azure Static Web Apps

Build the React app:
```bash
npm ci
npm run build
```

Create the static web app:
```bash
az staticwebapp create \
  --name evals-frontend \
  --resource-group rg-evals \
  --location eastus2 \
  --sku Standard
```

Get the deployment token:
```bash
DEPLOY_TOKEN=$(az staticwebapp secrets list \
  --name evals-frontend \
  --resource-group rg-evals \
  --query "properties.apiKey" -o tsv)
```

Install SWA CLI and deploy:
```bash
npm install -g @azure/static-web-apps-cli
swa deploy ./dist --deployment-token "$DEPLOY_TOKEN"
```

### Step 8: Configure API proxy routing

Create `staticwebapp.config.json` in the project root:

```json
{
  "routes": [
    {
      "route": "/api/*",
      "rewrite": "https://evals-backend.<hash>.eastus.azurecontainerapps.io/api/*"
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

Copy it into the `dist/` folder before deploying, or place it alongside the build output.

### Step 9: Configure DNS and SSL

Point your custom domain to Azure Static Web Apps. SSL certificates are auto-provisioned by Azure.

```bash
az staticwebapp hostname set \
  --name evals-frontend \
  --resource-group rg-evals \
  --hostname your-domain.com
```

### Production checklist

- [ ] PostgreSQL Flexible Server created with SSL enforced
- [ ] Blob Storage account and `evals-files` container created
- [ ] Backend image built and pushed to ACR
- [ ] Backend deployed to Container Apps with all env vars set
- [ ] Frontend built and deployed to Static Web Apps
- [ ] API proxy routing configured in `staticwebapp.config.json`
- [ ] Health check passes: `https://your-domain.com/api/health` → `{"status":"ok","database":"connected"}`
- [ ] `CORS_ORIGINS` updated to production domain
- [ ] Gemini/OpenAI API keys set as Container App secrets
