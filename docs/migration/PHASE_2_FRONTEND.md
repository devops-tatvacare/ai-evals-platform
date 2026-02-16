# Phase 2: Frontend Migration

**Branch:** `feat/phase-2-frontend`
**Goal:** Replace all Dexie/IndexedDB calls with HTTP calls to the FastAPI backend. Zero changes to components or hooks.
**Outcome:** The React app works end-to-end through the API. IndexedDB is no longer used (but code still exists - removed in Phase 4).

**Prerequisite:** Phase 1 complete and merged to main. Backend running at localhost:8721.

---

## Step 2.1: Create branch and configure Vite proxy

**Files to edit:** `vite.config.ts`

### Instructions

1. Create branch:
```bash
git checkout main
git checkout -b feat/phase-2-frontend
```

2. Edit `vite.config.ts` to add API proxy. Find the existing `defineConfig` and add a `server.proxy` section:

**Current** (approximately):
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Change to:**
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8721',
        changeOrigin: true,
      },
    },
  },
})
```

> WHY: This means the React app can call `fetch('/api/listings?app_id=voice-rx')` without knowing the backend URL. Vite's dev server proxies `/api/*` to FastAPI. In production, the reverse proxy (nginx / Azure Front Door) handles this same routing.

### Test
```bash
npm run dev  # Start Vite dev server
# In browser console: fetch('/api/health').then(r => r.json()).then(console.log)
# Should return: {status: "ok", database: "connected"}
```

### Commit
```bash
git add vite.config.ts
git commit -m "phase 2.1: add Vite API proxy to FastAPI backend"
```

---

## Step 2.2: Create the HTTP client base

**Files to create:** `src/services/api/client.ts`

### Instructions

This is the base fetch wrapper. All API calls go through this.

```typescript
/**
 * HTTP client for FastAPI backend.
 * All repository implementations use this to make API calls.
 *
 * In dev: Vite proxy routes /api/* to localhost:8721
 * In prod: Reverse proxy routes /api/* to the backend service
 */

const API_BASE = ''; // Empty = use same origin (Vite proxy handles it)

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    throw new ApiError(
      response.status,
      `API error ${response.status}: ${response.statusText}`,
      errorData,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * Upload a file via multipart form data.
 * Does NOT set Content-Type header (browser sets it with boundary).
 */
export async function apiUpload<T>(
  path: string,
  file: File | Blob,
  filename?: string,
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file, filename || 'upload');

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type - browser handles multipart boundary
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Download a file as a Blob.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed: ${response.statusText}`);
  }
  return response.blob();
}
```

### Commit
```bash
git add src/services/api/client.ts
git commit -m "phase 2.2: HTTP client base (apiRequest, apiUpload, apiDownload)"
```

---

## Step 2.3: Create HTTP-based listings repository

**Files to create:** `src/services/api/listingsApi.ts`
**Files to edit:** Where `listingsRepository` is imported from

### Understanding the swap

**Current call chain:**
```
Component → Hook → Store → listingsRepository.getAll(appId) → Dexie → IndexedDB
```

**New call chain:**
```
Component → Hook → Store → listingsRepository.getAll(appId) → fetch() → FastAPI → PostgreSQL
```

The store and everything above it stays THE SAME. We only replace the repository implementation.

### Instructions

Create `src/services/api/listingsApi.ts`:

```typescript
/**
 * Listings API - HTTP implementation replacing Dexie-based listingsRepository.
 *
 * IMPORTANT: This file exports the same interface as the old listingsRepository.
 * Stores call these methods identically. No store changes needed.
 */
import type { Listing } from '@/types';
import { apiRequest } from './client';

export const listingsRepository = {
  async getAll(appId: string): Promise<Listing[]> {
    return apiRequest<Listing[]>(`/api/listings?app_id=${appId}`);
  },

  async getById(appId: string, id: string): Promise<Listing> {
    return apiRequest<Listing>(`/api/listings/${id}?app_id=${appId}`);
  },

  async create(appId: string, listingData: Partial<Listing>): Promise<Listing> {
    return apiRequest<Listing>('/api/listings', {
      method: 'POST',
      body: JSON.stringify({ ...listingData, app_id: appId }),
    });
  },

  async update(appId: string, id: string, updates: Partial<Listing>): Promise<void> {
    await apiRequest(`/api/listings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(appId: string, id: string): Promise<void> {
    await apiRequest(`/api/listings/${id}?app_id=${appId}`, {
      method: 'DELETE',
    });
  },

  async search(appId: string, query: string): Promise<Listing[]> {
    return apiRequest<Listing[]>(`/api/listings/search?app_id=${appId}&q=${encodeURIComponent(query)}`);
  },
};
```

### How to swap

**Option A (recommended for incremental migration):** Update the barrel export in `src/services/storage/index.ts` to re-export from the API module instead of the Dexie module. This way all existing imports like `import { listingsRepository } from '@/services/storage'` continue to work.

Find the current export of `listingsRepository` in `src/services/storage/index.ts` and change it:

```typescript
// BEFORE:
export { listingsRepository } from './repositories';

