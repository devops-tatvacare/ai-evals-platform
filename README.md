# AI Evals Platform

![React + TypeScript](https://img.shields.io/badge/React_19_+_TypeScript-61DAFB?logo=react&logoColor=white)
![FastAPI + Python](https://img.shields.io/badge/FastAPI_+_Python_3.12-009688?logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)
![Docker + Azure](https://img.shields.io/badge/Docker_+_Azure_Container_Apps-2496ED?logo=docker&logoColor=white)

Multi-tenant evaluation platform for production AI workflows. Product, QA, and ops teams use it to score outputs, review evidence, compare runs, generate reports, audit drift, orchestrate outbound campaigns, and run ad-hoc analytics through a constrained agent (Sherlock).

## Workspaces

| App ID | Use case |
| --- | --- |
| `voice-rx` | Medical transcription + structured extraction quality |
| `kaira-bot` | Chat quality, custom evaluators, batch + adversarial testing |
| `inside-sales` | LeadSquared-backed call quality evaluation, reporting, orchestration |

## Stack

- Frontend: React 19 + TypeScript + Vite 7 + Tailwind 4. TanStack Query for server data, Zustand for client-only state.
- Backend: FastAPI + SQLAlchemy async + PostgreSQL 16 (three schemas: `platform`, `analytics`, `orchestration`). Background job worker with per-tenant/app/user concurrency caps.
- LLM providers: Gemini (AI Studio + Vertex), OpenAI, Azure OpenAI, Anthropic. Per-tenant credentials encrypted at rest.
- Orchestration: workflow engine with provider integrations (WhatsApp / Voice / SMS / CRM). Provider credentials are tenant-owned via the in-app Connections page.
- Deployment: Azure Container Apps, Azure Container Registry, Azure Database for PostgreSQL, Azure Blob Storage. CI via GitHub Actions OIDC, branch-triggered on `prod`.

## Quick start

```bash
cp .env.backend.example .env.backend
touch service-account.json
docker compose up --build
```

Local services:

| Service | URL | Notes |
| --- | --- | --- |
| Frontend | http://localhost:5173 | Vite dev server |
| Backend | http://localhost:8721/api/health | FastAPI |
| PostgreSQL | localhost:5432 | local DB |
| Worker | container only | dedicated worker process |

`service-account.json` only needs to be a real Vertex AI service account when the system-tenant Gemini fallback is exercised locally; an empty file is enough otherwise.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/PROJECT 101.md`](docs/PROJECT%20101.md) | Product, architecture, workflows, core abstractions |
| [`docs/SETUP.md`](docs/SETUP.md) | Local + production setup, env vars, common commands |
| [`docs/DEVOPS-DETAILS.md`](docs/DEVOPS-DETAILS.md) | Production deployment, CI/CD, Azure resources, operational runbook |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Operational rules for coding agents (mirrored byte-identical) |

## Repository layout

```text
backend/                 FastAPI app, ORM, alembic migrations, evaluators, job worker, orchestration runtime
src/                     React app, feature modules, stores, shared services
docker-compose.yml       Local dev stack (postgres + backend + worker + frontend)
docker-compose.prod.yml  Production compose reference (Azure Container Apps deploys the backend image directly)
Dockerfile               Backend production image
Dockerfile.frontend      Frontend image
backend/Dockerfile.local Backend dev image
backend/alembic/         Schema migrations (source of truth)
docs/                    PROJECT 101 / SETUP / DEVOPS-DETAILS; plans + investigations live on disk only
```

## License

Proprietary. Built by TatvaCare.
