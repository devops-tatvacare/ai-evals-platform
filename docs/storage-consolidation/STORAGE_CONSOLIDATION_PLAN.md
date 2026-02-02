# Storage Layer Consolidation Plan - OPTION A

**Created:** 2026-02-02  
**Updated:** 2026-02-02  
**Status:** Ready for Implementation  
**Strategy:** Fresh start with clean schema (no migration)

---

## Executive Summary

**Goal:** Consolidate scattered storage into 3 clean tables using pattern-based entity discrimination.

**Approach:**
- **3 tables total**: `listings`, `files`, `entities`
- **Fresh database**: `ai-evals-platform` (no migration from old DB)
- **Smart patterns**: Use `type` field to discriminate settings/prompts/schemas/chat
- **No compound indexes**: Simple `appId` and `type` indexes only, filter in JavaScript
- **Zero breaking changes**: Repository APIs stay the same, only internals change

---

## Target Schema (Final State)

```
Database: ai-evals-platform
├── listings
│   ├── id (string, PK) - UUID
│   ├── appId (string, indexed) - 'voice-rx' | 'kaira-bot'
│   ├── updatedAt (Date, indexed) - For sorting
│   └── ...other listing fields
│
├── files
│   ├── id (string, PK) - UUID
│   ├── data (Blob) - Binary file content
│   └── createdAt (Date) - Upload timestamp
│
└── entities (NEW - universal storage)
    ├── id (number, PK, auto-increment) - Auto-generated
    ├── appId (string | null, indexed) - null = global, 'voice-rx' = app-specific
    ├── type (string, indexed) - 'setting' | 'prompt' | 'schema' | 'chatSession' | 'chatMessage'
    ├── key (string) - Context-dependent identifier
    ├── version (number | null) - For prompts/schemas only
    └── data (JSON object) - Flexible payload
```

## Entity Patterns

### Pattern 1: Settings (Global & App-Specific)

**Global Setting Example:**
```json
{
  "id": 1,
  "appId": null,
  "type": "setting",
  "key": "theme",
  "version": null,
  "data": {
    "value": "dark"
  }
}
```

**App-Specific Setting Example:**
```json
{
  "id": 2,
  "appId": "voice-rx",
  "type": "setting",
  "key": "llm",
  "version": null,
  "data": {
    "provider": "gemini",
    "apiKey": "...",
    "selectedModel": "gemini-2.0-flash-exp"
  }
}
```

**Query Pattern:**
```typescript
// Global setting
const theme = await db.entities
  .where('type').equals('setting')
  .filter(e => e.appId === null && e.key === 'theme')
  .first();

// App setting
const llm = await db.entities
  .where('type').equals('setting')
  .filter(e => e.appId === 'voice-rx' && e.key === 'llm')
  .first();
```

---

### Pattern 2: Prompts

**Example:**
```json
{
  "id": 10,
  "appId": "voice-rx",
  "type": "prompt",
  "key": "transcription",
  "version": 3,
  "data": {
    "name": "Transcription Prompt v3",
    "prompt": "You are an expert transcriber...",
    "description": "Handles time-aligned segments",
    "isDefault": true,
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

**Query Pattern:**
```typescript
// Get all prompts for app
const prompts = await db.entities
  .where('type').equals('prompt')
  .filter(e => e.appId === 'voice-rx')
  .toArray();

// Filter by promptType (key) and sort by version in JS
const transcriptionPrompts = prompts
  .filter(e => e.key === 'transcription')
  .sort((a, b) => b.version - a.version);
