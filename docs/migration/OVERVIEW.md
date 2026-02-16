# Migration Plan: IndexedDB to PostgreSQL + FastAPI

## Status: PLAN ONLY - DO NOT IMPLEMENT WITHOUT APPROVAL

## Document Index

| File | Contents |
|------|----------|
| `OVERVIEW.md` (this file) | Architecture, branch strategy, prerequisites, schema |
| `PHASE_1_BACKEND.md` | Backend foundation: Docker, PostgreSQL, FastAPI, all routes |
| `PHASE_2_FRONTEND.md` | Frontend migration: HTTP client, repository swap |
| `PHASE_3_KAIRA_MERGE.md` | Kaira-evals merge + job execution system |
| `PHASE_4_CLEANUP.md` | Remove Dexie/IndexedDB, dead code, update docs |

---

## Architecture: Before vs After

### BEFORE (Current)
```
React App (browser)
  → Zustand stores (in-memory cache)
    → Repository layer (TypeScript)
      → Dexie.js (IndexedDB wrapper)
        → IndexedDB (browser storage)

LLM calls: Browser → Gemini SDK directly
Files: Stored as Blobs in IndexedDB
```

### AFTER (Target)
```
React App (browser)
  → Zustand stores (in-memory cache, unchanged)
    → Repository layer (TypeScript, same interface)
      → HTTP fetch() calls
        → FastAPI (Python backend)
          → PostgreSQL + JSONB
          → Local filesystem / Azure Blob Storage (files)

LLM calls: Still browser → Gemini SDK for interactive mode
           Backend → Gemini/Azure OpenAI for batch jobs (Phase 3)
```

### Key Principle
**The Zustand stores and React components DO NOT CHANGE.** Only the repository implementations change from Dexie calls to HTTP calls. The API surface between stores and repositories stays identical.

---

## Branch Strategy

Each phase runs on its own branch. Merge to `main` after verification. If a phase fails, `main` is untouched.

```
main (current, stable)
  │
  ├── feat/phase-1-backend        → merge to main when API works
  │
  ├── feat/phase-2-frontend       → merge to main when app works E2E
  │
  ├── feat/phase-3-kaira-merge    → merge to main when jobs work
  │
  └── feat/phase-4-cleanup        → merge to main when clean
```

**Before EVERY phase:**
```bash
git checkout main
git pull
git checkout -b feat/phase-N-description
```

**After EVERY step within a phase:**
```bash
git add <specific files from that step>
git commit -m "phase N.X: <description>"
```

**After completing a phase:**
```bash
git checkout main
git merge feat/phase-N-description
```

---

## Prerequisites

Before starting Phase 1, ensure:

1. **Docker Desktop** installed and running
2. **Python 3.12+** available (via pyenv)
3. **Node.js 18+** (already have, for the React app)
4. Current code committed to `main` with no uncommitted changes

---

## Directory Structure (Target)

