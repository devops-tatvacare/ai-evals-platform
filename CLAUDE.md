# CLAUDE.md

Guidance for Claude Code working in this repository.

## Development Commands

```bash
docker compose up --build          # Start PostgreSQL + FastAPI + Vite
docker compose down                # Stop all services
docker compose down -v             # Stop and wipe database volume
docker compose logs -f backend     # Tail backend logs
docker exec -it evals-postgres psql -U evals_user -d ai_evals_platform
```

Frontend-only: `npm install && npm run dev`. Build: `npm run build`. Lint: `npm run lint`. Type check: `npx tsc -b`.

**Ports**: 5173 (Vite), 8721 (FastAPI, `/api/health`), 5432 (PostgreSQL).

**Environment**: Copy `.env.backend.example` → `.env.backend`. Key vars: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DEFAULT_LLM_PROVIDER`, `FILE_STORAGE_TYPE`.

No test framework configured. Manual testing via Debug Panel (`Cmd+Shift+D`).

## Architecture

**Frontend**: React 19 + Vite 7 + Zustand + Tailwind CSS v4 (TypeScript strict).
**Backend**: FastAPI + async SQLAlchemy + asyncpg (Python 3.12).
**Database**: PostgreSQL 16 with JSONB columns.
**Dev proxy**: Vite `/api/*` → FastAPI on port 8721.

### Apps
Three apps scoped by `appId`: `voice-rx`, `kaira-bot`, `kaira-evals`. Prompts, schemas, evaluators, and settings are all app-scoped.

### Backend Evaluation Pipeline
All evaluations run as background jobs via `job_worker.py` (polls `jobs` table every 5s).

**Job types and runners** (in `backend/app/services/evaluators/`):
- `evaluate-voice-rx` → `voice_rx_runner` — Two-call pipeline: transcription then critique.
- `evaluate-batch` → `batch_runner` — Intent/correctness/efficiency evaluators on CSV thread data.
- `evaluate-adversarial` → `adversarial_runner` — Stress-tests live Kaira API.
- `evaluate-custom` → `custom_evaluator_runner` — Single custom evaluator on a listing/session.
- `evaluate-custom-batch` → `voice_rx_batch_custom_runner` — N custom evaluators on one listing.

**Unified data model**: `EvalRun` is the single source of truth for all eval results (`eval_type`: custom, full_evaluation, batch_thread, batch_adversarial). Linked to `Job` for async progress, `ApiLog` for LLM call auditing.

### LLM Providers (Backend)
`llm_base.py`: `GeminiProvider` (supports audio, Files API, service accounts) and `OpenAIProvider`. Timeout tiers: text-only 60s, with-schema 90s, with-audio 180s, with-audio+schema 240s. Retry with exponential backoff.

### Frontend Schema Systems
- **JSON Schema** (`SchemaDefinition`): Passed to LLM for structured output enforcement.
- **Field-based** (`EvaluatorOutputField[]`): Visual builder in `InlineSchemaBuilder`; converted to JSON Schema at runtime via `generateJsonSchema()`.

### Template Variables
Prompts use `{{variable}}` syntax resolved at runtime. Registry in `src/services/templates/variableRegistry.ts`.

## Key Conventions

### Zustand Store Access
```typescript
// ✅ In components: specific selector
const transcription = useSettingsStore((state) => state.transcription);
// ✅ In callbacks/services: getState()
const llm = useSettingsStore.getState().llm;
// ❌ NEVER: useSettingsStore() without selector in components
```

### Frontend Patterns
- Path alias: `@/` → `src/`
- `import type` for type-only imports
- All types in `src/types/`, re-exported via `index.ts`
- Named exports, function components only
- Tailwind v4 + CSS variables, `cn()` for class merging
- Errors: `createAppError()` / `handleError()` from `@/services/errors`
- Notifications: `notificationService.success()` / `.error()`
- API calls: `apiRequest`, `apiUpload`, `apiDownload` from `@/services/api/client`
- Feature modules: `src/features/<name>/` with `components/`, `hooks/`, `utils/`, `index.ts`

### Backend Patterns
- Pydantic schemas: `XxxCreate` (request), `XxxUpdate` (optional), `XxxResponse` (camelCase output)
- CamelCase conversion: `CamelModel` / `CamelORMModel` in `app/schemas/base.py`
- Routes use `Depends(get_db)` for async sessions, direct `select()` queries
- Router registration in `backend/app/main.py` (13 routers)
- Seed defaults in `backend/app/services/seed_defaults.py` — auto-creates prompts, schemas, evaluators on startup

### Adding a New API Endpoint
1. Model in `backend/app/models/`
2. Schema in `backend/app/schemas/` (inherit `CamelModel`/`CamelORMModel`)
3. Route in `backend/app/routes/`
4. Register router in `backend/app/main.py`
5. Frontend API call in `src/services/api/`

## Database Models (11 tables)
`EvalRun`, `Job`, `Listing`, `ChatSession`, `ChatMessage`, `Prompt`, `Schema`, `Evaluator`, `ThreadEvaluation`, `AdversarialEvaluation`, `ApiLog`.

## MyTatva API
**user_id**: Always `c22a5505-f514-11f0-9722-000d3a3e18d5` (never fabricate).

### Session Management (Kaira `/chat/stream` endpoint)
- **First message**: `session_id: user_id, end_session: true` — no `thread_id`.
- **Subsequent**: `session_id: <from session_context>, thread_id: <from session_context>, end_session: false`.
- Always sync `serverSessionId` and `threadId` from every `session_context` SSE chunk.