```

---

### Pattern 3: Schemas

**Example:**
```json
{
  "id": 11,
  "appId": "voice-rx",
  "type": "schema",
  "key": "evaluation",
  "version": 2,
  "data": {
    "name": "Evaluation Schema v2",
    "schema": { "type": "object", "properties": {...} },
    "description": "Critique with severity levels",
    "isDefault": true,
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

**Query Pattern:** Same as prompts (use `type: 'schema'`)

---

### Pattern 4: Chat Sessions

**Example:**
```json
{
  "id": 20,
  "appId": "kaira-bot",
  "type": "chatSession",
  "key": "<sessionId-UUID>",
  "version": null,
  "data": {
    "id": "<sessionId-UUID>",
    "appId": "kaira-bot",
    "title": "Health consultation",
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

---

### Pattern 5: Chat Messages

**Example:**
```json
{
  "id": 21,
  "appId": "kaira-bot",
  "type": "chatMessage",
  "key": "<sessionId-UUID>",
  "version": null,
  "data": {
    "id": "<messageId-UUID>",
    "sessionId": "<sessionId-UUID>",
    "role": "user",
    "content": "What are symptoms of flu?",
    "timestamp": "2026-02-02T12:00:00Z"
  }
}
```

**Query Pattern:**
```typescript
// Get messages for a session
const messages = await db.entities
  .where('type').equals('chatMessage')
  .filter(e => e.appId === 'kaira-bot' && e.key === sessionId)
  .toArray();
```

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
## Implementation Plan

### ⚠️ CRITICAL: Infinite Loop Prevention

**Zustand Store Usage Rules:**
1. **NEVER destructure store methods** - creates unstable references
2. **ALWAYS use direct selectors** for methods in useEffect dependencies
3. **ALWAYS use direct selectors** for computed values

**BAD (causes infinite loops):**
```typescript
const { loadSchemas, getSchemasByType } = useSchemasStore();
useEffect(() => {
  loadSchemas(appId);
}, [loadSchemas]); // loadSchemas changes every render!
```

**GOOD (stable references):**
```typescript
const loadSchemas = useSchemasStore((state) => state.loadSchemas);
const schemas = useSchemasStore((state) => state.schemas[appId]);
useEffect(() => {
  loadSchemas(appId);
}, [loadSchemas, appId]); // loadSchemas is stable
```

**Affected files to audit after implementation:**
- `src/app/pages/ListingPage.tsx` ✅ (already fixed)
- `src/features/evals/components/EvaluationModal.tsx` ✅ (already fixed)
- Any new component using `useSchemasStore`, `usePromptsStore`, `useSettingsStore`

---

### Phase 1: Create New Database Schema

**Goal:** Set up fresh `ai-evals-platform` database with 3 tables.

#### Step 1.1: Update db.ts - Define Entity Interface

**File:** `src/services/storage/db.ts`

**Changes:**
1. Add `Entity` interface at top of file
2. Rename class from `VoiceRxDatabase` to `AiEvalsDatabase`
3. Change database name from `'voice-rx-evaluator-v2'` to `'ai-evals-platform'`
4. Remove `settings`, `kairaChatSessions`, `kairaChatMessages` tables
5. Add `entities` table with schema: `'++id, appId, type'`

**New Entity Interface:**
```typescript
export interface Entity {
  id?: number;              // Auto-increment, Dexie generates
  appId: string | null;     // null = global, 'voice-rx' | 'kaira-bot' = app-specific
  type: 'setting' | 'prompt' | 'schema' | 'chatSession' | 'chatMessage';
  key: string;              // Context-dependent: setting key, promptType, sessionId
  version: number | null;   // For prompts/schemas only
  data: Record<string, unknown>; // Flexible payload
}
```

**New Database Schema:**
```typescript
export class AiEvalsDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  entities!: Table<Entity, number>;

  constructor() {
    super('ai-evals-platform');
    
    this.version(1).stores({
      listings: 'id, appId, updatedAt',
      files: 'id',
      entities: '++id, appId, type',
    });
  }
}

export const db = new AiEvalsDatabase();
```

**⚠️ IMPORTANT:** Update `DB_NAME` constant at bottom of file:
```typescript
export const DB_NAME = 'ai-evals-platform';
```

---

#### Step 1.2: Update db.ts - Helper Functions

**File:** `src/services/storage/db.ts`

**Remove these functions entirely:**
```typescript
// DELETE - no longer needed
export async function getGlobalSetting<T>(key: string): Promise<T | undefined>
export async function setGlobalSetting<T>(key: string, value: T): Promise<void>
export async function getAllGlobalSettings(): Promise<Record<string, unknown>>
export async function getAppSetting<T>(appId: AppId, key: string): Promise<T | undefined>
export async function setAppSetting<T>(appId: AppId, key: string, value: T): Promise<void>
export async function getAllAppSettings(appId: AppId): Promise<Record<string, unknown>>
```

**Add new generic entity helpers:**
```typescript
/**
 * Get a single entity by filters
 */
export async function getEntity(
  type: Entity['type'],
  appId: string | null,
  key: string
): Promise<Entity | undefined> {
  return await db.entities
    .where('type').equals(type)
    .filter(e => e.appId === appId && e.key === key)
    .first();
}

/**
 * Get multiple entities by type and appId
 */
export async function getEntities(
  type: Entity['type'],
  appId: string | null,
  keyFilter?: string
): Promise<Entity[]> {
  let results = await db.entities
    .where('type').equals(type)
    .filter(e => e.appId === appId)
    .toArray();
  
  if (keyFilter) {
    results = results.filter(e => e.key === keyFilter);
  }
  
  return results;
}

/**
 * Save or update an entity
 */
export async function saveEntity(entity: Omit<Entity, 'id'> & { id?: number }): Promise<number> {
  if (entity.id) {
    await db.entities.put(entity as Entity);
    return entity.id;
  } else {
    return await db.entities.add(entity);
  }
}

/**
 * Delete an entity by id
 */
export async function deleteEntity(id: number): Promise<void> {
  await db.entities.delete(id);
}
```

**Remove these legacy functions:**
```typescript
// DELETE - no longer needed
export function ensureDbReady(): Promise<void>
export async function waitForDb(): Promise<boolean>
export function isDbAvailable(): boolean
export function isDbInitComplete(): boolean
```

**Keep these functions (unchanged):**
```typescript
export async function getStorageUsage(): Promise<{ used: number; quota: number; percentage: number }>
```

---

#### Step 1.3: Verify Phase 1

**Tests:**
1. Run `npm run build` - Should compile with NO errors
2. Clear browser IndexedDB (delete all databases)
3. Run `npm run dev` and open Firefox
4. Open DevTools → Application → IndexedDB
5. Verify `ai-evals-platform` database exists with 3 tables: `listings`, `files`, `entities`
6. Verify app loads without console errors

**Success Criteria:**
- ✅ Build passes
- ✅ Database created with correct name
- ✅ 3 tables exist
- ✅ No console errors on app load

**Commit:** `feat: create ai-evals-platform database with entities table`

---

### Phase 2: Update Prompts Repository

**Goal:** Make `promptsRepository` use `entities` table instead of `settings` JSON arrays.

#### Step 2.1: Update promptsRepository.ts - Core Methods

**File:** `src/services/storage/promptsRepository.ts`

**Remove imports:**
```typescript
// REMOVE
import { getAppSetting, setAppSetting } from './db';
```

**Add imports:**
```typescript
// ADD
import { db, type Entity, saveEntity, deleteEntity, getEntities } from './db';
```

**Update `getAllPrompts` method:**
```typescript
private async getAllPrompts(appId: AppId): Promise<PromptDefinition[]> {
  const entities = await getEntities('prompt', appId);
  
  return entities.map(e => ({
    id: String(e.id),  // Convert number to string for compatibility
    name: e.data.name as string,
    version: e.version!,
    promptType: e.key as PromptDefinition['promptType'],
    prompt: e.data.prompt as string,
    description: e.data.description as string | undefined,
    isDefault: e.data.isDefault as boolean | undefined,
    createdAt: new Date(e.data.createdAt as string),
    updatedAt: new Date(e.data.updatedAt as string),
  }));
}
```

**Update `saveAllPrompts` method:**
```typescript
private async saveAllPrompts(appId: AppId, prompts: PromptDefinition[]): Promise<void> {
  // This method is no longer used (we save individually now)
  // Keep for compatibility but make it a no-op
  console.warn('saveAllPrompts is deprecated, use save() instead');
}
```

**Update `save` method:**
```typescript
async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
  // Auto-generate name if creating new version
  if (!prompt.id) {
    const latestVersion = await this.getLatestVersion(appId, prompt.promptType);
    prompt.version = latestVersion + 1;
    prompt.name = `${this.getPromptTypeLabel(prompt.promptType)} Prompt v${prompt.version}`;
    prompt.createdAt = new Date();
  }
  prompt.updatedAt = new Date();

  const entity: Omit<Entity, 'id'> & { id?: number } = {
    id: prompt.id ? parseInt(prompt.id, 10) : undefined,
    appId,
    type: 'prompt',
    key: prompt.promptType,
    version: prompt.version,
    data: {
      name: prompt.name,
      prompt: prompt.prompt,
      description: prompt.description,
      isDefault: prompt.isDefault,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    },
  };

  const id = await saveEntity(entity);
  prompt.id = String(id);
  
  return prompt;
}
```

**Update `delete` method:**
```typescript
async delete(appId: AppId, id: string): Promise<void> {
  const entities = await getEntities('prompt', appId);
  const entity = entities.find(e => String(e.id) === id);
  
  if (!entity) {
    throw new Error('Prompt not found');
  }
  if (entity.data.isDefault) {
    throw new Error('Cannot delete default prompt');
  }

  await deleteEntity(entity.id!);
}
```

**Update `seedDefaults` method:**
```typescript
private async seedDefaults(appId: AppId): Promise<void> {
  const existing = await this.getAllPrompts(appId);
  if (existing.length > 0) return;

  const defaults = appId === 'kaira-bot' 
    ? this.getKairaBotDefaults()
    : this.getVoiceRxDefaults();

  for (const promptDef of defaults) {
    await this.save(appId, {
      ...promptDef,
      id: '',  // Will be auto-generated
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PromptDefinition);
  }
}
```

---

#### Step 2.2: Verify Phase 2

**Tests:**
1. Run `npm run build` - Should compile with NO errors
2. Clear browser IndexedDB
3. Open app in Firefox
4. Navigate to Settings → Prompts & Schemas tab
5. Verify default prompts are shown (Voice Rx: 3 prompts)
6. Open DevTools → IndexedDB → `ai-evals-platform` → `entities`
7. Verify rows exist with `type: "prompt"`
8. Create a new prompt version
9. Verify new row appears in `entities` table
10. Delete a custom prompt (not default)
11. Verify row removed from `entities` table

**Success Criteria:**
- ✅ Build passes
- ✅ Default prompts seed correctly
- ✅ Prompts visible in UI
- ✅ Create prompt works
- ✅ Delete non-default prompt works
- ✅ Cannot delete default prompts

**Commit:** `feat: migrate prompts to entities table`

---

### Phase 3: Update Schemas Repository

**Goal:** Make `schemasRepository` use `entities` table (same pattern as prompts).

#### Step 3.1: Update schemasRepository.ts - Core Methods

**File:** `src/services/storage/schemasRepository.ts`

**Follow exact same pattern as Phase 2**, just change:
- `'prompt'` → `'schema'`
- `PromptDefinition` → `SchemaDefinition`
- `prompt.prompt` → `schema.schema` (the actual schema object)

**Key differences:**
```typescript
private async getAllSchemas(appId: AppId): Promise<SchemaDefinition[]> {
  const entities = await getEntities('schema', appId);
  
  return entities.map(e => ({
    id: String(e.id),
    name: e.data.name as string,
    version: e.version!,
    promptType: e.key as SchemaDefinition['promptType'],
    schema: e.data.schema as Record<string, unknown>,  // ← Schema object
    description: e.data.description as string | undefined,
    isDefault: e.data.isDefault as boolean | undefined,
    createdAt: new Date(e.data.createdAt as string),
    updatedAt: new Date(e.data.updatedAt as string),
  }));
}
```

---

#### Step 3.2: Verify Phase 3

**Tests:** Same as Phase 2, but for schemas
1. Build passes
2. Default schemas seed correctly
3. Schemas visible in UI
4. Create schema works
5. Delete non-default schema works

**Commit:** `feat: migrate schemas to entities table`

---

### Phase 4: Update Settings Storage

**Goal:** Make `settingsStore` use `entities` table for settings persistence.

#### Step 4.1: Understand Current Settings Store

**File:** `src/stores/settingsStore.ts`

**Current flow:**
- Uses Zustand persist middleware
- Stores settings as one big JSON object in localStorage
- Has global settings (theme) and app-specific settings (llm config, etc.)

**⚠️ CRITICAL:** Do NOT change the Zustand store structure itself (would break everywhere). Only change the persist storage backend.

---

#### Step 4.2: Create Custom Storage Backend

**File:** `src/stores/settingsStore.ts`

**Add new storage implementation BEFORE the store definition:**
```typescript
import { StateStorage } from 'zustand/middleware';
import { db, saveEntity, getEntity } from '@/services/storage/db';
import type { AppId } from '@/types';

/**
 * Custom Zustand storage that uses entities table
 */
const indexedDbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      // name will be 'settings-storage'
      // We store settings as entities with appId=null (global) or specific appId
      const globalEntity = await getEntity('setting', null, name);
      return globalEntity?.data.value as string || null;
    } catch (error) {
      console.error('[Settings] Error loading from IndexedDB:', error);
      return null;
    }
  },
  
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const existing = await getEntity('setting', null, name);
      await saveEntity({
        id: existing?.id,
        appId: null,
        type: 'setting',
        key: name,
        version: null,
        data: { value },
      });
    } catch (error) {
      console.error('[Settings] Error saving to IndexedDB:', error);
    }
  },
  
  removeItem: async (name: string): Promise<void> => {
    try {
      const existing = await getEntity('setting', null, name);
      if (existing?.id) {
        await db.entities.delete(existing.id);
      }
    } catch (error) {
      console.error('[Settings] Error removing from IndexedDB:', error);
    }
  },
};
```

**Update persist middleware config:**
```typescript
// BEFORE
persist(
  (set, get) => ({ ... }),
  {
    name: 'settings-storage',
    // Using default localStorage
  }
)

