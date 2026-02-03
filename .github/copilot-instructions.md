# AI Evals Platform - Copilot Instructions

## CRITICAL: MyTatva API Usage

MANDATORY rules for https://mytatva-ai-orchestrator-prod.goodflip.in API:

**user_id**: ALWAYS use `c22a5505-f514-11f0-9722-000d3a3e18d5` (never make up test/dummy IDs)

**thread_id, session_id, response_id, end_session**: Use from API response (never fabricate)
- First call: Set `thread_id`, `session_id` to `null` and `end_session: true`
- Subsequent calls: Use values from first response with `end_session: false`

```typescript
// First call - starts new session
const res = await fetch('https://mytatva-ai-orchestrator-prod.goodflip.in/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What is my blood sugar?',
    user_id: 'c22a5505-f514-11f0-9722-000d3a3e18d5',
    thread_id: null,
    session_id: null,
    end_session: true  // true for first message
  })
});
const data = await res.json();
// Extract: data.thread_id, data.session_id, data.response_id

// Subsequent call - continues session
await fetch('https://mytatva-ai-orchestrator-prod.goodflip.in/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'Follow-up question',
    user_id: 'c22a5505-f514-11f0-9722-000d3a3e18d5',
    thread_id: data.thread_id,
    session_id: data.session_id,
    end_session: false  // false for subsequent messages
  })
});
```

Key endpoints: `/chat`, `/chat/stream`, `/chat/stream/upload`, `/feedback`, `/speech-to-text`

## Build & Development

```bash
npm run dev       # Vite dev server
npm run build     # TypeScript check + production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

No test framework configured.

## Architecture

**Two-Call LLM Evaluation Flow:**
1. Call 1 (Transcription): Audio → AI transcript via `EvaluationService.transcribe()`
2. Call 2 (Critique): Audio + Original + AI transcript → Per-segment critique via `EvaluationService.critique()`

Orchestrated by `useAIEvaluation` hook in `src/features/evals/hooks/`.

**Template Variables** (`src/services/templates/`):
- Prompts use `{{audio}}`, `{{transcript}}`, `{{llm_transcript}}`, etc.
- Registry defines available variables per prompt type
- Resolver replaces variables at runtime from listing context

**Storage** (IndexedDB via Dexie):
- `listings` table: Evaluation records
- `files` table: Binary blobs (audio)
- `entities` table: Prompts, schemas, settings, chat data (entity discrimination pattern)

**State Management** (Zustand):
- `settingsStore`: Persisted settings with versioned migrations
- `listingsStore`: In-memory listing cache
- `promptsStore`/`schemasStore`: Loaded from entities
- `taskQueueStore`: Background task tracking
- `uiStore`: UI state (sidebar, modals)

## Key Conventions

**Types**: Import from `@/types` (all types in `src/types/`, re-exported via `index.ts`)
```typescript
import type { Listing, AIEvaluation, TranscriptData } from '@/types';
```

**Path Alias**: `@/` points to `src/`
```typescript
import { useSettingsStore } from '@/stores';
import { GeminiProvider } from '@/services/llm';
```

**Zustand Store Usage**: Use direct selectors to avoid re-render loops
```typescript
// In functions - use getState()
const llm = useSettingsStore.getState().llm;

// In components - use specific selector
const transcription = useSettingsStore((state) => state.transcription);

// NEVER: const store = useSettingsStore(); // Re-renders on ANY change
```

**Notifications** (Sonner):
```typescript
import { notificationService } from '@/services/notifications';
notificationService.success('Done');
notificationService.error('Failed', { description: 'Try again' });
```

**Background Tasks**: Use `taskQueueStore` for long operations
```typescript
const { addTask, updateTaskProgress, completeTask } = useTaskQueueStore.getState();
const taskId = addTask({ type: 'ai-evaluation', description: 'Evaluating...' });
updateTaskProgress(taskId, 0.5);
completeTask(taskId);
```

**Logging**: Use logger service for significant operations
```typescript
import { evaluationLogger } from '@/services/logger';
evaluationLogger.log('Started evaluation', { listingId, promptVersion });
```

**Storage**: Use repositories, not direct Dexie access
```typescript
import { listingsRepository, filesRepository } from '@/services/storage';
await listingsRepository.save(listing);
```

## Development Guidelines

- **Separation of concerns**: Business logic in services/hooks, UI in components, state in stores
- **No new patterns**: Use existing Zustand stores, UI components from `src/components/ui/`
- **Feature structure**: New features go in `src/features/` with components/hooks/index.ts
- **No hardcoding**: Use constants, config, or settings
- **Systematic approach**: Understand existing flow before modifying

**Before deviating from patterns**: Ask for approval first.

**Debug Panel**: `Ctrl+Shift+D` (Mac: `Cmd+Shift+D`) - logs all significant operations

## Python Environment

Always use the pyenv virtual environment:
```bash
pyenv activate venv-python-ai-evals-arize
pip install <package>
python script.py
```

Never install packages globally.
