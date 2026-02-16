# Phase 4: Cleanup & Verification

**Branch:** `feat/phase-4-cleanup`
**Goal:** Remove all Dexie/IndexedDB code, unused dependencies, dead code. Update docs.
**Outcome:** Clean codebase with no traces of the old storage layer.

**Prerequisite:** Phases 1-3 complete and merged. App fully working through PostgreSQL.

---

## Step 4.1: Create branch

```bash
git checkout main
git checkout -b feat/phase-4-cleanup
```

---

## Step 4.2: Remove Dexie and IndexedDB dependencies

**Files to edit:** `package.json`

### Instructions

Remove these packages:
```bash
npm uninstall dexie
```

Check `package.json` to confirm `dexie` is gone from `dependencies`.

### Test
```bash
npm install  # Ensure lockfile is clean
npm run build  # Should fail if any code still imports dexie - that's expected, we'll fix next
```

### Commit
```bash
git add package.json package-lock.json
git commit -m "phase 4.2: remove dexie dependency"
```

---

## Step 4.3: Delete old Dexie-based repository files

**Files to DELETE:**

These are the old IndexedDB-based repositories that have been replaced by `src/services/api/*.ts`:

```
src/services/storage/db.ts                    ← Dexie database setup
src/services/storage/repositories.ts          ← Old listings + files repositories
src/services/storage/promptsRepository.ts     ← Old prompts repository (Dexie)
src/services/storage/schemasRepository.ts     ← Old schemas repository (Dexie)
src/services/storage/chatRepository.ts        ← Old chat repository (Dexie)
src/services/storage/evaluatorsRepository.ts  ← Old evaluators repository (Dexie)
src/services/storage/historyRepository.ts     ← Old history repository (Dexie)
src/services/storage/tagRegistryRepository.ts ← Old tag registry (Dexie)
```

**Files to KEEP:**
```
src/services/storage/index.ts    ← KEEP - this is the barrel export that now re-exports from api/
src/services/storage/SCHEMA.md   ← DELETE or update to reflect PostgreSQL schema
```

### Instructions

```bash
# Delete old repository files
rm src/services/storage/db.ts
rm src/services/storage/repositories.ts
rm src/services/storage/promptsRepository.ts
rm src/services/storage/schemasRepository.ts
rm src/services/storage/chatRepository.ts
rm src/services/storage/evaluatorsRepository.ts
rm src/services/storage/historyRepository.ts
rm src/services/storage/tagRegistryRepository.ts
```

### Verify `src/services/storage/index.ts` only re-exports from API

