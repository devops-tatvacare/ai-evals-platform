# AGENTS.md

Guidance for coding agents working in this repository. Prefer existing patterns over invention.

## Stack and architecture

- Frontend: React 19 + TypeScript (strict) + Vite 7 + Tailwind CSS v4.
- State: Zustand stores (persisted settings + task queue + app context).
- Storage: Dexie/IndexedDB with `listings`, `files`, and unified `entities` records.
- LLM: provider-based architecture in `src/services/llm/`, currently Gemini via `@google/genai`.
- Core eval flow is two calls: transcription (Call 1) then critique/judge (Call 2).

## Build, lint, and test commands

Use npm unless the task explicitly says otherwise.

### Core commands

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Build (typecheck + prod bundle): `npm run build`
- Lint all files: `npm run lint`
- Preview production build: `npm run preview`

### Single-test / targeted validation

There is no Jest/Vitest test suite configured in this repo.

- Closest equivalent to a single test is targeted linting:
  - `npm run lint -- src/path/to/file.ts`
  - `npx eslint src/path/to/file.ts`
- Type-check only:
  - `npx tsc -b`
- For changes in one area, run lint/type-check on touched files first, then run full `npm run build` if needed.

### Manual verification

- Use Debug Panel: `Ctrl+Shift+D` (Windows/Linux) or `Cmd+Shift+D` (macOS).
- Review `docs/storage-consolidation/README.md` for storage-oriented manual checks.

## Project conventions

### TypeScript and formatting

- Write TypeScript in `src/` (strict mode enforced by `tsconfig.app.json`).
- Use single quotes and semicolons.
- Keep functions focused and composable; extract helpers instead of growing components.
- Avoid adding comments unless the logic is genuinely non-obvious.

### Imports

- Use `@/` path alias for internal modules.
- Use `import type` for type-only imports.
- Import order: external packages first, then internal `@/...`.
- Keep imports reasonably sorted within each group.

### Naming

- Components: `PascalCase` and named exports.
- Hooks: `useXxx`.
- Variables/functions: `camelCase`.
- Top-level constants: `UPPER_SNAKE_CASE`.

### Types

- Prefer explicit types at exported/public boundaries.
- Prefer `unknown` over `any`; narrow with guards.
- Use unions for finite value sets.
- Use `Record<string, unknown>` for dynamic object maps.

## React + Zustand rules

- Use function components and hooks.
- Keep side effects in `useEffect` with tight dependencies.
- Do not call Zustand stores as `useStore()` without selectors in components.
  - Good: `useSettingsStore((s) => s.llm)`
  - Avoid: `const store = useSettingsStore()`
- For one-off reads inside callbacks/services, use `store.getState()`.
- Keep store actions thin; move heavier logic into services.

## Evaluation flow rules

- Preserve the two-call evaluation pipeline and existing orchestration in `src/features/evals/hooks/`.
- Keep prompt/schema behavior compatible with existing variable resolution and schema enforcement.
- Do not break segment-aligned evaluation assumptions (time windows, segment counts, schema shape).
- Keep LLM operations cancellable and consistent with existing retry/timeout/progress patterns.

## Storage and data access

- Use repositories in `src/services/storage/`; avoid ad-hoc Dexie table access in feature code.
- Continue using entity discrimination (`type`, `key`, `appId`, `data`) for prompts/schemas/settings/chat data.
- Do not add new IndexedDB tables without migration/docs updates.

## Error handling and logging

- Use typed app error patterns (`createAppError`, `handleError`) where applicable.
- Log through `src/services/logger` helpers with contextual metadata.
- Show user-safe errors via `notificationService`.
- Prefer short user-facing messages and richer structured context in logs.

## UI and styling

- Use Tailwind v4 utility patterns already present in the repo.
- Use CSS variables for theme colors (e.g., `var(--text-primary)`, `var(--bg-secondary)`).
- Use `cn` for class merging.
- Reuse existing UI components from `src/components/ui` before introducing new primitives.

## Config references

- ESLint: `eslint.config.js` (TS + React hooks + React refresh).
- TypeScript: `tsconfig.app.json` (strict, `noUnusedLocals`, `noUncheckedSideEffectImports`).
- Vite: `vite.config.ts` (`@` alias + Tailwind plugin).

## Cursor and Copilot instructions

- Cursor rules check:
  - `.cursor/rules/`: not present
  - `.cursorrules`: not present
- Copilot rules file exists at `.github/copilot-instructions.md`.

Important Copilot-aligned constraints to preserve:

- Keep the two-call evaluation design (transcribe then critique).
- Respect the distinction between JSON schema usage and field-based evaluator schema usage.
- Use repository/storage patterns; avoid new tables.
- Follow Zustand selector/getState patterns to avoid re-render loops.
- Keep template variable and provider-registry patterns intact.
- Keep MyTatva session semantics and fixed user ID behavior unchanged.
- For Python tooling in this repo context, use `pyenv activate venv-python-ai-evals-arize`; do not install globally.

## MyTatva API rules (critical)

- Always use `user_id`: `c22a5505-f514-11f0-9722-000d3a3e18d5`.
- First call: `thread_id: null`, `session_id: null`, `end_session: true`.
- Follow-up calls: reuse returned `thread_id` + `session_id`, set `end_session: false`.
- Relevant endpoints: `/chat`, `/chat/stream`, `/chat/stream/upload`, `/feedback`, `/speech-to-text`.

## Agent workflow expectations

- Prefer small, surgical diffs over wide refactors.
- Match nearby code style and naming before introducing new patterns.
- Validate with targeted lint/type-check first; escalate to full build for risky changes.
- If behavior or architecture is ambiguous, inspect adjacent feature code before deciding.
