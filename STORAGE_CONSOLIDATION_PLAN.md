# Storage Layer Consolidation Plan

**Created:** 2026-02-02
**Status:** Planning Phase
**Safe Commit:** `0f1eafa` (fix: resolve IndexedDB and React infinite loop issues - working state)

---

## Current State Analysis

### What We Have Now (Messy)

```
Database: voice-rx-evaluator-v2
├── listings      → Dexie table (proper)
├── files         → Dexie table (proper, stores Blobs)
├── settings      → Dexie table (OVERLOADED - stores everything!)
│   ├── Global settings (key: "settingName")
│   ├── App settings (key: "voice-rx:settingName")
│   ├── Prompts (key: "voice-rx:prompts" → JSON array)
│   └── Schemas (key: "voice-rx:schemas" → JSON array)
├── kairaChatSessions → Dexie table (proper)
└── kairaChatMessages → Dexie table (proper)
```

### Problems With Current State

1. **Settings table is overloaded** - mixing global settings, app settings, prompts, and schemas
2. **Prompts/Schemas stored as JSON blobs** - no efficient querying, all loaded at once
3. **No proper indexes** for prompts/schemas - can't query by `promptType` efficiently
4. **Version history is inefficient** - entire array rewritten on every change
5. **Class naming inconsistency** - `VoiceRxDatabase` but app supports multiple apps

---

## Target State (Clean)

```
Database: ai-evals-db
├── listings           → id, appId, updatedAt
├── files              → id (Blobs only)
├── globalSettings     → key (shared across all apps)
├── appSettings        → appId, key (per-app settings)
├── prompts            → id, appId, promptType (dedicated table)
├── schemas            → id, appId, promptType (dedicated table)
├── kairaChatSessions  → id, appId
└── kairaChatMessages  → id, sessionId
```

### Design Principles

1. **One table per entity type** - no JSON blob arrays
2. **Simple indexes only** - no compound indexes like `[appId+promptType+version]`
3. **Filter in JavaScript** - version/type filtering done in code, not IndexedDB
4. **Stable function references** - all store methods accessed via selectors, not destructuring
5. **Consistent naming** - database and class names reflect multi-app nature

---

## Phase 1: Add Dedicated Prompts & Schemas Tables

**Goal:** Move prompts and schemas from JSON blobs in settings to proper tables.

### Changes

#### 1.1 Update db.ts Schema

```typescript
// Before
this.version(1).stores({
  listings: 'id, appId, updatedAt',
  files: 'id',
  settings: 'key',
  kairaChatSessions: 'id, appId',
  kairaChatMessages: 'id, sessionId',
});

// After (version 2)
this.version(2).stores({
  listings: 'id, appId, updatedAt',
  files: 'id',
  settings: 'key',
  prompts: 'id, appId, promptType',      // NEW
  schemas: 'id, appId, promptType',      // NEW
  kairaChatSessions: 'id, appId',
  kairaChatMessages: 'id, sessionId',
}).upgrade(tx => {
  // Migration: move prompts/schemas from settings to new tables
  // See migration code below
});
```

#### 1.2 Add Migration Logic

```typescript
.upgrade(async tx => {
  const settings = tx.table('settings');
  const prompts = tx.table('prompts');
  const schemas = tx.table('schemas');
  
  // Migrate voice-rx prompts
  const voiceRxPrompts = await settings.get('voice-rx:prompts');
  if (voiceRxPrompts?.value) {
    const items = voiceRxPrompts.value as PromptDefinition[];
    for (const item of items) {
      await prompts.add({ ...item, appId: 'voice-rx' });
    }
    await settings.delete('voice-rx:prompts');
  }
  
  // Migrate kaira-bot prompts
  const kairaBotPrompts = await settings.get('kaira-bot:prompts');
  if (kairaBotPrompts?.value) {
    const items = kairaBotPrompts.value as PromptDefinition[];
    for (const item of items) {
      await prompts.add({ ...item, appId: 'kaira-bot' });
    }
    await settings.delete('kaira-bot:prompts');
  }
  
  // Same for schemas...
});
```

#### 1.3 Update promptsRepository.ts

```typescript
// Before: uses getAppSetting/setAppSetting
const prompts = await getAppSetting<PromptDefinition[]>(appId, PROMPTS_KEY);

// After: uses db.prompts directly
const prompts = await db.prompts
  .where('appId')
  .equals(appId)
  .toArray();
```

#### 1.4 Update schemasRepository.ts

Same pattern as prompts.

### Phase 1 Tests

| Test | Command/Action | Expected Result |
|------|----------------|-----------------|
| Build passes | `npm run build` | No TypeScript errors |
| App loads | Open in Firefox | No console errors, sidebar shows |
| Existing data migrated | Check IndexedDB in DevTools | `prompts` and `schemas` tables exist with data |
| Settings table cleaned | Check IndexedDB | No `voice-rx:prompts` or `voice-rx:schemas` keys |
| Create new prompt | Settings → Prompts → Add | New prompt appears in `prompts` table |
| Create new schema | Settings → Schemas → Add | New schema appears in `schemas` table |
| Upload works | New → Upload files | Listing created, no errors |
| Evaluation works | Open listing → Run AI Eval | Completes without hang |

