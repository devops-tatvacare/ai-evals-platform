# Helper Scripts

Diagnostic and utility HTML files for development and debugging. All files use the project's design system and work with the current database schema (v2: listings, files, entities, history).

## Files

### clear-storage.html
**Purpose:** Storage management utility for clearing IndexedDB, localStorage, and caches.

**Features:**
- ✅ Updated for current schema (entities table with type discrimination)
- ✅ Shows detailed stats per app (listings, entities by type, history)
- ✅ Preserves API keys when clearing app data
- ✅ Handles blocked IndexedDB deletion gracefully
- ✅ Supports both Voice Rx and Kaira Bot apps

**Usage:**
```bash
open helper-scripts/clear-storage.html
```

**Options:**
- **Clear All Storage** - Nuclear option, removes everything
- **Clear Voice Rx Data** - Removes only Voice Rx listings, entities, and history
- **Clear Kaira Bot Data** - Removes only Kaira Bot chat sessions and messages

**When to use:**
- Reset application state during development
- Clear test data between iterations
- Troubleshoot storage-related issues
- Start fresh after data model changes

---

### test-indexeddb.html
**Purpose:** Low-level IndexedDB diagnostic tool.

**Features:**
- ✅ Tests raw IndexedDB API without Dexie
- ✅ Checks production database schema (ai-evals-platform v2)
- ✅ Detects blocking databases and timeout issues
- ✅ Provides actionable troubleshooting steps
- ✅ Modern UI with detailed test results

**Usage:**
```bash
open helper-scripts/test-indexeddb.html
```

**Tests Run:**
1. IndexedDB API access
2. Database listing capability
3. Production database health check
4. Open/create test database
5. Write data operations
6. Read data operations
7. Delete database cleanup

**When to use:**
- Diagnose IndexedDB connection issues
- Identify blocking databases (open in multiple tabs)
- Test browser-level storage availability
- Troubleshoot timeout/hanging issues
- Verify schema matches expected structure

---

### check-payload-data.html
**Purpose:** Interactive history data inspector for evaluator runs.

**Features:**
- ✅ Flexible listing/evaluator ID input
- ✅ Shows run statistics (total, success, errors, evaluators)
- ✅ Displays full input/output payloads
- ✅ Supports viewing all history across all apps
- ✅ URL hash support: `#<listing-id>` auto-loads data

**Usage:**
```bash
open helper-scripts/check-payload-data.html

# Or with auto-load:
open helper-scripts/check-payload-data.html#15b6cf75-6c89-4a87-98bd-a7608857bed7
```

**Options:**
- **Inspect by Listing ID** - View all runs for a specific listing
- **Filter by Evaluator** - Narrow results to specific evaluator
- **View All History** - Overview of all runs across all apps

**When to use:**
- Debug evaluator run data format issues
- Inspect input/output payload structure
- Verify history data persistence
- Analyze evaluator success/failure rates
- Troubleshoot data serialization issues

---

## Design System

All files now use the project's design system from `src/styles/globals.css`:

- **Colors:** Brand purple, neutral grays, semantic success/error/warning
- **Typography:** Inter (sans) and JetBrains Mono (code)
- **Spacing:** Consistent 8px grid
- **Borders:** Proper dark theme contrast (neutral-600/700 instead of 700/800)
- **Shadows:** Subtle elevation
- **Radius:** 6px default, 8px for cards

---

## Database Schema (v2)

These tools work with the current IndexedDB structure:

**Database:** `ai-evals-platform`

**Tables:**
- `listings` - Evaluation records (appId: 'voice-rx' | 'kaira-bot')
- `files` - Binary blobs (audio files)
- `entities` - Universal storage with type discrimination:
  - `type: 'setting'` - App settings
  - `type: 'prompt'` - LLM prompts
  - `type: 'schema'` - JSON schemas
  - `type: 'evaluator'` - Evaluator definitions
  - `type: 'chatSession'` - Kaira Bot sessions
  - `type: 'chatMessage'` - Kaira Bot messages
  - `type: 'tagRegistry'` - Tag definitions
- `history` - Evaluator run history

See `src/services/storage/SCHEMA.md` for complete documentation.

---

## Notes

- These files are standalone utilities that can be opened directly in a browser
- They are not part of the production build
- All use modern browser APIs (IndexedDB, Storage API, etc.)
- Dark theme by default (matches project)
- No external dependencies except Google Fonts

