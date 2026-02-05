# AGENTS.md

This guide orients agentic coding assistants working in this repo.
Keep changes aligned with existing patterns and repo conventions.

## Repo overview

- Stack: React 18/19 + TypeScript (strict) + Vite 7 + Tailwind CSS v4.
- State: Zustand stores with persist middleware and IndexedDB (Dexie).
- LLM: Google Gemini SDK via provider interface.
- Storage: entity table pattern (entities/listings/files) in IndexedDB.

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
- Avoid introducing non-ASCII characters unless the file already uses them.

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
- Prefer `useStore((state) => state.value)` to avoid infinite loops.

### State management (Zustand)

- Store selectors should be stable; avoid passing objects as deps.
- When reading fresh store values inside callbacks, use `getState()`.
- Keep store actions small; prefer service layer for heavy logic.

### Error handling and logging

- Normalize errors via `createAppError` and `handleError`.
- Use `logger` in `src/services/logger` for structured logs.
- Include a short, user-safe message plus `context` for debugging.
- Use `AppError` codes defined in `src/types` and `ERROR_MESSAGES`.

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

## Architecture and file layout

- `src/app/`: app entry, routing, providers.
- `src/features/`: feature modules (evals, settings, upload, etc.).
- `src/services/`: business logic (LLM, storage, export, errors, logger).
- `src/stores/`: Zustand stores.
- `src/types/`: shared TS types and interfaces.
- `src/utils/`: utilities and helpers.

## Configuration references

- ESLint config: `eslint.config.js` (React hooks + TS ESLint).
- TypeScript config: `tsconfig.app.json` (strict, noUnusedLocals, noUncheckedSideEffectImports).
- Vite config: `vite.config.ts` (alias `@` to `src`).

## Operational notes

- The app is offline-first and persists data locally in IndexedDB.
- Prompts and schemas are versioned; avoid breaking JSON schemas.
- Keep UI responsive; the app supports dark/light themes.

## Cursor/Copilot rules

- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## When in doubt

- Prefer following existing patterns in nearby files.
- Ask for clarification only if the change is ambiguous or risky.
