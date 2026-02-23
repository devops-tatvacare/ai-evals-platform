# AGENTS.md

Operational guide for coding agents working in this repository.
Prefer existing abstractions and local patterns over new architecture.

## Rule precedence

1. Direct user instruction.
2. This file.
3. `.github/copilot-instructions.md` (if still consistent with current code).
4. Existing code patterns in touched files.

## Current project state

- Frontend: React 19, TypeScript strict, Vite 7, Tailwind v4, Zustand.
- Backend: FastAPI, async SQLAlchemy 2, asyncpg, Python 3.12.
- DB: PostgreSQL 16, JSON/JSONB-heavy schema.
- App IDs in active use: `voice-rx`, `kaira-bot`.
- `kaira-evals` appId has been removed from frontend app settings state.
- API routers registered in `backend/app/main.py`: 14 routers.
- ORM tables: 15 total (`eval_runs`, `jobs`, `listings`, `files`, `prompts`, `schemas`, `evaluators`, `chat_sessions`, `chat_messages`, `history`, `settings`, `tags`, `thread_evaluations`, `adversarial_evaluations`, `api_logs`).

## Build, lint, run, and test commands

### Full stack (recommended for integration work)

- `docker compose up --build` - start Postgres + backend + frontend.
- `docker compose down` - stop services.
- `docker compose down -v` - stop and wipe DB volume.
- `docker compose logs -f backend` - tail backend logs.

### Frontend only

- `npm run dev` - Vite dev server on `:5173`.
- `npm run build` - production build (`tsc -b && vite build`).
- `npm run lint` - ESLint across repo.
- `npx tsc -b` - typecheck only.
- Targeted lint: `npm run lint -- src/path/to/file.tsx` or `npx eslint src/path/to/file.tsx`.

### Backend only (local Python)

- `pyenv activate venv-python-ai-evals-arize`.
- `pip install -r backend/requirements.txt` (inside that venv only).
- `PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721`.

### Test status and single-test guidance

- Current state: no committed automated test framework (no pytest/vitest/playwright test config in repo).
- For UI validation, use manual flows plus Playwright MCP checks (see UI section below).
- If introducing tests, use single-test commands:
  - Backend pytest single test: `python -m pytest backend/tests/test_file.py::test_name -q`.
  - Vitest single test: `npx vitest run src/path/file.test.ts -t "test name"`.
  - Playwright single spec: `npx playwright test tests/path.spec.ts -g "scenario"`.

## Frontend coding conventions

### Imports and modules

- Use `@/` alias for internal imports (`@` maps to `src`).
- Prefer `import type` for type-only imports.
- Keep import groups ordered: external packages, then internal `@/`.
- Reuse barrels where available (`src/services/api/index.ts`, `src/stores/index.ts`, feature `index.ts`).

### Formatting and TypeScript

- Strict TypeScript is enforced (`tsconfig.app.json`); do not bypass with `any` unless unavoidable.
- Match local file style; dominant style is single quotes + semicolons.
- Use explicit interfaces/types for API payloads and store state.
- Keep date parsing explicit at API edges (see `parseDates` patterns in repositories).

### React and state

- Function components and hooks.
- Prefer named exports for new feature code; keep existing default exports where already established.
- Zustand in components: always select slices (`useStore((s) => s.value)`), never full store object.
- One-off reads in async logic/callbacks: `useStore.getState()`.

### API and service boundaries

- Use `apiRequest`/`apiUpload`/`apiDownload` from `src/services/api/client.ts`.
- Use repository wrappers from `src/services/api/` or `src/services/storage/`; avoid ad-hoc `fetch` in components.
- Use route constants from `src/config/routes.ts` instead of hardcoded route strings.

### Error handling and notifications

- Normalize errors with `err instanceof Error ? err.message : 'fallback'`.
- User-facing failures should go through `notificationService.error(...)`.
- Use `notificationService.success/info/warning` for user feedback.
- Use `logger`/`evaluationLogger` for diagnostic logging, not random `console.log` in production paths.

### UI styling

