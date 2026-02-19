# AGENTS.md

Guidance for coding agents working in this repository. Prefer existing patterns over invention.

## Stack

- **Frontend**: React 19 + TypeScript (strict) + Vite 7 + Tailwind CSS v4 + Zustand.
- **Backend**: FastAPI + async SQLAlchemy + asyncpg + Python 3.12.
- **Database**: PostgreSQL 16 with JSONB columns. 11 models in `backend/app/models/`.
- **LLM Providers**: Gemini (via `google-genai`, supports audio) and OpenAI — abstracted in `backend/app/services/evaluators/llm_base.py`.
- **Background Jobs**: `job_worker.py` polls `jobs` table, dispatches to typed runners in `backend/app/services/evaluators/`.
- **Apps**: Three apps scoped by `appId`: `voice-rx`, `kaira-bot`, `kaira-evals`.

## Commands

- `docker compose up --build` — Start full stack (PostgreSQL + FastAPI + Vite).
- `npm run dev` — Frontend only (port 5173).
- `npm run build` — TypeScript check + production build.
- `npm run lint` — ESLint. `npx tsc -b` — Type check only.
- No test framework. Manual testing via Debug Panel (`Cmd+Shift+D`).

## Backend Conventions

- Pydantic schemas: `XxxCreate`, `XxxUpdate`, `XxxResponse`. Inherit `CamelModel` (requests) or `CamelORMModel` (responses) from `app/schemas/base.py`. Backend stays snake_case, API JSON is camelCase.
- Routes use `Depends(get_db)` for async sessions, direct `select()` queries.
- 13 routers registered in `backend/app/main.py`.
- Seed defaults in `seed_defaults.py` — auto-creates prompts, schemas, evaluators on startup.
- New endpoints: model → schema → route → register in `main.py`.

### Evaluation Pipeline
- **EvalRun** is the unified model for all evaluation results (`eval_type`: custom, full_evaluation, batch_thread, batch_adversarial).
- Five job types: `evaluate-voice-rx`, `evaluate-batch`, `evaluate-adversarial`, `evaluate-custom`, `evaluate-custom-batch`.
- Each maps to a runner in `backend/app/services/evaluators/`.
- Voice Rx uses a two-call pipeline: transcription (Call 1) then critique (Call 2).
- Jobs support progress tracking, cooperative cancellation, and crash recovery.
- LLM calls logged to `ApiLog` table with FK to `eval_runs`.

### LLM Provider Rules
- Both providers in `llm_base.py`. Timeout tiers: 60s (text), 90s (schema), 180s (audio), 240s (audio+schema).
- Retry with exponential backoff. Token counting for Gemini.
- Gemini supports audio files via Files API and service account auth (Vertex AI).

## Frontend Conventions

### TypeScript and Formatting
- Strict mode (`tsconfig.app.json`). Single quotes, semicolons.
- `@/` path alias → `src/`. `import type` for type-only imports.
- All types in `src/types/`, re-exported via `index.ts`.

### Components and State
- Named exports, function components, hooks only.
- Zustand: always use selectors in components — `useStore((s) => s.field)`, never `useStore()`.
- One-off reads in callbacks: `store.getState()`.
- 12 Zustand stores in `src/stores/`.
- Feature modules: `src/features/<name>/` with `components/`, `hooks/`, `utils/`, `index.ts`.

### UI and Styling
- Tailwind v4 utilities + CSS variables (`var(--text-primary)`, `var(--bg-secondary)`).
- `cn()` for class merging. Reuse components from `src/components/ui/`.

### API and Services
- `apiRequest`, `apiUpload`, `apiDownload` from `@/services/api/client`.
- Errors: `createAppError()` / `handleError()` from `@/services/errors`.
- Notifications: `notificationService.success()` / `.error()`.
- Template variables: `{{variable}}` syntax, resolved via `src/services/templates/`.

### Schema Systems
- **JSON Schema**: Used for structured LLM output enforcement.
- **Field-based** (`EvaluatorOutputField[]`): Visual builder via `InlineSchemaBuilder`, converted to JSON Schema at runtime.

## Critical Rules

- Preserve the two-call evaluation pipeline (transcribe then critique) for Voice Rx.
- Do not break `EvalRun` polymorphism — it handles all eval types via `eval_type` discriminator.
- Keep job worker patterns: progress callbacks, `is_job_cancelled()` checks, crash recovery.
- Keep prompt/schema versioning and app-scoping intact.
- Do not add new DB tables without updating models and `seed_defaults.py`.
- MyTatva API: always use `user_id: c22a5505-f514-11f0-9722-000d3a3e18d5`.

## Agent Workflow

- Prefer small, surgical diffs over wide refactors.
- Match nearby code style before introducing new patterns.
- Validate with targeted lint/type-check first; escalate to full build for risky changes.
- Read adjacent code before making architectural decisions.
- For Python tooling, use `pyenv activate venv-python-ai-evals-arize`; do not install globally.

## Config References

- ESLint: `eslint.config.js`. TypeScript: `tsconfig.app.json`. Vite: `vite.config.ts`.
- Backend config: `backend/app/config.py` (all from env vars / `.env.backend`).
- Copilot rules: `.github/copilot-instructions.md`.