```
ai-evals-platform/
├── backend/                      # NEW - FastAPI backend
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py               # FastAPI app + startup
│   │   ├── config.py             # Environment config
│   │   ├── database.py           # SQLAlchemy async engine + session
│   │   ├── models/               # SQLAlchemy ORM models
│   │   │   ├── __init__.py
│   │   │   ├── base.py           # Declarative base + mixins
│   │   │   ├── listing.py
│   │   │   ├── file_record.py
│   │   │   ├── prompt.py
│   │   │   ├── schema.py
│   │   │   ├── evaluator.py
│   │   │   ├── chat.py           # ChatSession + ChatMessage
│   │   │   ├── history.py
│   │   │   ├── setting.py
│   │   │   ├── tag.py
│   │   │   ├── job.py
│   │   │   └── eval_run.py       # Phase 3
│   │   ├── schemas/              # Pydantic request/response models
│   │   │   ├── __init__.py
│   │   │   ├── common.py         # Shared pagination, etc.
│   │   │   ├── listing.py
│   │   │   ├── file.py
│   │   │   ├── prompt.py
│   │   │   ├── schema.py
│   │   │   ├── evaluator.py
│   │   │   ├── chat.py
│   │   │   ├── history.py
│   │   │   ├── setting.py
│   │   │   ├── tag.py
│   │   │   └── job.py            # Phase 3
│   │   ├── routes/               # API endpoint handlers
│   │   │   ├── __init__.py
│   │   │   ├── listings.py
│   │   │   ├── files.py
│   │   │   ├── prompts.py
│   │   │   ├── schemas.py
│   │   │   ├── evaluators.py
│   │   │   ├── chat.py
│   │   │   ├── history.py
│   │   │   ├── settings.py
│   │   │   ├── tags.py
│   │   │   └── jobs.py           # Phase 3
│   │   └── services/             # Business logic
│   │       ├── __init__.py
│   │       ├── file_storage.py   # Local/Azure Blob abstraction
│   │       └── job_worker.py     # Phase 3
│   └── uploads/                  # Local file storage (dev only)
│
├── docker-compose.yml            # NEW - PostgreSQL + backend
├── .env.backend                  # NEW - Backend env vars (gitignored)
│
├── src/                          # EXISTING - React frontend
│   ├── services/
│   │   ├── api/                  # NEW - HTTP client layer
│   │   │   ├── client.ts         # Base fetch wrapper
│   │   │   ├── listingsApi.ts
│   │   │   ├── filesApi.ts
│   │   │   ├── promptsApi.ts
│   │   │   ├── schemasApi.ts
│   │   │   ├── evaluatorsApi.ts
│   │   │   ├── chatApi.ts
│   │   │   ├── historyApi.ts
│   │   │   ├── settingsApi.ts
│   │   │   ├── tagsApi.ts
│   │   │   └── index.ts
│   │   └── storage/              # EXISTING → gutted in Phase 4
│   └── ...
│
├── vite.config.ts                # MODIFIED - add /api proxy
├── package.json                  # MODIFIED - remove dexie dep
└── ...
```

---

## Complete PostgreSQL Schema

This is the FULL database schema. All tables, all indexes, all constraints.
Referenced by Phase 1 steps.

