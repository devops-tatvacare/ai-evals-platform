# CLAUDE.md

Operational guide for Claude working in this repository. Prefer existing abstractions and patterns.
At session start, read `~/.claude` project memory for context from prior conversations.

## Rule Precedence

1. Direct user instruction
2. This file
3. `.github/copilot-instructions.md`
4. Existing code patterns in touched files

## Architecture Mental Models

1. Frontend is a thin client. Business logic, LLM calls, and persistence live on the backend.
2. `EvalRun` is the central entity. Every evaluation outcome is one row; `eval_type` defines its shape.
3. Long-running work executes as background jobs. Submit a job, poll it, then load the result.
4. Zustand stores are frontend caches. PostgreSQL is the source of truth.
5. Evaluation runners call provider wrappers in `llm_base.py`, never provider SDKs directly.

## Reuse These Abstractions

- LLM calls -> `backend/app/services/evaluators/llm_base.py`
- Async evaluations -> `submitAndPollJob()` from `src/services/api/jobPolling.ts`
- HTTP -> `apiRequest` / `apiUpload` / `apiDownload` from `src/services/api/client.ts`
- Resource APIs -> `src/services/api/*.ts`
- Navigation -> `src/config/routes.ts`
- User feedback -> `notificationService.success/error/info/warning`
- Diagnostics -> `logger` / `evaluationLogger`
- CSS merging -> `cn()` from `src/utils/cn.ts`
- UI primitives -> `src/components/ui/`
- Dropdowns -> `Select` from `src/components/ui/Select.tsx`
- Searchable/multi-select -> `Combobox` from `src/components/ui/Combobox.tsx`
- Pagination -> `Pagination` from `src/components/ui/Pagination.tsx`
- Filter pills -> `FilterPills` from `src/components/ui/FilterPills.tsx`
- Chart hex colors -> `resolveColor()` from `src/utils/statusColors.ts`

## Current Registry

- Route groups (22): auth, listings, files, prompts, schemas, evaluators, chat, history, settings, tags, jobs, eval_runs, threads, llm, adversarial_config, adversarial_test_cases, admin, reports, inside_sales, apps, roles, rules
- ORM tables (29): tenants, users, refresh_tokens, listings, eval_runs, thread_evaluations, adversarial_evaluations, api_logs, tags, prompts, lsq_lead_cache, jobs, schemas, chat_sessions, chat_messages, audit_log, evaluation_analytics, files, invite_links, external_agents, apps, tenant_configs, adversarial_test_cases, evaluators, history, settings, roles, role_app_access, role_permissions
- Zustand stores (16): authStore, appStore, appSettingsStore, llmSettingsStore, globalSettingsStore, listingsStore, schemasStore, promptsStore, evaluatorsStore, chatStore, uiStore, miniPlayerStore, taskQueueStore, jobTrackerStore, crossRunStore, insideSalesStore
- LLM providers: Gemini, OpenAI, Azure OpenAI, Anthropic
- Job types (9): evaluate-voice-rx, evaluate-batch, evaluate-adversarial, evaluate-custom, evaluate-custom-batch, evaluate-inside-sales, generate-report, generate-evaluator-draft, generate-cross-run-report
- Active app IDs: `voice-rx`, `kaira-bot`, `inside-sales`

## Invariants

- Preserve `EvalRun` polymorphism and the cascade chain from listings/chat_sessions to eval_runs to dependent detail rows.
- Voice Rx always runs transcription first with audio, then critique second with text only.
- Compute Voice Rx statistics server-side from stored records, not model self-reports.
- Every user-owned query must be tenant-scoped and auth-scoped.
- `/api/auth/*` routes are the only public routes. All other routes require bearer auth.
- LLM settings are global per tenant and user at `app_id=""`; do not pass an app ID for LLM settings lookup.
- System library data belongs to `SYSTEM_TENANT_ID` and `SYSTEM_USER_ID`.
- Gemini on Vertex AI uses `Part.from_bytes()` for media. To disable thinking, omit `thinking_config`. Use `thinking_budget` only for 2.5 models and `thinking_level` only for 3+ models.
- Local and production compose stacks run a dedicated worker with `JOB_RUN_EMBEDDED_WORKER=false`.
- Do not reintroduce `kaira-evals` as an app ID anywhere in the frontend or backend.
- Do not create subdirectory agent rule files such as `agents/` or `.cursor/`. This file is the Claude-specific source of truth.

## Frontend Rules

- TypeScript strict; avoid `any`.
- Use single quotes and semicolons, matching local file style.
- Use `@/` imports for internal modules and `import type` for type-only imports.
- Keep new files on named exports unless the local pattern requires default exports.
- In components, select Zustand slices instead of reading whole stores.
- In async callbacks, use `useStore.getState()`.
- Parse dates at API boundaries, not inline in components.

## Design System Rules

- All colors MUST use CSS variables from `src/styles/globals.css`. No hex literals in `.tsx` files.
- The only files allowed to contain hex color values are `src/styles/globals.css`, `src/utils/statusColors.ts`, and `src/features/guide/styles/guide.css`.
- Z-index MUST use tokens: `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-popover(150)`, `--z-modal(200)`, `--z-tooltip(300)`, `--z-max(999)`.
- Use `<Select>` for simple dropdowns, `<Combobox>` for searchable/multi-select. No native HTML `<select>`.
- Use `<Pagination>` for all paginated lists. No copy-pasting Previous/Next button blocks.
- Use `<FilterPills>` for filter toggle pill groups.
- For chart/canvas libraries (Recharts, D3) that need hex values, use `resolveColor()` from `src/utils/statusColors.ts` or the `useResolvedColor` hook.
- Justified exceptions: D3 visualization configs, Mermaid template strings in guide pages, `report-print.css`.
- HTTP method colors use `--color-http-get/post/put/patch/delete` tokens.
- Gap type colors use `--color-gap-underspec/silent/leakage/conflicting` tokens.

## Backend Rules

- Python internals use `snake_case`; API JSON uses camelCase through `CamelModel` and `CamelORMModel`.
- Route handlers use async sessions with `Depends(get_db)`.
- Protected routes use `auth: AuthContext = Depends(get_auth_context)` or `require_permission(...)`.
- Never use `db.get()` for tenant-owned user data; use filtered `select()` queries.
- Job submission injects `tenant_id` and `user_id`; runners read them from params.
- Update model, schema, `seed_defaults.py`, and affected routes together when changing persisted data.
- Use stable `HTTPException.detail` strings for client-facing errors.

## Common Pitfalls

- Most backend list/get endpoints require `app_id`.
- `settings` uses `app_id=""` for global LLM settings, not `null`.
- `listing.source_type` matters; do not mix upload and API-flow assumptions.
- `adversarial_test_cases` and `rules` are real backend surfaces now; do not document or code around older route counts.

## Build, Run, Lint

```bash
docker compose up --build
docker compose down
docker compose logs -f backend worker

npm run build
npm run lint
npx tsc -b

pyenv activate venv-python-ai-evals-arize
PYTHONPATH=backend python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8721
PYTHONPATH=backend python -m app.worker
```

## References

- Product overview: `docs/PROJECT 101.md`
- Setup and env vars: `docs/SETUP.md`
- DevOps handover: `docs/devops-handover.md`
- Agent guide: `AGENTS.md`
- Copilot mirror: `.github/copilot-instructions.md`