// AFTER
persist(
  (set, get) => ({ ... }),
  {
    name: 'settings-storage',
    storage: indexedDbStorage,  // ← Use custom storage
  }
)
```

**⚠️ NOTE:** This stores the ENTIRE settings state as one JSON blob in a single entity row. This is fine for now. Later optimization could split it into multiple rows (one per setting key).

---

#### Step 4.3: Handle App-Specific Settings

**Challenge:** Settings are currently stored as one big object with app-specific nested objects.

**Current structure:**
```typescript
{
  theme: 'dark',  // global
  'voice-rx': {   // app-specific
    llm: { ... },
    transcription: { ... }
  },
  'kaira-bot': {  // app-specific
    llm: { ... }
  }
}
```

**Strategy:** Keep this structure for now. The entire object is serialized into one entity row. This maintains compatibility with existing code.

**Alternative (future optimization):** Split into multiple entity rows:
- Row 1: `{ appId: null, key: 'theme', data: { value: 'dark' } }`
- Row 2: `{ appId: 'voice-rx', key: 'llm', data: { ... } }`
- Row 3: `{ appId: 'voice-rx', key: 'transcription', data: { ... } }`

**Decision: Keep simple approach for now** (one entity row per app).

---

#### Step 4.4: Verify Phase 4

**Tests:**
1. Build passes
2. Clear IndexedDB
3. Open app, verify default theme loads
4. Change theme to light
5. Refresh page, verify theme persisted
6. Open Settings → LLM tab, update API key
7. Refresh page, verify API key persisted
8. Check IndexedDB → `entities` table
9. Verify `type: "setting"` rows exist

**Success Criteria:**
- ✅ Settings persist across refreshes
- ✅ App-specific settings work
- ✅ Global settings work
- ✅ Data visible in `entities` table

**Commit:** `feat: migrate settings to entities table`

---

### Phase 5: Update Chat Storage (Kaira Bot)

**Goal:** Move Kaira Bot chat sessions and messages to `entities` table.

#### Step 5.1: Update repositories.ts - Chat Methods

**File:** `src/services/storage/repositories.ts`

**Find chat-related methods** (likely `chatSessionsRepository` and `chatMessagesRepository`).

**Update to use entities table:**
```typescript
// Example for sessions
async getAll(appId: AppId): Promise<KairaChatSession[]> {
  const entities = await getEntities('chatSession', appId);
  return entities.map(e => e.data as KairaChatSession);
}

