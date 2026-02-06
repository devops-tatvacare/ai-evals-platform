# AI Evals Platform - Copilot Instructions

## Build & Development

```bash
npm install       # Install dependencies
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # TypeScript check + Vite production build
npm run lint      # ESLint on all files
npm run preview   # Preview production build
```

**Targeted linting:** `npm run lint -- <path>` or `npx eslint <path>`
**Type-only check:** `npx tsc -b`

**No test framework configured** - Manual testing via Debug Panel (`Ctrl+Shift+D` or `Cmd+Shift+D`)

## Architecture Overview

### Two-Call LLM Evaluation Flow

The core evaluation pattern:
1. **Call 1 (Transcription)**: Audio → AI transcript via `EvaluationService.transcribe()`
2. **Call 2 (Critique)**: Audio + Original + AI transcript → Per-segment critique via `EvaluationService.critique()`

Orchestrated by `useAIEvaluation` hook in `src/features/evals/hooks/`.

### Schema Systems (Two Different Formats)

**1. JSON Schema (for AI evaluation prompts)**
- Used in: `SchemaDefinition` type, stored in `entities` table
- Format: Standard JSON Schema objects
- Used by: EvaluationOverlay transcription/evaluation schemas
- Passed to: Gemini SDK for structured output enforcement

**2. Field-Based Schema (for custom evaluators)**
- Used in: `EvaluatorOutputField[]` type
- Format: Array of field definitions with key/type/description/displayMode
- Used by: CreateEvaluatorOverlay, custom evaluators
- Conversion: `generateJsonSchema()` converts to JSON Schema at runtime
- Component: `InlineSchemaBuilder` provides visual field builder

**When adding schema features:**
- EvaluationOverlay uses JSON Schema (SchemaDefinition)
- CreateEvaluatorOverlay uses EvaluatorOutputField[] (converts via generateJsonSchema)
- InlineSchemaBuilder bridges both: visual builder → EvaluatorOutputField[] → JSON Schema

### Storage Architecture (IndexedDB via Dexie)

**Database:** `ai-evals-platform`

**Tables:**
- `listings`: Evaluation records (audio metadata, transcript, AI results)
- `files`: Binary blobs (audio files keyed by UUID)
- `entities`: Unified storage using entity discrimination pattern

**Entity Discrimination Pattern:**
```typescript
{
  type: 'prompt' | 'schema' | 'setting' | 'chatSession' | 'chatMessage',
  key: string,          // Unique identifier
  appId: string,        // 'voice-rx' | 'kaira-bot' | 'global'
  data: Record<string, unknown>,  // Flexible payload
  createdAt: Date,
  updatedAt: Date
}
```

**Why this pattern:** Enables schema-less flexibility with type safety via entity.data. Avoid creating new tables - use entities with new type discriminator instead.

### State Management (Zustand)

**Critical stores:**
- `settingsStore`: Persisted settings with versioned migrations (IndexedDB backend)
- `listingsStore`: In-memory listing cache
- `promptsStore`/`schemasStore`: Loaded from entities, filtered by appId
- `taskQueueStore`: Background task tracking with progress
- `uiStore`: UI state (sidebar, modals, selection)
- `appStore`: Current app context ('voice-rx' | 'kaira-bot')

**Zustand Anti-Pattern (causes infinite loops):**
```typescript
// ❌ NEVER: Re-renders on ANY store change
const store = useSettingsStore();

// ✅ In components: Use specific selector
const transcription = useSettingsStore((state) => state.transcription);

// ✅ In functions/callbacks: Use getState()
const llm = useSettingsStore.getState().llm;
```

### Template Variable System

**Location:** `src/services/templates/`

Prompts use template variables resolved at runtime from listing context:

**Available variables:**
- `{{audio}}` - Audio file (special handling as media)
- `{{transcript}}` - Original transcript text
- `{{llm_transcript}}` - AI-generated transcript (from Call 1)
- `{{time_windows}}` - Formatted time windows for segment alignment
- `{{segment_count}}` - Number of segments
- `{{language_hint}}`, `{{script_preference}}`, `{{preserve_code_switching}}` - Transcription preferences

**Implementation:**
- Registry: `variableRegistry.ts` defines available variables per prompt type
- Resolver: `variableResolver.ts` replaces variables from listing context
- Validator: `variableValidator.ts` checks for unknown/missing variables

### LLM Provider System

**Location:** `src/services/llm/`

**Interface:** All providers implement `ILLMProvider`
```typescript
interface ILLMProvider {
  name: string;
  generateContent(prompt: string, options?: LLMGenerateOptions): Promise<LLMResponse>;
  generateContentWithAudio(prompt: string, audioBlob: Blob, mimeType: string, options?: LLMGenerateOptions): Promise<LLMResponse>;
  cancel(): void;
}
```

**Current provider:** `GeminiProvider` (Google Gemini SDK)
**Registry:** `providerRegistry.ts` - register new providers here
**Pipeline:** `pipeline/LLMInvocationPipeline.ts` - unified invocation layer with timeouts, progress tracking, schema validation

## Key Conventions

### Imports & Paths

**Path alias:** `@/` → `src/`
```typescript
import { useSettingsStore } from '@/stores';
import { GeminiProvider } from '@/services/llm';
import type { Listing, AIEvaluation } from '@/types';
```

**Type imports:** Prefer `import type` for type-only imports
**Import groups:** External packages first, then internal `@/` imports
**Types location:** All types in `src/types/`, re-exported via `index.ts`

