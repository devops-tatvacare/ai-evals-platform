# Voice RX Evaluator - Copilot Instructions

## Build & Development Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # TypeScript check + Vite production build
npm run lint      # Run ESLint on all .ts/.tsx files
npm run preview   # Preview production build locally
```

No test framework is configured.

## Architecture Overview

### Two-Call LLM Evaluation Flow

The core evaluation system uses a two-call LLM pattern:

1. **Call 1 (Transcription)**: Audio → AI-generated transcript via `EvaluationService.transcribe()`
2. **Call 2 (Critique)**: Audio + Original transcript + AI transcript → Per-segment critique via `EvaluationService.critique()`

This flow is orchestrated by `useAIEvaluation` hook in `src/features/evals/hooks/`.

### Template Variable System

Prompts use template variables (`{{audio}}`, `{{transcript}}`, `{{llm_transcript}}`) resolved at runtime:

- **Registry**: `src/services/templates/variableRegistry.ts` defines available variables per prompt type
- **Resolver**: `src/services/templates/variableResolver.ts` resolves variables from listing context
- Variables are validated before evaluation runs; unknown variables show warnings in the UI

### Data Layer

- **Storage**: IndexedDB via Dexie (`src/services/storage/db.ts`)
- **State**: Zustand stores in `src/stores/` (settings, listings, UI, task queue, schemas)
- **Persistence**: Settings use Zustand persist middleware with versioned migrations

### Feature Module Structure

Each feature in `src/features/` is self-contained with:
```
feature/
├── components/   # React components
├── hooks/        # Feature-specific hooks
├── index.ts      # Public exports
└── utils/        # (optional) Feature utilities
```

Key features: `evals` (AI/human evaluation), `listings` (CRUD), `settings`, `upload`, `transcript`, `export`.

## Key Conventions

### Type Definitions

All types are in `src/types/` and re-exported through `src/types/index.ts`. Import from `@/types`:
```typescript
import type { Listing, AIEvaluation, TranscriptData } from '@/types';
```

### Path Aliases

The `@/` alias points to `src/`. Always use it for imports:
```typescript
import { useSettingsStore } from '@/stores';
import { GeminiProvider } from '@/services/llm';
```

### LLM Provider Pattern

To add a new LLM provider:
1. Create provider class in `src/services/llm/` implementing the same interface as `GeminiProvider`
2. Register in `src/services/llm/providerRegistry.ts`

### Export Format Pattern

To add a new export format:
1. Create exporter in `src/services/export/exporters/` implementing `Exporter` interface
2. Register in `src/services/export/index.ts`

### Evaluation Types

Critique severity levels: `'none' | 'minor' | 'moderate' | 'critical'`
Likely correct values: `'original' | 'judge' | 'both' | 'unclear'`
Confidence levels: `'high' | 'medium' | 'low'`

### Constants

Default prompts and model configs are in `src/constants/`. When modifying default prompts, increment `SETTINGS_VERSION` in `settingsStore.ts` and add migration logic.

## Development Guidelines

### Follow Existing Patterns

- **Separation of concerns**: Keep business logic in services/hooks, UI in components, state in Zustand stores
- **State management**: Use existing Zustand stores; don't introduce new state patterns without approval
- **Design system**: Use existing UI components from `src/components/ui/`; don't create one-off styled components
- **Feature structure**: New features go in `src/features/` following the established module pattern

### Before Deviating

If you feel something needs to be extended or the current layout doesn't fit:
1. **Stop and ask** the user for approval before implementing
2. Explain what pattern you'd like to change and why
3. Wait for confirmation before proceeding

### Code Quality

- **No hardcoding**: Use constants, config, or settings for values that might change
- **No ad-hoc fixes**: Implement proper solutions following existing patterns, even if it takes longer
- **Systematic approach**: Understand the existing flow before modifying; trace through related files

### Debug Panel Integration

All fixes and features must log to the debug panel (`src/features/debug/`):
- Use the logger service (`src/services/logger/`) for significant operations
- Evaluation-related changes should use `src/services/logger/evaluationLogger.ts`
- Include relevant context (IDs, counts, error messages) in log entries

## Python Environment

When running Python scripts (for testing, evaluation, or automation):

```bash
# Activate the virtual environment first
pyenv activate venv-python-ai-evals-arize

# Install any required packages in this environment
pip install <package>

# Run scripts within this environment
python script.py
```

**Important**: Always use the `venv-python-ai-evals-arize` pyenv environment. Do not install packages globally.