async save(session: KairaChatSession): Promise<void> {
  await saveEntity({
    appId: session.appId,
    type: 'chatSession',
    key: session.id,  // Session ID as key
    version: null,
    data: session,
  });
}

// Similar for messages with type: 'chatMessage'
```

---

#### Step 5.2: Verify Phase 5

**Tests:**
1. Build passes
2. Open Kaira Bot app
3. Start a new chat session
4. Send messages
5. Verify session appears in sidebar
6. Refresh page
7. Verify session persists
8. Check IndexedDB → `entities`
9. Verify `type: "chatSession"` and `type: "chatMessage"` rows exist

**Success Criteria:**
- ✅ Chat sessions persist
- ✅ Chat messages persist
- ✅ Sessions visible in sidebar after refresh

**Commit:** `feat: migrate chat to entities table`

---

### Phase 6: Final Cleanup

**Goal:** Remove dead code, update documentation, verify all patterns.

#### Step 6.1: Remove Old Repository Files (if separate)

**If chat storage is in separate files:**
- Check for `src/services/storage/chatRepository.ts` or similar
- If exists, can be deleted after Phase 5

**Scan for any references to old database:**
```bash
grep -r "voice-rx-evaluator-v2" src/
```
- Update any hardcoded references to new name

---

#### Step 6.2: Audit All Zustand Store Usage

**Goal:** Find and fix any destructured store methods that could cause infinite loops.

**Search patterns:**
```bash
# Find destructured store hooks
grep -r "const { .* } = use.*Store()" src/

