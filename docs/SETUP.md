# AI Evals Platform — Setup Guide

## Local Development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- That's it. No Python, no Node.js, no PostgreSQL needed on your machine.

### Start Everything

```bash
cd ai-evals-platform
docker compose up --build
```

First run takes 2-3 minutes (downloads images, installs dependencies). Subsequent starts are fast (~10 seconds).

### What Happens

| Service | Container | Port | URL |
|---------|-----------|------|-----|
| PostgreSQL 16 | `evals-postgres` | 5432 | — |
| FastAPI backend | `evals-backend` | 8721 | http://localhost:8721/api/health |
| Vite frontend | `evals-frontend` | 5173 | http://localhost:5173 |

Startup order: PostgreSQL → Backend (waits for DB health check) → Frontend (waits for backend).

On first start, the backend auto-creates all database tables.

### Open the App

Go to **http://localhost:5173** in your browser.

### Docker Desktop

All 3 services appear as a grouped stack in Docker Desktop:
```
ai-evals-platform
  ├── evals-postgres    (database)
  ├── evals-backend     (API server)
  └── evals-frontend    (React dev server)
```

Click any service to view its logs, restart it, or open a terminal into it.

### Hot Reload

Code changes are reflected immediately — no restart needed:

| What you edit | What reloads |
|---------------|-------------|
| `src/**/*.tsx`, `src/**/*.ts` | Vite HMR (instant, browser updates) |
| `backend/app/**/*.py` | Uvicorn auto-reload (~1 second) |
| `docker-compose.yml` | Requires `docker compose up --build` |
| `requirements.txt` | Requires `docker compose up --build` |
| `package.json` | Requires `docker compose up --build` |

### Stop Everything

```bash
docker compose down
```

Add `-v` to also delete the database volume (fresh start):
```bash
docker compose down -v
```

### Environment Variables

The backend reads from `.env.backend` (gitignored). Create it from the template:

```bash
cp .env.backend.example .env.backend
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (set by Docker) | PostgreSQL connection string — overridden in Docker |
| `GEMINI_API_KEY` | (empty) | Required for AI evaluations |
| `OPENAI_API_KEY` | (empty) | Required for OpenAI evaluations |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Default Gemini model |
| `OPENAI_MODEL` | `gpt-4o` | Default OpenAI model |

### Useful Commands

```bash
# Rebuild after dependency changes
docker compose up --build

# View logs for a specific service
docker compose logs -f backend

# Open a shell in the backend container
docker exec -it evals-backend bash

# Open a psql shell to the database
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform

# Run a one-off Python command in backend
docker exec -it evals-backend python -c "from app.config import settings; print(settings.DATABASE_URL)"
```

### Troubleshooting

**Port already in use**: Another process is using 5432, 8721, or 5173.
```bash
# Find what's using the port
lsof -i :5432
# Kill it or change ports in docker-compose.yml
```

**Backend can't connect to database**: The backend waits for PostgreSQL's health check. If it still fails, check `docker compose logs postgres`.

**Frontend shows "Network Error"**: The backend isn't running. Check `docker compose logs backend`.

**Stale node_modules**: If you get module resolution errors after pulling new code:
```bash
docker compose down
docker compose up --build
```

---

## Production Deployment (Azure)

### Architecture

```
Internet
  → Azure Static Web Apps (React build — static files)
  → Azure Container Apps (FastAPI backend)
    → Azure Database for PostgreSQL (managed, flexible server)
    → Azure Blob Storage (file uploads)
```

### 1. Azure Database for PostgreSQL

Create a Flexible Server instance:
- SKU: Burstable B1ms (1 vCPU, 2 GB RAM) — sufficient for single-tenant
- PostgreSQL version: 16
- Enable public access or VNet integration
- Note the connection string

### 2. Azure Blob Storage

Create a Storage Account:
- Create a container named `evals-files`
- Note the connection string

### 3. Backend — Azure Container Apps

Build and push the backend image:
```bash
# Build production image (no --reload)
docker build -t evals-backend:prod -f backend/Dockerfile.prod ./backend

# Push to Azure Container Registry
az acr build --registry <your-acr> --image evals-backend:latest ./backend
```

Create `backend/Dockerfile.prod`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8721

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8721", "--workers", "4"]
```

Note: Production uses `--workers 4` instead of `--reload`.

Deploy to Container Apps with these environment variables:
```
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<host>:5432/ai_evals_platform
FILE_STORAGE_TYPE=azure_blob
AZURE_STORAGE_CONNECTION_STRING=<blob-connection-string>
AZURE_STORAGE_CONTAINER=evals-files
CORS_ORIGINS=https://your-domain.com
GEMINI_API_KEY=<key>
OPENAI_API_KEY=<key>
```

### 4. Frontend — Azure Static Web Apps

Build the React app:
```bash
npm run build
```

This produces a `dist/` folder. Deploy to Azure Static Web Apps:
```bash
az staticwebapp create --name evals-frontend --source ./dist
```

Configure a routing rule to proxy `/api/*` to the Container Apps backend URL.
In `staticwebapp.config.json`:
```json
{
  "routes": [
    {
      "route": "/api/*",
      "rewrite": "https://your-backend.azurecontainerapps.io/api/*"
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

### 5. DNS and SSL

Point your domain to Azure Static Web Apps. SSL is automatic via Azure-managed certificates.

### Production Checklist

- [ ] PostgreSQL Flexible Server created with SSL enforced
- [ ] Blob Storage account and `evals-files` container created
- [ ] Backend deployed to Container Apps with all env vars set
- [ ] Frontend built and deployed to Static Web Apps
- [ ] API proxy routing configured in staticwebapp.config.json
- [ ] Health check: `https://your-domain.com/api/health` returns `{"status":"ok"}`
- [ ] CORS_ORIGINS updated to production domain