It should look like this (from Phase 2):
```typescript
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

### Test
```bash
npm run build
# Should compile. If any file still imports from deleted files, fix the import.
```

### Commit
```bash
git add -A  # Stage deletions
git commit -m "phase 4.3: delete old Dexie-based repository files"
```

---

## Step 4.4: Remove old IndexedDB storage backend from settings store

**Files to check/edit:** `src/stores/settingsStore.ts`

### Instructions

In Phase 2 (Step 2.13), the settings store was updated to use the API. Verify that:

1. There is NO import of `dexie` or `./db` anywhere in the file
2. The custom `indexedDbStorage` object is GONE
3. The `persist` middleware from Zustand is either removed or uses a different backend
4. The `getEntity`, `saveEntity`, `deleteEntity` imports from `./db.ts` are GONE

Search the entire `src/` directory for any remaining references to Dexie or the old DB:

```bash
# Run these searches. ALL should return 0 results:
grep -r "dexie" src/ --include="*.ts" --include="*.tsx"
grep -r "from.*db'" src/services/ --include="*.ts"
grep -r "IndexedDB\|indexedDb" src/ --include="*.ts" --include="*.tsx"
grep -r "getEntity\|saveEntity\|deleteEntity" src/ --include="*.ts" --include="*.tsx"
```

If any results are found, update those files to use the API repositories instead.

### Common files that might still reference old code:
- `src/stores/settingsStore.ts` - should be updated in Phase 2
- `src/features/*/hooks/*.ts` - should NOT directly reference storage, but check
- `src/app/` files - might have IndexedDB initialization code to remove

### Commit
```bash
git add -A
git commit -m "phase 4.4: remove all remaining IndexedDB references"
```

---

## Step 4.5: Remove unused TypeScript types

**Files to check:** `src/types/`

### Instructions

Check if any types were ONLY used by the old Dexie storage layer and are no longer needed:

1. The `Entity` type from `db.ts` - this was the IndexedDB entity discrimination type. It's no longer needed since each entity is now its own PostgreSQL table.

2. The `StoredFile` type from `db.ts` - replaced by the file metadata from the API.

3. Check `src/types/` for any types that reference `Entity`, `StoredFile`, or Dexie-specific patterns.

> IMPORTANT: Do NOT delete types that are still used by components, hooks, or stores. Only delete types that were exclusively used by the old storage layer.

**Types that SHOULD still exist** (used by components/stores):
- `Listing` - used everywhere
- `PromptDefinition` - used by prompts UI
- `SchemaDefinition` - used by schemas UI
- `EvaluatorDefinition` - used by evaluators UI
- `KairaChatSession`, `KairaChatMessage` - used by chat UI
- `HistoryEntry` - used by debug panel
- `AppId` - used everywhere

### Commit
```bash
git add -A
git commit -m "phase 4.5: remove unused storage-specific types"
```

---

## Step 4.6: Clean up storage docs

**Files to edit/delete:**

1. **DELETE** `src/services/storage/SCHEMA.md` - describes old IndexedDB schema, now obsolete
2. **UPDATE** `CLAUDE.md` - remove all IndexedDB/Dexie references, update architecture section
3. **UPDATE** `docs/PROJECT 101.md` - if it references storage architecture

### Instructions for CLAUDE.md updates

The following sections need updating:

**Architecture Overview → Stack:**
```
- **Storage:** PostgreSQL + JSONB via FastAPI backend (was: Dexie/IndexedDB)
```

**Architecture Overview → Data Flow:**
```
User (UI) → Component → Hook → Store → API Client (fetch) → FastAPI → PostgreSQL
```

**Storage Architecture section:** Replace entirely with:
```
### Storage Architecture (PostgreSQL)
- Database: PostgreSQL 16 with JSONB columns
- Backend: FastAPI (Python) at backend/
- Tables: listings, files, prompts, schemas, evaluators, chat_sessions, chat_messages, settings, tags, history, jobs, eval_runs, thread_evaluations, adversarial_evaluations, api_logs
- File storage: Local filesystem (dev) / Azure Blob Storage (prod)
- Access: All data access through HTTP API, no direct DB calls from frontend
```

**Remove these sections/references:**
- All Dexie.js references
- IndexedDB entity discrimination pattern description
- `getEntity`, `saveEntity`, `deleteEntity` helper documentation
- The "Zustand Anti-Pattern" section can stay (it's still relevant)

**Storage Access pattern update:**
```typescript
// OLD (remove):
import { listingsRepository } from '@/services/storage';
await listingsRepository.save(listing);

// NEW (same code, different implementation behind the scenes):
import { listingsRepository } from '@/services/storage';
await listingsRepository.save(listing);  // Now calls HTTP API
```

### Commit
```bash
git add -A
git commit -m "phase 4.6: update documentation for PostgreSQL architecture"
```

---

## Step 4.7: Remove unused npm packages

### Instructions

Check if any of these packages are now unused and can be removed:

```bash
# Check what's in package.json dependencies
# These MIGHT be removable if they were only used by Dexie:
# (verify each one before removing)

# Definitely remove:
npm uninstall dexie  # Already done in 4.2, but verify

# Check if these are still used:
# - uuid (might be used elsewhere, check imports)
# - Any other storage-related packages
```

Run depcheck to find unused dependencies:
```bash
npx depcheck
```

Remove any packages that depcheck reports as unused, UNLESS they are used by the build system or Vite plugins.

### Commit
```bash
git add package.json package-lock.json
git commit -m "phase 4.7: remove unused npm dependencies"
```

---

## Step 4.8: Final build and verification

### Instructions

```bash
# 1. Clean build
npm run build

# 2. Lint
npm run lint

# 3. TypeScript type check
npx tsc -b

# 4. Start everything and test
docker compose up -d                                    # PostgreSQL
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8721 --reload &  # Backend
cd .. && npm run dev                                    # Frontend

# 5. Full feature parity test (from OVERVIEW.md checklist):
# Open http://localhost:5173 and test EVERY feature
```

### Feature Parity Checklist (MUST ALL PASS):

- [ ] Listings: list, create, view detail, update, delete
- [ ] Audio: upload audio file, play back audio
- [ ] Prompts: view all, create new version, delete non-default
- [ ] Schemas: view all, create new version, delete non-default
- [ ] Evaluators: create, view, fork, toggle global, delete
- [ ] Chat: create session, send message, view messages, delete session
- [ ] Tags: add tag to message, remove tag, rename tag
- [ ] History: view history entries, filter by entity
- [ ] Settings: change LLM config, verify persists after refresh
- [ ] Debug panel: opens and shows data (Ctrl+Shift+D / Cmd+Shift+D)
- [ ] Search: search listings by title
- [ ] Evaluation: run interactive evaluation on a listing
- [ ] Network tab: ALL data calls go to /api/*, NO IndexedDB activity

### Verify NO IndexedDB usage:
1. Open browser DevTools → Application → IndexedDB
2. There should be NO `ai-evals-platform` database being written to
3. Old data may exist but should not grow

### Commit
```bash
git add -A
git commit -m "phase 4.8: final verification - all tests pass, clean build"
```

---

## Step 4.9: Optional - Delete the old storage directory

If `src/services/storage/` now contains ONLY `index.ts` (the barrel re-export), you can:

**Option A: Keep it** - The barrel export is a nice abstraction layer. Stores import from `@/services/storage` without knowing about `@/services/api`. This is cleaner.

**Option B: Remove it** - Update all store imports to use `@/services/api` directly, then delete `src/services/storage/` entirely.

**Recommendation: Keep it (Option A).** The indirection is minimal and gives you flexibility to swap implementations again in the future (e.g., adding caching).

---

## Phase 4 Final Commit
```bash
git add -A
git commit -m "phase 4: cleanup complete - Dexie removed, codebase clean"
```

## Merge to main
```bash
git checkout main
git merge feat/phase-4-cleanup
```

---

## Post-Migration: What's Next?

After all 4 phases are complete and merged:

1. **Add Alembic** for future schema migrations (so you don't rely on `create_all()` forever)
2. **Add user authentication** when ready (FastAPI middleware + user_id columns are already in place)
3. **Implement Azure Blob Storage** in `file_storage.py` for production file handling
4. **Build the evaluation dashboard UI** using the eval-runs API endpoints
5. **Dockerize the backend** for production deployment to Azure Container Apps
6. **Set up CI/CD** for automated testing and deployment

### Production Deployment Checklist
- [ ] Create Azure Database for PostgreSQL (Flexible Server)
- [ ] Create Azure Blob Storage container
- [ ] Create Azure Container Apps environment
- [ ] Deploy FastAPI backend as container
- [ ] Deploy React frontend to Azure Static Web Apps
- [ ] Configure environment variables in Azure
- [ ] Set up Azure Front Door or reverse proxy for /api routing
- [ ] Run Alembic migrations against production DB
- [ ] Verify all features work in production