# Find useEffect with unstable dependencies
grep -A5 "useEffect" src/ | grep -B3 "function\|method"
```

**Files to check:**
- Any component using `useSchemasStore`
- Any component using `usePromptsStore`
- Any component using `useSettingsStore`
- Any component using `useListingsStore`

**Fix pattern:**
```typescript
// BEFORE (unstable)
const { loadData, getData } = useDataStore();

// AFTER (stable)
const loadData = useDataStore((state) => state.loadData);
const data = useDataStore((state) => state.data);
```

---

#### Step 6.3: Create Final Documentation

**File:** `src/services/storage/SCHEMA.md` (create new)

**Content:**
```markdown
# AI Evals Platform - Storage Schema

## Database: ai-evals-platform (Dexie.js)

### Overview
Single IndexedDB database with 3 tables using pattern-based entity discrimination for scalability.

### Tables

#### 1. listings
Stores evaluation records with metadata.

**Schema:**
- `id` (string, PK) - UUID
- `appId` (string, indexed) - 'voice-rx' | 'kaira-bot'
- `updatedAt` (Date, indexed) - For chronological sorting
- Other fields per Listing type

**Indexes:** `id`, `appId`, `updatedAt`

---

#### 2. files
Binary blob storage for audio and transcript files.

**Schema:**
- `id` (string, PK) - UUID
- `data` (Blob) - File binary content
- `createdAt` (Date) - Upload timestamp