### Naming & Style

- Components: `PascalCase`, named exports
- Hooks: `useXxx` prefix
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- TypeScript: Strict mode, semicolons, single quotes

### Error Handling & Logging

**Errors:**
```typescript
import { createAppError, handleError } from '@/services/errors';

// Create typed errors
const error = createAppError('LLM_API_ERROR', 'Request failed', { status: 500 });

// Normalize and handle
handleError(error, { listing: listingId });
```

**Logging:**
```typescript
import { evaluationLogger } from '@/services/logger';
evaluationLogger.log('Started evaluation', { listingId, promptVersion });
```

**Notifications:**
```typescript
import { notificationService } from '@/services/notifications';
notificationService.success('Schema saved');
notificationService.error('Failed', { description: 'Try again' });
```

### Storage Access

**Always use repositories, not direct Dexie:**
```typescript
import { listingsRepository, filesRepository } from '@/services/storage';
await listingsRepository.save(listing);
await filesRepository.saveAudioBlob(audioBlob, listingId);
```

**Entity storage:**
```typescript
import { entitiesRepository } from '@/services/storage';
await entitiesRepository.save('schema', schemaId, appId, schemaData);
```

### Background Tasks

For long-running operations:
```typescript
import { useTaskQueueStore } from '@/stores';

const { addTask, updateTaskProgress, completeTask } = useTaskQueueStore.getState();

const taskId = addTask({ 
  type: 'ai-evaluation', 
  description: 'Evaluating transcript...' 
});

// Update progress (0-1)
updateTaskProgress(taskId, 0.5);

// Complete or fail
completeTask(taskId);
// or
failTask(taskId, error);
```

## Feature Module Structure

New features go in `src/features/<feature-name>/`:
```
feature-name/
├── components/     # Feature-specific UI
├── hooks/          # Feature-specific hooks
├── utils/          # Feature-specific utilities
└── index.ts        # Public exports
```

**Existing features:**
- `evals/` - AI & human evaluation workflows
- `settings/` - Prompts, schemas, LLM config
- `upload/` - File upload & validation
- `transcript/` - Transcript view with audio player
- `listings/` - Listing CRUD and list views
- `export/` - Export formats (JSON, CSV, PDF)
- `debug/` - Debug panel with logs & storage inspector

## React & Component Patterns

**Function components only:**
```typescript
export function MyComponent({ prop }: MyComponentProps) {
  // Use forwardRef when needed, set displayName
  return <div>{prop}</div>;
}
```

**Hooks:**
- Keep pure, side-effects in `useEffect` with tight dependencies
- Don't destructure Zustand state into effect deps
- Prefer `useStore((state) => state.value)` over `useStore()`

**Styling:**
- Tailwind CSS v4 with CSS variables
- Use `cn()` utility for class merging
- Theme colors via CSS variables: `var(--text-primary)`, `var(--bg-secondary)`
- Components in `src/components/ui/`, feature UI in `src/features/`

## Development Guidelines

1. **Separation of concerns:** Business logic → services/hooks, UI → components, state → stores
2. **Use existing patterns:** Don't introduce new state management, routing, or UI component patterns
3. **Feature structure:** Follow existing feature module layout
4. **No hardcoding:** Use constants from `src/constants/`, config, or settings
5. **Systematic approach:** Understand existing flow before modifying

**Before deviating from established patterns, ask for approval.**

## CRITICAL: MyTatva API Usage

For MyTatva orchestrator integration:

**user_id:** ALWAYS use `c22a5505-f514-11f0-9722-000d3a3e18d5` (never fabricate IDs)

**Session management:**
- First call: `thread_id: null`, `session_id: null`, `end_session: true`
- Subsequent: Use `thread_id` and `session_id` from response, `end_session: false`

```typescript
// First call
const res = await fetch('https://mytatva-ai-orchestrator-prod.goodflip.in/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What is my blood sugar?',
    user_id: 'c22a5505-f514-11f0-9722-000d3a3e18d5',
    thread_id: null,
    session_id: null,
    end_session: true
  })
});
const data = await res.json();

// Subsequent call
await fetch('...', {
  body: JSON.stringify({
    query: 'Follow-up',
    user_id: 'c22a5505-f514-11f0-9722-000d3a3e18d5',
    thread_id: data.thread_id,
    session_id: data.session_id,
    end_session: false
  })
});
```

Key endpoints: `/chat`, `/chat/stream`, `/chat/stream/upload`, `/feedback`, `/speech-to-text`

## Debugging

**Debug Panel:** `Ctrl+Shift+D` (Mac: `Cmd+Shift+D`)
- View evaluation logs
- Inspect task queue
- Check storage usage
- Export logs

**Browser DevTools:**
- Application → IndexedDB → `ai-evals-platform` database
- Console for logger output
- Network for API calls

## Configuration Files

- ESLint: `eslint.config.js` (React hooks + TS ESLint)
- TypeScript: `tsconfig.app.json` (strict, noUnusedLocals, noUncheckedSideEffectImports)
- Vite: `vite.config.ts` (alias `@` to `src`, Tailwind v4 plugin)
- Tailwind: CSS-first configuration in `src/index.css`

## Python Environment

Always use the pyenv virtual environment:
```bash
pyenv activate venv-python-ai-evals-arize
pip install <package>
python script.py
```

Never install packages globally.
