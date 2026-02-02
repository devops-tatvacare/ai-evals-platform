# Investigation Summary - IndexedDB Hang

## Context

- Reported issue: app freezes/hangs on listing detail page while loading audio. Logs show hang at `db.files.get(id)`.
- Known good baseline: commit `1935f98168f6afab969c28b5a1eb023371293890` (Voice Rx working).
- Current behavior: Safari IndexedDB shows DB name `ai-evals-platform-v4` with version 20 and no data; `db.ts` logs show version 2.

## Key Findings (Diff vs 1935f)

- Database layer was redesigned from single-app to multi-app with new schema and new tables.
  - Baseline DB: `voice-rx-evaluator`, version 1, stores: `listings`, `files`, `settings`.
  - Current DB: `ai-evals-platform-v4`, version 2, stores: `listings`, `files`, `globalSettings`, `appSettings`, `kairaChatSessions`, `kairaChatMessages`.
- `StoredFile` and `Listing` now include `appId`. Repositories are app-scoped with ownership checks and DB availability gating.
- Transcript audio flow is unchanged; only logging, duplicate-load guard, and small delay were added.

## Why the Hang is Likely DB-Related

- The hang is at `db.files.get(id)` (Dexie/IndexedDB). The audio UI code path is essentially the same as the working baseline.
- Safari showing DB version 20 while Dexie expects 2 indicates a schema/version mismatch or prior failed upgrades.
- The delete + open sequence can create a version-1 DB with no stores if `indexedDB.open(name)` runs before Dexie initializes, which is consistent with the observed "version 1 / no stores" output.

## Observed Console/Storage Results

- `[DB] Version: 2` logged by app (Dexie schema version, not necessarily the underlying IDB version).
- Manual IDB open without version created a v1 DB with no stores.
- Delete command logged `Deleted`, confirming DB deletion succeeded.

## Working Hypothesis

- IndexedDB state is inconsistent (version mismatch / empty stores) after app and DB migration changes.
- Safari may be wedging on Blob reads when DB state is inconsistent, causing the main thread to hang.

## Suggested Fix Path (No Code Changes)

1. Close all `http://localhost:5173` tabs.
2. Delete DB via console (confirmed workable):
   - `indexedDB.deleteDatabase('ai-evals-platform-v4')`
3. Reload app and wait for Dexie logs showing version 2 and tables present.
4. Only after app loads, verify DB using `indexedDB.open('ai-evals-platform-v4', 2)` (avoid creating v1 DB).
5. Test with a tiny audio file first, then with a 5MB file.

## If Hang Persists After Clean DB

- Test raw IndexedDB read (bypass Dexie) to isolate whether Safari hangs on Blob reads.
- If raw read hangs: change storage strategy for audio (store ArrayBuffer or chunk data; keep metadata in IndexedDB).
- If raw read works: investigate Dexie version-specific Safari issues or bypass Dexie for file reads.

## Files Reviewed

- `src/services/storage/db.ts`
- `src/services/storage/repositories.ts`
- `src/features/transcript/components/TranscriptView.tsx`
- `src/features/upload/hooks/useFileUpload.ts`
- `src/types/listing.types.ts`