---

## Phase 2: Split Settings Table

**Goal:** Separate global settings from app-specific settings.

### Changes

#### 2.1 Update db.ts Schema

```typescript
// Version 3
this.version(3).stores({
  listings: 'id, appId, updatedAt',
  files: 'id',
  globalSettings: 'key',                 // RENAMED from settings
  appSettings: 'id, appId, key',         // NEW structure
  prompts: 'id, appId, promptType',
  schemas: 'id, appId, promptType',
  kairaChatSessions: 'id, appId',
  kairaChatMessages: 'id, sessionId',
}).upgrade(async tx => {
  const oldSettings = tx.table('settings');
  const globalSettings = tx.table('globalSettings');
  const appSettings = tx.table('appSettings');
  
  const all = await oldSettings.toArray();
  for (const item of all) {
    if (item.key.includes(':')) {
      // App-specific: "voice-rx:theme" → appId="voice-rx", key="theme"
      const [appId, key] = item.key.split(':');
      await appSettings.add({ appId, key, value: item.value });
    } else {
      // Global setting
      await globalSettings.add({ key: item.key, value: item.value });
    }
  }
});
```

#### 2.2 Update db.ts Helper Functions

```typescript
// Global settings (unchanged interface)
export async function getGlobalSetting<T>(key: string): Promise<T | undefined> {
  const result = await db.globalSettings.get(key);
  return result?.value as T | undefined;
}

// App settings (new table-based implementation)
export async function getAppSetting<T>(appId: AppId, key: string): Promise<T | undefined> {
  const result = await db.appSettings
    .where('appId').equals(appId)
    .filter(s => s.key === key)
    .first();
  return result?.value as T | undefined;
}
```

#### 2.3 Remove Old Settings Table

```typescript
// Version 4 - cleanup
this.version(4).stores({
  settings: null,  // DELETE old table
  // ... rest unchanged
});
```

### Phase 2 Tests

| Test | Command/Action | Expected Result |
|------|----------------|-----------------|
| Build passes | `npm run build` | No TypeScript errors |
| Global settings work | Change theme | Theme persists after refresh |
| App settings work | Change Voice Rx setting | Setting persists, doesn't affect Kaira Bot |
| Old settings table gone | Check IndexedDB | No `settings` table |
| Cross-app isolation | Change setting in Voice Rx | Same setting key in Kaira Bot unchanged |

---

## Phase 3: Rename & Cleanup

**Goal:** Clean naming, remove legacy code, document final schema.

### Changes

#### 3.1 Rename Database Class

```typescript
// Before
export class VoiceRxDatabase extends Dexie {
  constructor() {
    super('voice-rx-evaluator-v2');
  }
}

// After
export class AiEvalsDatabase extends Dexie {
  constructor() {
    super('ai-evals-db');  // New name requires fresh DB or migration
  }
}
```

**Note:** Changing database name requires either:
- Fresh install (user clears IndexedDB), OR
- Cross-database migration (copy all data to new DB, delete old)

Recommend: Keep same DB name for now, just rename class.

#### 3.2 Remove Legacy Functions

```typescript
// DELETE these (no longer needed)
export function ensureDbReady(): Promise<void>
export async function waitForDb(): Promise<boolean>
export function isDbAvailable(): boolean
export function isDbInitComplete(): boolean
```

#### 3.3 Fix All Store Selector Patterns

Audit all components using stores and fix unstable references:

```typescript
// BAD - causes infinite loops
const { loadSchemas, getSchemasByType } = useSchemasStore();
useEffect(() => {
  loadSchemas(appId);
}, [loadSchemas]); // loadSchemas is unstable!

// GOOD - stable selectors
const loadSchemas = useSchemasStore((state) => state.loadSchemas);
const schemas = useSchemasStore((state) => state.schemas[appId]);
useEffect(() => {
  loadSchemas(appId);
}, [loadSchemas, appId]); // loadSchemas is stable
```

#### 3.4 Update All useCurrentXxxActions Hooks

These hooks create unstable function references. Options:
1. Delete them entirely (use direct selectors)
2. Memoize the returned object with `useMemo`
3. Convert to return stable functions via selectors

Recommend: Option 1 - Delete and use direct selectors everywhere.

#### 3.5 Create Final Schema Documentation

Create `src/services/storage/SCHEMA.md`:

