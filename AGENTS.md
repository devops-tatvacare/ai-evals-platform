# AGENTS.md

This guide orients agentic coding assistants working in this repo.
Keep changes aligned with existing patterns and repo conventions.

## Repo overview

- Stack: React 18/19 + TypeScript (strict) + Vite 7 + Tailwind CSS v4.
- State: Zustand stores with persist middleware and IndexedDB (Dexie).
- LLM: Google Gemini SDK via provider interface.
- Storage: entity table pattern (entities/listings/files) in IndexedDB.

## Architecture highlights

- Two-call evaluation flow: transcription then critique, orchestrated in `src/features/evals/hooks/`.
- Storage and state: use repositories with the `entities` table; avoid `useStore()` without selectors.

## Build, lint, test

Use npm unless the task specifies otherwise.

### Core commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build (typecheck + bundle): `npm run build`
- Lint (ESLint): `npm run lint`
- Preview prod build: `npm run preview`

### Single test or targeted runs

- There is no automated unit test runner configured (no Jest/Vitest configs).
- For focused checks, use `npm run lint -- <path>` or `npx eslint <path>`.
- For type-only validation, use `npx tsc -b` (also part of `npm run build`).

### Manual testing guidance

- See `docs/storage-consolidation/README.md` for manual test references.
- Use the in-app Debug Panel (`Ctrl+Shift+D` or `Cmd+Shift+D`).

## Code style and conventions

### Language and formatting

- TypeScript only in `src/`; strict type checking enabled.
- Use semicolons and single quotes in TS/TSX files.
- Keep functions small and prefer pure helpers where possible.

### Linting and formatting

- ESLint is the enforced style gate (`npm run lint`).
- Prettier is installed but not wired to a script; run only if asked.
- Do not add new lint rules unless required for a change.
- Keep JSX props readable; break lines only when needed.

### Imports

- Use path alias `@/` for internal imports (configured in `tsconfig.app.json`).
- Prefer `import type` for type-only imports.
- Group imports: external first, then internal `@/` imports.
- Keep imports sorted by module path within groups when reasonable.

### Types

- Favor explicit types for public function boundaries and exported APIs.
- Use `Record<string, unknown>` for generic key/value context objects.
- Use union string literals for enums (e.g., `type LogLevel = 'info' | ...`).
- Prefer `unknown` over `any` and narrow with type guards.

### Naming

- Components: `PascalCase` and named exports.
- Hooks: `useXxx` with React hook rules.
- Functions and variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for top-level constants.

### React and hooks

- Use function components; use `forwardRef` when needed and set `displayName`.
- Keep hooks pure and side-effects inside `useEffect` with tight deps.
- Do not destructure Zustand state into effect deps; use direct selectors.

### State management (Zustand)

- Store selectors should be stable; avoid passing objects as deps.
- When reading fresh store values inside callbacks, use `getState()`.
- Keep store actions small; prefer service layer for heavy logic.

### Error handling and logging

- Normalize errors via `createAppError` and `handleError`.
- Use `logger` in `src/services/logger` for structured logs.
- Include a short, user-safe message plus `context` for debugging.
- Use `AppError` codes defined in `src/types` and `ERROR_MESSAGES`.
- Use `notificationService` for user-visible success/error messages.

### Services and domain logic

- Keep domain logic in `src/services/` and `src/utils/`.
- Service files export small functions; avoid cross-layer import cycles.
- LLM providers must implement `ILLMProvider` and register in registry.

### Storage

- Storage is IndexedDB (Dexie). Use repositories in `src/services/storage/`.
- Entity pattern: `type`, `key`, `appId`, `data` with flexible payloads.
- Do not create new tables without updating storage docs and migration plan.

### Styling and UI

- Tailwind CSS v4 with CSS variables (see `src/components/ui/*`).
- Use `cn` utility for class merging.
- Prefer CSS variables for theme colors (e.g., `var(--text-primary)`).
- Components live in `src/components/` and feature-specific UI in `src/features/`.

### Prompts, schemas, and LLMs

- Prompts and schemas are versioned; avoid breaking JSON shapes.
- Template variables are resolved in `src/services/templates/`.
- Provider implementations live in `src/services/llm/` and register in `providerRegistry`.
- Keep LLM calls cancellable and respect existing retry/timeout strategies.

## Configuration references

- ESLint config: `eslint.config.js` (React hooks + TS ESLint).
- TypeScript config: `tsconfig.app.json` (strict, noUnusedLocals, noUncheckedSideEffectImports).
- Vite config: `vite.config.ts` (alias `@` to `src`).

## MyTatva API usage (critical)

- Always use user_id `c22a5505-f514-11f0-9722-000d3a3e18d5`.
- First call: `thread_id: null`, `session_id: null`, `end_session: true`.
- Subsequent calls: use returned `thread_id` and `session_id`, `end_session: false`.
- Endpoints: `/chat`, `/chat/stream`, `/chat/stream/upload`, `/feedback`, `/speech-to-text`.

## Cursor/Copilot rules

- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- Copilot instructions exist in `.github/copilot-instructions.md` and are reflected here:
  - Follow the two-call evaluation flow and schema split.
  - Use repositories for storage and avoid new tables.
  - Avoid Zustand anti-patterns; prefer selectors and `getState()`.
  - Keep template variables and LLM provider registry patterns.
  - Respect MyTatva API session rules and fixed `user_id`.
  - Python: `pyenv activate venv-python-ai-evals-arize`; never install packages globally.

## When in doubt

- Prefer following existing patterns in nearby files.
- Ask for clarification only if the change is ambiguous or risky.
