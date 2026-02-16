# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Full Stack (Docker Compose — recommended)
```bash
docker compose up --build          # Start PostgreSQL + FastAPI + Vite
docker compose down                # Stop all services
docker compose down -v             # Stop and wipe database volume
docker compose logs -f backend     # Tail backend logs
```

### Frontend Only
```bash
npm install                        # Install dependencies
npm run dev                        # Vite dev server at http://localhost:5173
npm run build                      # TypeScript check + production build
npm run lint                       # ESLint
npx tsc -b                        # Type check only (no emit)
```

### Database Access
```bash
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform
```

### Ports
- **5173** — Vite frontend (proxies `/api/*` → backend)
- **8721** — FastAPI backend (`/api/health` for health check)
- **5432** — PostgreSQL

### Environment
Copy `.env.backend.example` to `.env.backend`. Key vars: `GEMINI_API_KEY`, `DEFAULT_LLM_PROVIDER` (gemini|openai), `FILE_STORAGE_TYPE` (local|azure_blob).

No test framework is configured. Manual testing via Debug Panel (`Cmd+Shift+D`).

## Architecture

### Stack
- **Frontend**: React 19 + Vite + Zustand + Tailwind CSS v4 (TypeScript)
- **Backend**: FastAPI + async SQLAlchemy + asyncpg (Python)
- **Database**: PostgreSQL 16 with JSONB columns
- **Dev proxy**: Vite `/api/*` → FastAPI localhost:8721

### Two-Call LLM Evaluation Pipeline
1. **Call 1 (Transcription)**: Audio → AI transcript via `EvaluationService.transcribe()`
2. **Call 2 (Critique)**: Audio + Original + AI transcript → per-segment critique via `EvaluationService.critique()`

Orchestrated by `useAIEvaluation` hook in `src/features/evals/hooks/`.

### Two Schema Systems
- **JSON Schema** (`SchemaDefinition`): Used in evaluation overlays, passed to Gemini SDK for structured output enforcement
- **Field-based** (`EvaluatorOutputField[]`): Visual builder via `InlineSchemaBuilder` for custom evaluators; converted to JSON Schema at runtime via `generateJsonSchema()`

### LLM Providers
All implement `ILLMProvider` in `src/services/llm/`. Current: `GeminiProvider`, `OpenAIProvider`. Register new providers in `providerRegistry.ts`. Unified invocation via `pipeline/LLMInvocationPipeline.ts`.

### Template Variables
Prompts use `{{variable}}` syntax resolved at runtime from listing context. Registry in `src/services/templates/variableRegistry.ts`, resolution in `variableResolver.ts`.

### Background Jobs
Backend: `app/services/job_worker.py` polls `jobs` table for pending work.
Frontend: `useTaskQueueStore` tracks task progress in UI.

## Key Conventions

### Zustand Store Access
```typescript
// ❌ NEVER: Re-renders on ANY store change
const store = useSettingsStore();

// ✅ In components: Use specific selector
const transcription = useSettingsStore((state) => state.transcription);

// ✅ In functions/callbacks: Use getState()
const llm = useSettingsStore.getState().llm;
```

### Frontend Patterns
- Path alias: `@/` → `src/`
- Prefer `import type` for type-only imports
- All types in `src/types/`, re-exported via `index.ts`
- Components: named exports, function components only
- Styling: Tailwind v4 + CSS variables, `cn()` for class merging
- Storage access: always through `src/services/storage/` barrel (re-exports from `src/services/api/`)
- Errors: `createAppError()` / `handleError()` from `@/services/errors`
- Notifications: `notificationService.success()` / `.error()` from `@/services/notifications`

### Backend Patterns
- Pydantic schemas: `XxxCreate` (request), `XxxUpdate` (optional fields), `XxxResponse` (camelCase output)
- CamelCase conversion: `CamelModel` (requests) and `CamelORMModel` (responses) in `app/schemas/base.py` — backend stays snake_case, API JSON is camelCase
- Routes use `Depends(get_db)` for async sessions, direct `select()` queries
- Router registration in `backend/app/main.py`

### API Client Pattern (Frontend)
```typescript
import { apiRequest, apiUpload, apiDownload } from '@/services/api/client';
const items = await apiRequest<Item[]>('/api/items?app_id=voice-rx');
const blob = await apiDownload('/api/files/{id}/download');
```

### Feature Module Structure
New features go in `src/features/<name>/` with `components/`, `hooks/`, `utils/`, `index.ts`.

### Adding a New API Endpoint
1. Model in `backend/app/models/`
2. Schema in `backend/app/schemas/` (inherit `CamelModel`/`CamelORMModel`)
3. Route in `backend/app/routes/`
4. Register router in `backend/app/main.py`
5. API client in `src/services/api/`

## App Contexts
The platform has three apps: `voice-rx`, `kaira-bot`, `kaira-evals`. Prompts, schemas, and settings are scoped by `appId`.

## MyTatva API
**user_id**: Always `c22a5505-f514-11f0-9722-000d3a3e18d5` (never fabricate).
Session management: first call uses `thread_id: null, session_id: null, end_session: true`; subsequent calls use values from response with `end_session: false`.