```markdown
# AI Evals Platform - IndexedDB Schema

## Database: ai-evals-db (Dexie v4)

### Tables

#### listings
Primary store for evaluation items.
- `id` (string, PK) - UUID
- `appId` (string, indexed) - 'voice-rx' | 'kaira-bot'
- `updatedAt` (Date, indexed) - For sorting

#### files
Binary blob storage for audio/transcript files.
- `id` (string, PK) - UUID
- `data` (Blob) - File contents
- `createdAt` (Date) - Upload timestamp

#### globalSettings
Settings shared across all apps.
- `key` (string, PK) - Setting name
- `value` (any) - Setting value

#### appSettings
Per-app settings.
- `id` (number, PK, auto) - Auto-increment
- `appId` (string, indexed) - App identifier
- `key` (string) - Setting name
- `value` (any) - Setting value

#### prompts
LLM prompt templates with version history.
- `id` (string, PK) - UUID
- `appId` (string, indexed) - App identifier
- `promptType` (string, indexed) - 'transcription' | 'evaluation' | 'extraction'
- `version` (number) - Version number (filter in JS)
- `name` (string) - Display name
- `prompt` (string) - Prompt text
- `isDefault` (boolean) - Built-in flag

#### schemas
JSON schemas for structured output.
- `id` (string, PK) - UUID
- `appId` (string, indexed) - App identifier
- `promptType` (string, indexed) - 'transcription' | 'evaluation' | 'extraction'
- `version` (number) - Version number (filter in JS)
- `name` (string) - Display name
- `schema` (object) - JSON Schema definition
- `isDefault` (boolean) - Built-in flag

#### kairaChatSessions
Chat conversation sessions for Kaira Bot.
- `id` (string, PK) - UUID
- `appId` (string, indexed) - Always 'kaira-bot'
- Other fields per KairaChatSession type

#### kairaChatMessages
Individual messages within chat sessions.
- `id` (string, PK) - UUID
- `sessionId` (string, indexed) - Parent session
- Other fields per KairaChatMessage type
```

### Phase 3 Tests

| Test | Command/Action | Expected Result |
|------|----------------|-----------------|
| Build passes | `npm run build` | No TypeScript errors |
| No legacy functions | grep for ensureDbReady | No usages found |
| No unstable hooks | grep for useCurrentXxxActions | Either deleted or memoized |
| Full E2E flow | Upload → Eval → Export | Complete without errors |
| Cross-browser | Test in Firefox, Chrome, Safari | Works in all |
| Fresh install | Clear IndexedDB, reload | App seeds defaults correctly |

---

## Implementation Order

```
Phase 1 (Prompts & Schemas Tables)
├── 1.1 Add tables to schema (version 2)
├── 1.2 Write migration logic
├── 1.3 Update promptsRepository.ts
├── 1.4 Update schemasRepository.ts
├── 1.5 Run Phase 1 tests
└── 1.6 Commit: "feat: dedicated prompts and schemas tables"

Phase 2 (Split Settings)
├── 2.1 Add globalSettings/appSettings tables (version 3)
├── 2.2 Write migration logic
├── 2.3 Update db.ts helpers
├── 2.4 Delete old settings table (version 4)
├── 2.5 Run Phase 2 tests
└── 2.6 Commit: "feat: separate global and app settings"

Phase 3 (Cleanup)
├── 3.1 Rename database class
├── 3.2 Remove legacy functions
├── 3.3 Fix store selector patterns
├── 3.4 Delete/fix useCurrentXxxActions hooks
├── 3.5 Create schema documentation
├── 3.6 Run Phase 3 tests
└── 3.7 Commit: "refactor: clean storage layer, fix selector patterns"
```

---

## Risk Mitigation

### Before Each Phase
1. Commit current working state
2. Create git tag: `git tag pre-phase-X`
3. Export test data from IndexedDB (optional)

### If Migration Fails
1. Dexie will reject the upgrade and DB stays at old version
2. User sees error, can clear IndexedDB and start fresh
3. Rollback to pre-phase commit if needed

### Testing Strategy
1. **Firefox first** - known working browser
2. **Chrome second** - after fixing Chrome's IndexedDB issue
3. **Safari third** - for final validation

---

## Files to Modify

### Phase 1
- `src/services/storage/db.ts` - Add tables, migration
- `src/services/storage/promptsRepository.ts` - Use db.prompts
- `src/services/storage/schemasRepository.ts` - Use db.schemas

### Phase 2
- `src/services/storage/db.ts` - Split settings, update helpers

### Phase 3
- `src/services/storage/db.ts` - Rename class, remove legacy
- `src/hooks/useCurrentAppData.ts` - Fix or delete
- `src/app/pages/ListingPage.tsx` - Already fixed
- `src/features/evals/components/EvaluationModal.tsx` - Already fixed
- Any other files using destructured store methods
- `src/services/storage/SCHEMA.md` - Create documentation

---

## Estimated Effort

| Phase | Complexity | Estimated Time |
|-------|------------|----------------|
| Phase 1 | Medium | 2-3 hours |
| Phase 2 | Low | 1-2 hours |
| Phase 3 | Medium | 2-3 hours |
| **Total** | | **5-8 hours** |

---

## Success Criteria

After all phases complete:

1. ✅ Single database with 8 clearly-named tables
2. ✅ No JSON blob arrays for entity storage
3. ✅ Simple indexes only (no compound indexes)
4. ✅ All filtering done in JavaScript
5. ✅ No infinite loop bugs from store selectors
6. ✅ Works in Firefox, Chrome (after reset), Safari
7. ✅ Clear schema documentation
8. ✅ No legacy compatibility functions