**Indexes:** `id`

**Note:** Blobs are stored directly, not base64 encoded.

---

#### 3. entities
Universal storage for settings, prompts, schemas, and chat data. Uses type discrimination pattern.

**Schema:**
- `id` (number, PK, auto-increment) - Auto-generated by Dexie
- `appId` (string | null, indexed) - App scope (null = global)
- `type` (string, indexed) - Entity type discriminator
- `key` (string) - Context-dependent identifier
- `version` (number | null) - Version number (prompts/schemas only)
- `data` (object) - Flexible JSON payload

**Indexes:** `id`, `appId`, `type`

**Entity Types:**

##### type: 'setting'
Global or app-specific configuration settings.

**Structure:**
```json
{
  "id": 1,
  "appId": null,  // null = global, "voice-rx" = app-specific
  "type": "setting",
  "key": "theme",
  "version": null,
  "data": { "value": "dark" }
}
```

**Query:** Filter by `type='setting'`, then `appId` and `key` in JavaScript.

---

##### type: 'prompt'
LLM prompt templates with version history.

**Structure:**
```json
{
  "id": 10,
  "appId": "voice-rx",
  "type": "prompt",
  "key": "transcription",  // promptType
  "version": 3,
  "data": {
    "name": "Transcription Prompt v3",
    "prompt": "You are an expert...",
    "description": "...",
    "isDefault": true,
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

**Query:** Filter by `type='prompt'` and `appId`, then filter/sort by `key` and `version` in JavaScript.

---

##### type: 'schema'
JSON schemas for structured LLM output validation.

**Structure:**
```json
{
  "id": 11,
  "appId": "voice-rx",
  "type": "schema",
  "key": "evaluation",  // promptType
  "version": 2,
  "data": {
    "name": "Evaluation Schema v2",
    "schema": { "type": "object", "properties": {...} },
    "description": "...",
    "isDefault": true,
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

**Query:** Same pattern as prompts.

---

##### type: 'chatSession'
Kaira Bot conversation sessions.

**Structure:**
```json
{
  "id": 20,
  "appId": "kaira-bot",
  "type": "chatSession",
  "key": "<sessionId>",  // UUID
  "version": null,
  "data": {
    "id": "<sessionId>",
    "appId": "kaira-bot",
    "title": "Health consultation",
    "createdAt": "2026-02-02T12:00:00Z",
    "updatedAt": "2026-02-02T12:00:00Z"
  }
}
```

---

##### type: 'chatMessage'
Individual messages within Kaira Bot sessions.

**Structure:**
```json
{
  "id": 21,
  "appId": "kaira-bot",
  "type": "chatMessage",
  "key": "<sessionId>",  // Parent session ID
  "version": null,
  "data": {
    "id": "<messageId>",
    "sessionId": "<sessionId>",
    "role": "user",
    "content": "What are symptoms of flu?",
    "timestamp": "2026-02-02T12:00:00Z"
  }
}
```

**Query:** Filter by `type='chatMessage'` and `key=sessionId`.

---

### Design Principles

1. **Simple indexes only** - No compound indexes like `[appId+type]`
2. **Filter in JavaScript** - Dexie handles simple indexed queries, complex filtering in JS
3. **Type discrimination** - Single table for multiple entity types (scalable)
4. **Flexible data payload** - `data` field holds entity-specific structure
5. **Version filtering in code** - Avoid IndexedDB performance issues

---

### Query Patterns

#### Get Global Setting
```typescript
const entity = await db.entities
  .where('type').equals('setting')
  .filter(e => e.appId === null && e.key === 'theme')
  .first();
const theme = entity?.data.value;
```

#### Get All Prompts for App
```typescript
const entities = await db.entities
  .where('type').equals('prompt')
  .filter(e => e.appId === 'voice-rx')
  .toArray();

// Sort by version in JS
const sorted = entities.sort((a, b) => b.version - a.version);
```

#### Get Latest Prompt Version
```typescript
const prompts = await db.entities
  .where('type').equals('prompt')
  .filter(e => e.appId === 'voice-rx' && e.key === 'transcription')
  .toArray();

const latest = prompts.sort((a, b) => b.version - a.version)[0];
```

---

### Migration Notes

**No migration:** This is a fresh database. Users starting fresh will have clean `ai-evals-platform` database.

**Old database cleanup:** Previous `voice-rx-evaluator-v2` database can be manually deleted from browser DevTools if needed.

---

### Performance Considerations

**Indexed queries are fast:**
- Lookups by `id`, `appId`, `type` use Dexie indexes (O(log n))

**JavaScript filtering is acceptable:**
- Version filtering, key matching done in-memory
- Typical dataset: <1000 entities per app
- Performance impact: negligible (<10ms for 1000 rows)

**Blob storage is efficient:**
- Stored in separate `files` table (don't bloat entities table)
- Direct Blob storage (not base64) saves space

---

### Troubleshooting

**Database not appearing:**
- Check browser DevTools → Application → IndexedDB
- Database name: `ai-evals-platform`
- If old database exists, clear it manually

**Defaults not seeding:**
- Check browser console for errors
- Verify `seedDefaults` methods in repositories execute
- Check entities table for `isDefault: true` rows

**Infinite loops:**
- Ensure Zustand stores use direct selectors, not destructuring
- Check useEffect dependencies for unstable function references
```

---

#### Step 6.4: Remove Dead Files

**Files to delete (if they exist):**
- `src/services/storage/legacySettings.ts`
- `src/services/storage/migration.ts`
- Any `useCurrentXxxActions.ts` hooks if replaced

---

#### Step 6.5: Update Package Metadata (optional)

**File:** `package.json`

**Update description if desired:**
```json
{
  "name": "ai-evals-platform",
  "description": "Unified evaluation platform for Voice Rx and Kaira Bot"
}
```

---

#### Step 6.6: Final Verification Tests

**Complete E2E Test Suite:**

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1 | Fresh install | Clear IndexedDB, reload app | Database created, defaults seeded |
| 2 | Voice Rx upload | Upload audio files | Listing created, files stored |
| 3 | Run AI evaluation | Open listing, run eval | Completes without errors |
| 4 | Settings persist | Change theme, refresh | Theme persists |
| 5 | Custom prompt | Create new prompt | Appears in entities table |
| 6 | Custom schema | Create new schema | Appears in entities table |
| 7 | Delete custom prompt | Delete non-default | Removed from table, default untouched |
| 8 | Kaira Bot chat | Start session, send messages | Session + messages persist |
| 9 | Cross-app isolation | Change Voice Rx setting | Kaira Bot setting unchanged |
| 10 | Export data | Export listing | Download succeeds |
| 11 | Browser refresh | Reload page | All data persists |
| 12 | DevTools inspection | Open IndexedDB in DevTools | 3 tables visible, data correct |

**Cross-browser testing:**
- Firefox: Primary testing browser (known stable)
- Safari: Secondary testing (if available)
- Chrome: Test after clearing all site data

---

**Commit:** `chore: cleanup storage layer, add documentation`

---

## Complete File Change Summary

### Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/services/storage/db.ts` | 1, 2, 4 | New Entity interface, rename class, new helpers |
| `src/services/storage/promptsRepository.ts` | 2 | Use entities table |
| `src/services/storage/schemasRepository.ts` | 3 | Use entities table |
| `src/stores/settingsStore.ts` | 4 | Custom IndexedDB storage backend |
| `src/services/storage/repositories.ts` | 5 | Update chat methods for entities |
| Components using stores | 6 | Fix selector patterns |

### Files to Create

| File | Phase | Purpose |
|------|-------|---------|
| `src/services/storage/SCHEMA.md` | 6 | Schema documentation |

### Files to Delete (if exist)

| File | Phase | Reason |
|------|-------|--------|
| `src/services/storage/legacySettings.ts` | 6 | No longer needed |
| `src/services/storage/migration.ts` | 6 | Fresh start, no migrations |
| `src/hooks/useCurrentXxxActions.ts` | 6 | Unstable references |

---

## Critical Success Factors

### ✅ Must Have

1. **No infinite loops** - All Zustand selectors use direct access pattern
2. **Stable references** - No destructured store methods in useEffect deps
3. **Simple indexes** - Only `id`, `appId`, `type` indexed
4. **Fresh database** - Clean start, no migration complexity
5. **Defaults seed** - All apps get default prompts/schemas on first load

### ✅ Testing Checkpoints

After each phase:
1. `npm run build` succeeds
2. No console errors in Firefox
3. Specific phase tests pass (see each phase)
4. Commit before moving to next phase

### ✅ Rollback Strategy

If any phase fails:
1. Review console errors
2. Check IndexedDB state in DevTools
3. If unfixable: Clear IndexedDB, reload
4. If still broken: Git revert to previous phase commit

---

## Timeline & Execution

### Phase Execution Order

```
START
  ↓
Phase 1: Database Schema (30 min)
  ├─ Update db.ts structure
  ├─ Test: Build + DB creation
  └─ Commit
  ↓
Phase 2: Prompts Repository (45 min)
  ├─ Update promptsRepository.ts
  ├─ Test: CRUD operations
  └─ Commit
  ↓
Phase 3: Schemas Repository (45 min)
  ├─ Update schemasRepository.ts
  ├─ Test: CRUD operations
  └─ Commit
  ↓
Phase 4: Settings Storage (60 min)
  ├─ Custom storage backend
  ├─ Test: Settings persist
  └─ Commit
  ↓
Phase 5: Chat Storage (45 min)
  ├─ Update chat repositories
  ├─ Test: Chat persist
  └─ Commit
  ↓
Phase 6: Cleanup (60 min)
  ├─ Remove dead code
  ├─ Fix selector patterns
  ├─ Create documentation
  ├─ Full E2E test suite
  └─ Final commit
  ↓
DONE
```

**Total estimated time:** 4-5 hours (with testing)

---

## Post-Implementation Checklist

After completing all phases:

- [ ] All phases completed and committed
- [ ] `npm run build` succeeds with no errors
- [ ] App loads in Firefox without console errors
- [ ] Database `ai-evals-platform` exists with 3 tables
- [ ] Default prompts visible in Settings
- [ ] Default schemas visible in Settings
- [ ] Upload flow works end-to-end
- [ ] AI evaluation completes successfully
- [ ] Settings persist across refresh
- [ ] Chat sessions persist (Kaira Bot)
- [ ] No infinite loop warnings in console
- [ ] SCHEMA.md documentation created
- [ ] All tests passing
- [ ] Old `voice-rx-evaluator-v2` database can be deleted manually

---

## Future Optimizations (Optional)

### If Performance Issues Arise

1. **Split settings into individual rows**
   - Currently: One entity row per app with entire settings object
   - Optimized: One entity row per setting key
   - Benefit: Faster partial updates, smaller payloads

2. **Add compound indexes if needed**
   - Currently: Avoid due to past issues
   - Future: If simple indexes prove slow, try `[appId+type]`
   - Caution: Only if absolutely necessary, test thoroughly

3. **Implement lazy loading**
   - Currently: All prompts/schemas loaded at once
   - Optimized: Load only needed versions on-demand
   - Benefit: Faster initial load for large version histories

4. **Add caching layer**
   - Currently: Query IndexedDB on every access
   - Optimized: In-memory cache with invalidation
   - Benefit: Faster repeated reads

---

## Support & Troubleshooting

### Common Issues

**Issue:** Database not created
- **Solution:** Check browser console for Dexie errors, clear old databases

**Issue:** Defaults not seeding
- **Solution:** Verify `seedDefaults` methods run, check `isDefault` flag logic

**Issue:** Infinite loops on page load
- **Solution:** Audit all `useEffect` dependencies, use direct selectors

**Issue:** Settings not persisting
- **Solution:** Check custom storage backend, verify `saveEntity` calls

**Issue:** Chat messages not showing
- **Solution:** Verify `type='chatMessage'` and correct `key` (sessionId)

### Debug Commands

```bash
# Find all store usages
grep -r "use.*Store" src/

# Find useEffect hooks
grep -r "useEffect" src/

# Find entity queries
grep -r "db.entities" src/

# Check for old database references
grep -r "voice-rx-evaluator" src/
```

---

**END OF PLAN**