// AFTER:
export { listingsRepository } from '@/services/api/listingsApi';
```

**Option B (if index.ts doesn't exist or exports differently):** Find every file that imports `listingsRepository` and change the import path. Use your editor's "Find in Files" for `listingsRepository`.

### Test

1. Ensure backend is running: `cd backend && uvicorn app.main:app --port 8721 --reload`
2. Start frontend: `npm run dev`
3. Open the app in browser
4. Navigate to the listings view (Voice RX or Kaira Bot)
5. Check browser Network tab - should see `GET /api/listings?app_id=voice-rx` calls to the backend
6. Create a listing, verify it appears
7. Check PostgreSQL directly:
```bash
psql postgresql://evals_user:evals_pass@localhost:5432/ai_evals_platform -c "SELECT id, title, app_id FROM listings"
```

### Commit
```bash
git add src/services/api/listingsApi.ts src/services/storage/index.ts
git commit -m "phase 2.3: swap listings repository to HTTP API"
```

---

## Step 2.4: Create HTTP-based files repository

**Files to create:** `src/services/api/filesApi.ts`

### Instructions

```typescript
/**
 * Files API - replaces Dexie-based filesRepository.
 *
 * Key change: Files are now uploaded via multipart form data,
 * not stored as Blobs in IndexedDB.
 */
import { apiUpload, apiDownload, apiRequest } from './client';

interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export const filesRepository = {
  /**
   * Save a file. Returns the file ID (UUID).
   * Previously stored Blob directly in IndexedDB.
   * Now uploads to backend which saves to filesystem/blob storage.
   */
  async save(blob: Blob, filename?: string): Promise<string> {
    const result = await apiUpload<FileRecord>(
      '/api/files/upload',
      blob,
      filename || 'upload',
    );
    return result.id;
  },

  /**
   * Get file record by ID (metadata only).
   */
  async getById(id: string): Promise<FileRecord> {
    return apiRequest<FileRecord>(`/api/files/${id}`);
  },

  /**
   * Download file as Blob (for audio playback etc).
   * Previously: direct IndexedDB Blob read.
   * Now: HTTP download from backend.
   */
  async getBlob(id: string): Promise<Blob> {
    return apiDownload(`/api/files/${id}/download`);
  },

  /**
   * Alias for backward compatibility.
   * Old code called: filesRepository.saveAudioBlob(blob, listingId)
   * The listingId was used as the file ID in IndexedDB.
   * Now the backend generates the ID.
   */
  async saveAudioBlob(blob: Blob, _listingId?: string): Promise<string> {
    return this.save(blob, 'audio.webm');
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/files/${id}`, { method: 'DELETE' });
  },
};
```

> IMPORTANT: The old `filesRepository` used the listing ID as the file key. The new one gets a UUID from the backend. You may need to check how `audioFile.id` is set in listings and ensure the flow works: upload file → get file ID → store file ID in listing.audio_file.id.

Swap the export in `src/services/storage/index.ts`:
```typescript
// BEFORE:
export { filesRepository } from './repositories';
// AFTER:
export { filesRepository } from '@/services/api/filesApi';
```

### Commit
```bash
git add src/services/api/filesApi.ts src/services/storage/index.ts
git commit -m "phase 2.4: swap files repository to HTTP API"
```

---

## Steps 2.5 - 2.10: Remaining Repository Swaps

> PATTERN: Each step creates one `src/services/api/xxxApi.ts` file and updates the barrel export. Follow the EXACT same pattern as listings (Step 2.3).

### Step 2.5: Prompts repository swap
**File:** `src/services/api/promptsApi.ts`

**Key methods to implement:**
```typescript
export const promptsRepository = {
  getAll(appId: string, promptType?: string): Promise<PromptDefinition[]>
  getById(appId: string, id: number): Promise<PromptDefinition>
  getLatestVersion(appId: string, promptType: string): Promise<number>
  save(appId: string, prompt: Partial<PromptDefinition>): Promise<PromptDefinition>
  delete(appId: string, id: number): Promise<void>
  ensureDefaults(appId: string): Promise<void>
};
```

**Maps to API calls:**
- `getAll` → `GET /api/prompts?app_id=X&prompt_type=Y`
- `getById` → `GET /api/prompts/{id}`
- `getLatestVersion` → `GET /api/prompts?app_id=X&prompt_type=Y` then find max version client-side, OR add a dedicated endpoint
- `save` → `POST /api/prompts`
- `delete` → `DELETE /api/prompts/{id}`
- `ensureDefaults` → `POST /api/prompts/ensure-defaults` with body `{app_id: X}`

> CRITICAL: The current promptsRepository is a singleton CLASS, not a plain object. The API version should be a plain object (like listings). The store calls the same methods either way.

### Step 2.6: Schemas repository swap
**File:** `src/services/api/schemasApi.ts`
**Identical pattern to prompts.** Same method signatures, same API patterns.

### Step 2.7: Evaluators repository swap
**File:** `src/services/api/evaluatorsApi.ts`

**Key methods:**
```typescript
export const evaluatorsRepository = {
  save(evaluator: EvaluatorDefinition): Promise<void>
  getById(id: string): Promise<EvaluatorDefinition>
  getByAppId(appId: string): Promise<EvaluatorDefinition[]>
  getForListing(appId: string, listingId: string): Promise<EvaluatorDefinition[]>
  getRegistry(appId: string): Promise<EvaluatorDefinition[]>
  fork(sourceId: string, targetListingId: string): Promise<EvaluatorDefinition>
  setGlobal(id: string, isGlobal: boolean): Promise<void>
  delete(id: string): Promise<void>
};
```

**Maps to:**
- `getForListing` → `GET /api/evaluators?app_id=X&listing_id=Y`
- `getRegistry` → `GET /api/evaluators/registry?app_id=X`
- `fork` → `POST /api/evaluators/{id}/fork?listing_id=Y`
- `setGlobal` → `PUT /api/evaluators/{id}/global` with body `{is_global: true}`

### Step 2.8: Chat repository swap
**File:** `src/services/api/chatApi.ts`

**Two exports (matching current):**
```typescript
export const chatSessionsRepository = {
  getAll(appId: string): Promise<KairaChatSession[]>
  getById(appId: string, id: string): Promise<KairaChatSession>
  create(appId: string, session: Partial<KairaChatSession>): Promise<KairaChatSession>
  update(appId: string, id: string, updates: Partial<KairaChatSession>): Promise<void>
  delete(appId: string, id: string): Promise<void>
  search(appId: string, query: string): Promise<KairaChatSession[]>
};

export const chatMessagesRepository = {
  getBySession(sessionId: string): Promise<KairaChatMessage[]>
  create(message: Partial<KairaChatMessage>): Promise<KairaChatMessage>
  update(id: string, updates: Partial<KairaChatMessage>): Promise<void>
  delete(id: string): Promise<void>
  deleteBySession(sessionId: string): Promise<void>
  addTag(messageId: string, tagName: string): Promise<void>
  removeTag(messageId: string, tagName: string): Promise<void>
  updateTags(messageId: string, tags: string[]): Promise<void>
  renameTagInAllMessages(oldTag: string, newTag: string): Promise<void>
  deleteTagFromAllMessages(tagName: string): Promise<void>
};
```

### Step 2.9: History repository swap
**File:** `src/services/api/historyApi.ts`

**Key methods (historyRepository is currently a singleton class):**
```typescript
export const historyRepository = {
  save(entry: Partial<HistoryEntry>): Promise<string>
  getById(id: string): Promise<HistoryEntry>
  getByEntity(entityType: string, entityId: string, options?): Promise<HistoryQueryResult>
  getByApp(appId: string, options?): Promise<HistoryQueryResult>
  getRecent(options?): Promise<HistoryQueryResult>
  getEvaluatorRuns(filters, options?): Promise<HistoryQueryResult>
  getEvaluatorRunsForListing(listingId: string, evaluatorName?: string, options?): Promise<...>
  getAllEvaluatorRuns(evaluatorName: string, options?): Promise<...>
  deleteByEntity(entityType: string, entityId: string): Promise<void>
  deleteOlderThan(days: number, sourceType?: string): Promise<number>
};
```

> This is the most complex repository. Map each method to the appropriate API query parameters.

### Step 2.10: Settings + Tags repository swap
**Files:** `src/services/api/settingsApi.ts`, `src/services/api/tagsApi.ts`

**Settings - SPECIAL CASE:** The current settingsStore uses Zustand `persist` middleware with a custom IndexedDB storage backend. This needs to change:

1. Remove the `persist` middleware from `useSettingsStore`
2. Add `loadSettings()` and `saveSettings()` actions that call the API
3. Call `loadSettings()` on app startup
4. Call `saveSettings()` whenever settings change (debounced)

```typescript
// New settingsApi.ts
export const settingsRepository = {
  async get(appId: string | null, key: string): Promise<unknown> {
    const result = await apiRequest<{value: unknown}>(
      `/api/settings?app_id=${appId || ''}&key=${key}`
    );
    return result.value;
  },

  async set(appId: string | null, key: string, value: unknown): Promise<void> {
    await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ app_id: appId, key, value }),
    });
  },
};
```

**Tags:**
```typescript
export const tagRegistryRepository = {
  async getAllTags(appId: string): Promise<TagRegistryItem[]> { ... }
  async addTag(appId: string, tagName: string): Promise<void> { ... }
  async renameTag(appId: string, oldName: string, newName: string): Promise<void> { ... }
  async deleteTag(appId: string, tagName: string): Promise<void> { ... }
};
```

### Step 2.11: Create barrel export

**File to create:** `src/services/api/index.ts`

```typescript
/**
 * API module barrel export.
 * All repositories now use HTTP calls to the FastAPI backend.
 */
export { listingsRepository } from './listingsApi';
export { filesRepository } from './filesApi';
export { promptsRepository } from './promptsApi';
export { schemasRepository } from './schemasApi';
export { evaluatorsRepository } from './evaluatorsApi';
export { chatSessionsRepository, chatMessagesRepository } from './chatApi';
export { historyRepository } from './historyApi';
export { settingsRepository } from './settingsApi';
export { tagRegistryRepository } from './tagsApi';
```

### Step 2.12: Update storage barrel export

**File to edit:** `src/services/storage/index.ts`

Replace ALL repository exports to come from the API module:

```typescript
/**
 * Storage barrel export.
 * All repositories now delegate to HTTP API (src/services/api/).
 * The Dexie/IndexedDB code is still present but unused.
 * It will be removed in Phase 4.
 */
export {
  listingsRepository,
  filesRepository,
  promptsRepository,
  schemasRepository,
  evaluatorsRepository,
  chatSessionsRepository,
  chatMessagesRepository,
  historyRepository,
  settingsRepository,
  tagRegistryRepository,
} from '@/services/api';
```

> CRITICAL: By changing only this barrel export, every store and hook that imports from `@/services/storage` automatically gets the HTTP implementations. ZERO changes needed in stores, hooks, or components.

### Step 2.13: Update settings store (SPECIAL STEP)

**File to edit:** `src/stores/settingsStore.ts`

The settings store currently uses Zustand `persist` middleware with a custom IndexedDB storage backend. This must change to use the API.

**What to change:**
1. Remove the `persist` middleware wrapper
2. Remove the custom `indexedDbStorage` implementation
3. Add `loadSettings()` action that fetches from API on startup
4. Add internal `_saveSettings()` that PUTs to API (debounced)
5. Each setter should call `_saveSettings()` after updating state

**Pattern:**
```typescript
import { create } from 'zustand';
import { settingsRepository } from '@/services/api';

// Debounce helper
let saveTimeout: ReturnType<typeof setTimeout>;
function debouncedSave(state: SettingsState) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await settingsRepository.set(null, 'voice-rx-settings', {
        llm: state.llm,
        transcription: state.transcription,
        // ... all settings fields
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, 500);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // ... all existing state fields with their defaults ...

  loadSettings: async () => {
    try {
      const data = await settingsRepository.get(null, 'voice-rx-settings');
      if (data) {
        set(data as Partial<SettingsState>);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  // Each setter calls debouncedSave:
  setLlm: (llm) => {
    set({ llm });
    debouncedSave(get());
  },
  // ... etc for all setters
}));
```

**Also:** Call `loadSettings()` on app startup. Find the app initialization point (likely `App.tsx` or a provider) and add:

```typescript
useEffect(() => {
  useSettingsStore.getState().loadSettings();
}, []);
```

### Phase 2 Final Test

With both backend and frontend running:

1. Open the app
2. Test EVERY feature:
   - [ ] View listings list
   - [ ] Create a new listing (upload audio)
   - [ ] View listing detail
   - [ ] Delete a listing
   - [ ] View/edit prompts in settings
   - [ ] View/edit schemas in settings
   - [ ] Create/view evaluators
   - [ ] Fork an evaluator
   - [ ] Open Kaira Bot chat
   - [ ] Send a message
   - [ ] Check history/debug panel
   - [ ] Change settings (LLM config, transcription prefs)
   - [ ] Verify settings persist after page refresh
3. Check Network tab - ALL data calls should go to `/api/*` endpoints
4. Check browser Application tab → IndexedDB - should NOT be growing (old data may exist, but no new writes)

### Phase 2 Final Commit
```bash
git add src/services/api/ src/services/storage/index.ts src/stores/settingsStore.ts vite.config.ts
git commit -m "phase 2: complete frontend migration to HTTP API"
```

### Merge to main
```bash
git checkout main
git merge feat/phase-2-frontend
```