```sql
-- ============================================================
-- AI Evals Platform - PostgreSQL Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────────────────────
-- LISTINGS - Evaluation records (was: IndexedDB listings table)
-- ────────────────────────────────────────────────────────────
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL,
    title VARCHAR(500) DEFAULT '',
    status VARCHAR(20) DEFAULT 'draft',
    source_type VARCHAR(20) DEFAULT 'upload',
    audio_file JSONB,
    transcript_file JSONB,
    structured_json_file JSONB,
    transcript JSONB,
    api_response JSONB,
    structured_output_references JSONB DEFAULT '[]'::jsonb,
    structured_outputs JSONB DEFAULT '[]'::jsonb,
    ai_eval JSONB,
    human_eval JSONB,
    evaluator_runs JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_listings_app_id ON listings(app_id);
CREATE INDEX idx_listings_updated_at ON listings(updated_at DESC);
CREATE INDEX idx_listings_user_id ON listings(user_id);
CREATE INDEX idx_listings_status ON listings(status);

-- ────────────────────────────────────────────────────────────
-- FILES - File metadata (blobs on filesystem/Azure Blob)
-- Was: IndexedDB files table with inline Blobs
-- ────────────────────────────────────────────────────────────
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    storage_path VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default'
);

-- ────────────────────────────────────────────────────────────
-- PROMPTS - Versioned LLM prompt templates
-- Was: entities WHERE type='prompt'
-- ────────────────────────────────────────────────────────────
CREATE TABLE prompts (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(50) NOT NULL,
    prompt_type VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(200) NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_default BOOLEAN DEFAULT FALSE,
    source_type VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default',
    UNIQUE(app_id, prompt_type, version, user_id)
);

CREATE INDEX idx_prompts_lookup ON prompts(app_id, prompt_type);

-- ────────────────────────────────────────────────────────────
-- SCHEMAS - Versioned JSON schemas for structured LLM output
-- Was: entities WHERE type='schema'
-- ────────────────────────────────────────────────────────────
CREATE TABLE schemas (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(50) NOT NULL,
    prompt_type VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(200) NOT NULL,
    schema_data JSONB NOT NULL,
    description TEXT DEFAULT '',
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default',
    UNIQUE(app_id, prompt_type, version, user_id)
);

CREATE INDEX idx_schemas_lookup ON schemas(app_id, prompt_type);

-- ────────────────────────────────────────────────────────────
-- EVALUATORS - Custom evaluator definitions
-- Was: entities WHERE type='evaluator'
-- ────────────────────────────────────────────────────────────
CREATE TABLE evaluators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL,
    listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    prompt TEXT NOT NULL,
    model_id VARCHAR(100),
    output_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_global BOOLEAN DEFAULT FALSE,
    show_in_header BOOLEAN DEFAULT FALSE,
    forked_from UUID REFERENCES evaluators(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_evaluators_app_id ON evaluators(app_id);
CREATE INDEX idx_evaluators_listing_id ON evaluators(listing_id);
CREATE INDEX idx_evaluators_global ON evaluators(is_global) WHERE is_global = TRUE;

-- ────────────────────────────────────────────────────────────
-- CHAT_SESSIONS - Kaira Bot conversation sessions
-- Was: entities WHERE type='chatSession'
-- ────────────────────────────────────────────────────────────
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL,
    external_user_id VARCHAR(100),
    thread_id VARCHAR(200),
    server_session_id VARCHAR(200),
    last_response_id VARCHAR(200),
    title VARCHAR(500) DEFAULT 'New Chat',
    status VARCHAR(20) DEFAULT 'active',
    is_first_message BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_chat_sessions_app ON chat_sessions(app_id);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);

-- ────────────────────────────────────────────────────────────
-- CHAT_MESSAGES - Individual messages within sessions
-- Was: entities WHERE type='chatMessage'
-- ────────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'complete',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- ────────────────────────────────────────────────────────────
-- SETTINGS - User/app settings
-- Was: entities WHERE type='setting'
-- ────────────────────────────────────────────────────────────
CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(50),
    key VARCHAR(200) NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id VARCHAR(100) DEFAULT 'default',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(app_id, key, user_id)
);

-- ────────────────────────────────────────────────────────────
-- TAGS - Tag registry for autocomplete
-- Was: entities WHERE type='tagRegistry'
-- ────────────────────────────────────────────────────────────
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    count INTEGER DEFAULT 0,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default',
    UNIQUE(app_id, name, user_id)
);

-- ────────────────────────────────────────────────────────────
-- HISTORY - Audit log for evaluator runs and events
-- Was: IndexedDB history table
-- ────────────────────────────────────────────────────────────
CREATE TABLE history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(200),
    source_type VARCHAR(50) NOT NULL,
    source_id VARCHAR(200),
    status VARCHAR(20) NOT NULL,
    duration_ms REAL,
    data JSONB,
    triggered_by VARCHAR(20) DEFAULT 'manual',
    schema_version VARCHAR(20),
    user_context JSONB,
    timestamp BIGINT NOT NULL,
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_history_timestamp ON history(timestamp DESC);
CREATE INDEX idx_history_entity ON history(entity_type, entity_id, timestamp);
CREATE INDEX idx_history_source ON history(source_type, source_id, timestamp);
CREATE INDEX idx_history_app_source ON history(app_id, source_type, timestamp);
CREATE INDEX idx_history_entity_source ON history(entity_id, source_type, source_id, timestamp);

-- ────────────────────────────────────────────────────────────
-- JOBS - Background job queue (for batch evaluations)
-- NEW - no IndexedDB equivalent
-- ────────────────────────────────────────────────────────────
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'queued',
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    progress JSONB DEFAULT '{"current": 0, "total": 0, "message": ""}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- EVAL_RUNS - Batch evaluation runs (from kaira-evals merge)
-- Was: kaira-evals SQLite runs table
-- ────────────────────────────────────────────────────────────
CREATE TABLE eval_runs (
    id VARCHAR(20) PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    command VARCHAR(50) NOT NULL,
    llm_provider VARCHAR(50),
    llm_model VARCHAR(100),
    eval_temperature REAL DEFAULT 0.0,
    data_path VARCHAR(500),
    data_file_hash VARCHAR(50),
    flags JSONB DEFAULT '{}'::jsonb,
    duration_seconds REAL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'running',
    error_message TEXT,
    summary JSONB,
    total_items INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    user_id VARCHAR(100) DEFAULT 'default'
);

CREATE INDEX idx_eval_runs_status ON eval_runs(status);
CREATE INDEX idx_eval_runs_command ON eval_runs(command);

-- ────────────────────────────────────────────────────────────
-- THREAD_EVALUATIONS - Per-thread eval results (kaira-evals)
-- Was: kaira-evals SQLite thread_evaluations table
-- ────────────────────────────────────────────────────────────
CREATE TABLE thread_evaluations (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(20) NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    thread_id VARCHAR(200) NOT NULL,
    data_file_hash VARCHAR(50),
    intent_accuracy REAL,
    worst_correctness VARCHAR(20),
    efficiency_verdict VARCHAR(20),
    success_status BOOLEAN DEFAULT FALSE,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_thread_evals_run ON thread_evaluations(run_id);
CREATE INDEX idx_thread_evals_thread ON thread_evaluations(thread_id);
CREATE INDEX idx_thread_evals_hash ON thread_evaluations(data_file_hash);

-- ────────────────────────────────────────────────────────────
-- ADVERSARIAL_EVALUATIONS - Adversarial test results (kaira-evals)
-- Was: kaira-evals SQLite adversarial_evaluations table
-- ────────────────────────────────────────────────────────────
CREATE TABLE adversarial_evaluations (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(20) NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    category VARCHAR(50),
    difficulty VARCHAR(20),
    verdict VARCHAR(20),
    goal_achieved BOOLEAN DEFAULT FALSE,
    total_turns INTEGER DEFAULT 0,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adversarial_evals_run ON adversarial_evaluations(run_id);

-- ────────────────────────────────────────────────────────────
-- API_LOGS - LLM API call logs (kaira-evals)
-- Was: kaira-evals SQLite api_logs table
-- ────────────────────────────────────────────────────────────
CREATE TABLE api_logs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(20) REFERENCES eval_runs(id) ON DELETE CASCADE,
    thread_id VARCHAR(200),
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    method VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    system_prompt TEXT,
    response TEXT,
    error TEXT,
    duration_ms REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_logs_run ON api_logs(run_id);
CREATE INDEX idx_api_logs_thread ON api_logs(thread_id);
```