- Use Tailwind v4 + design tokens from `src/styles/globals.css`.
- Prefer CSS variables (`var(--text-primary)`, `var(--bg-secondary)`, etc.) over hardcoded values.
- Use `cn()` (`src/utils/cn.ts`) for class merging.
- Reuse shared primitives in `src/components/ui/` before creating new variants.

## Backend coding conventions

### API and schema contracts

- Keep Python internals in snake_case; API JSON is camelCase via `CamelModel`/`CamelORMModel`.
- Request/response schema naming: `XxxCreate`, `XxxUpdate`, `XxxResponse`.
- Routes use async sessions via `Depends(get_db)` and SQLAlchemy `select()`.
- Raise `HTTPException` for client errors with stable `detail` messages.

### Data model paradigm (domain model)

- `EvalRun` is the unified record for all evaluation outcomes.
- Keep `eval_type` polymorphism intact (`custom`, `full_evaluation`, `human`, `batch_thread`, `batch_adversarial`).
- Keep FK + cascade behavior intact (`listings/chat_sessions -> eval_runs -> thread/adversarial/api_logs`).
- Prompts and schemas are versioned and app-scoped; keep versioning semantics when writing new rows.

### Job worker and evaluators

- `job_worker.py` is the dispatch entrypoint for background execution.
- Registered job types: `evaluate-voice-rx`, `evaluate-batch`, `evaluate-adversarial`, `evaluate-custom`, `evaluate-custom-batch`.
- Preserve cooperative cancellation (`is_job_cancelled()` checks) and progress updates (`update_job_progress`).
- Keep crash recovery paths (`recover_stale_jobs`, `recover_stale_eval_runs`) working.

### LLM abstractions

- Always use provider factory/wrapper in `backend/app/services/evaluators/llm_base.py`.
- Do not call OpenAI/Gemini SDKs directly from runners.
- Respect timeout tiers and retry behavior already implemented in base providers.

### Voice Rx critical invariants

- Preserve two-call flow: transcription first, critique second.
- Critique step is text-only (`generate_json`), not audio.
- Evaluation prompt/schema for standard Voice Rx flow are server-controlled in runner constants.
- Compute summary/statistics server-side from known data, not LLM-reported counts.

## Respect abstractions (example)

- Good: use `submitAndPollJob(...)` from `src/services/api/jobPolling.ts` for async job lifecycle.
- Avoid: custom polling loops in components that repeatedly call `jobsApi.get(...)` and duplicate abort/retry logic.

## UI fixes and Playwright validation

When changing UI behavior, validate both correctness and regressions:

1. Run `npm run lint` (or targeted lint) and `npx tsc -b`.
2. Run app (`docker compose up --build` or frontend dev + backend).
3. Validate desktop and mobile widths for touched views.
4. Use Playwright MCP to exercise the changed flow and check console/network errors.

Minimum acceptance criteria for UI changes:

- Changed workflow succeeds end-to-end.
- No uncaught runtime error in browser console during flow.
- No severe layout break on mobile and desktop.
- Toast/error messages remain actionable.

## Common pitfalls

- Do not reintroduce `kaira-evals` as an appId in frontend stores/settings.
- Many backend list/get endpoints require `app_id` query param; do not omit it.
- `settings` API treats global scope as empty string app_id (`''`), not `null`.
- Keep listing `source_type` rules intact (no upload/API data mixing).
- Do not bypass repository/service layers for quick direct DB/API access.
- If adding DB tables or changing model shape, update models, schemas, startup seeding, and affected routes together.
- For local Python scripts/tools, always use `pyenv activate venv-python-ai-evals-arize`; avoid global installs.
- Use Docker when you need faithful integration behavior across frontend/backend/DB.

## External agent-rule files

- Copilot rules exist at `.github/copilot-instructions.md`.
- Cursor rules not found (`.cursorrules` and `.cursor/rules/` absent at time of writing).
- If Copilot instructions conflict with live code (for example older IndexedDB notes), follow current codebase and this file.

## Fixed integration constant

- MyTatva default user id for Kaira flows: `c22a5505-f514-11f0-9722-000d3a3e18d5`.