---

## API Endpoint Reference

Every endpoint the FastAPI server will expose. Referenced by Phase 1 route steps.

### Listings
| Method | Path | Description | Maps to current |
|--------|------|-------------|-----------------|
| GET | `/api/listings?app_id=X` | List all for app, sorted by updated_at DESC | `listingsRepository.getAll(appId)` |
| GET | `/api/listings/{id}?app_id=X` | Get one by ID | `listingsRepository.getById(appId, id)` |
| POST | `/api/listings` | Create new listing | `listingsRepository.create(appId, data)` |
| PUT | `/api/listings/{id}` | Update listing | `listingsRepository.update(appId, id, data)` |
| DELETE | `/api/listings/{id}?app_id=X` | Delete + cascade files & history | `listingsRepository.delete(appId, id)` |
| GET | `/api/listings/search?app_id=X&q=Y` | Search by title | `listingsRepository.search(appId, q)` |

### Files
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/files/upload` | Upload file (multipart), returns file record |
| GET | `/api/files/{id}` | Get file metadata |
| GET | `/api/files/{id}/download` | Download actual file bytes |
| DELETE | `/api/files/{id}` | Delete file + blob |

### Prompts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompts?app_id=X&prompt_type=Y` | List prompts (optional type filter) |
| GET | `/api/prompts/{id}` | Get prompt by ID |
| POST | `/api/prompts` | Create/save prompt (auto-increments version) |
| DELETE | `/api/prompts/{id}` | Delete prompt (blocks defaults) |
| POST | `/api/prompts/ensure-defaults` | Seed default prompts for app |

### Schemas
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/schemas?app_id=X&prompt_type=Y` | List schemas |
| GET | `/api/schemas/{id}` | Get schema by ID |
| POST | `/api/schemas` | Create/save schema |
| DELETE | `/api/schemas/{id}` | Delete schema |
| POST | `/api/schemas/ensure-defaults` | Seed defaults |

### Evaluators
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/evaluators?app_id=X&listing_id=Y` | Get evaluators for listing (STRICT scoping) |
| GET | `/api/evaluators/registry?app_id=X` | Get global evaluators |
| GET | `/api/evaluators/{id}` | Get by ID |
| POST | `/api/evaluators` | Create evaluator |
| PUT | `/api/evaluators/{id}` | Update evaluator |
| DELETE | `/api/evaluators/{id}` | Delete evaluator |
| POST | `/api/evaluators/{id}/fork` | Fork to new listing |
| PUT | `/api/evaluators/{id}/global` | Toggle global flag |

### Chat
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/sessions?app_id=X` | List sessions |
| GET | `/api/chat/sessions/{id}` | Get session |
| POST | `/api/chat/sessions` | Create session |
| PUT | `/api/chat/sessions/{id}` | Update session |
| DELETE | `/api/chat/sessions/{id}` | Delete session + cascade messages |
| GET | `/api/chat/sessions/{id}/messages` | Get messages for session |
| POST | `/api/chat/messages` | Create message |
| PUT | `/api/chat/messages/{id}` | Update message |
| DELETE | `/api/chat/messages/{id}` | Delete message |
| PUT | `/api/chat/messages/{id}/tags` | Update tags on message |

### History
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/history?app_id=X&entity_type=Y&entity_id=Z` | Query history |
| GET | `/api/history/{id}` | Get entry by ID |
| POST | `/api/history` | Create entry |
| DELETE | `/api/history/by-entity?entity_type=X&entity_id=Y` | Delete by entity |
| DELETE | `/api/history/older-than?days=N` | Cleanup old entries |
| GET | `/api/history/evaluator-runs?listing_id=X` | Get evaluator run history |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings?app_id=X&key=Y` | Get setting |
| PUT | `/api/settings` | Upsert setting |
| DELETE | `/api/settings?app_id=X&key=Y` | Delete setting |

### Tags
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tags?app_id=X` | Get all tags |
| POST | `/api/tags` | Add/increment tag |
| PUT | `/api/tags/rename` | Rename tag |
| DELETE | `/api/tags?app_id=X&name=Y` | Delete tag |

### Jobs (Phase 3)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs` | Submit new job |
| GET | `/api/jobs?status=X` | List jobs |
| GET | `/api/jobs/{id}` | Get job status + progress |
| POST | `/api/jobs/{id}/cancel` | Cancel running job |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (DB connectivity) |

---

## Feature Parity Checklist

Use this to verify NOTHING is lost after migration:

- [ ] Listings: CRUD, app isolation, cascade delete, search by title
- [ ] Files: Upload audio, download audio, delete with listing
- [ ] Prompts: CRUD, versioning, default seeding, per-app isolation
- [ ] Schemas: CRUD, versioning, default seeding, per-app isolation
- [ ] Evaluators: CRUD, listing scoping, global registry, fork, lineage
- [ ] Chat sessions: CRUD, app isolation, cascade delete messages
- [ ] Chat messages: CRUD, tag management (add/remove/rename), metadata
- [ ] History: CRUD, compound queries, time-range, entity+source queries
- [ ] Settings: Get/set, app-scoped, persists across sessions
- [ ] Tags: Registry, autocomplete data, rename across all messages
- [ ] Storage monitoring: DB size stats (replaces IndexedDB quota check)
- [ ] Debug panel: Still works (reads from stores, stores read from API)
- [ ] Evaluation pipeline: Two-call flow still works (interactive mode)

---

## Environment Variables

### Backend (.env.backend - gitignored)
```env
# Database
DATABASE_URL=postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform

# File storage
FILE_STORAGE_TYPE=local
FILE_STORAGE_PATH=./uploads

# Server
API_PORT=8721
CORS_ORIGINS=http://localhost:5173

# LLM (for Phase 3 batch jobs)
GEMINI_API_KEY=
AZURE_OPENAI_KEY=
AZURE_OPENAI_ENDPOINT=
```

### Frontend (.env)
```env
# Already exists, add:
VITE_API_URL=http://localhost:8721
```

### Production overrides
```env
DATABASE_URL=postgresql+asyncpg://user:pass@your-azure-pg.postgres.database.azure.com:5432/ai_evals_platform
FILE_STORAGE_TYPE=azure_blob
AZURE_STORAGE_CONNECTION_STRING=...
CORS_ORIGINS=https://your-domain.com
```
