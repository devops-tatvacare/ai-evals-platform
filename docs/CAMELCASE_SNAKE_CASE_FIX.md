# Fix: Eliminate Manual camelCase/snake_case Mapping

## Problem

Backend uses Python snake_case (`source_type`, `audio_file`). Frontend uses JS camelCase
(`sourceType`, `audioFile`). Currently every frontend API module manually maps between the two,
field by field. This is error-prone — `listingsApi.ts` was missed entirely, breaking the Voice Rx
upload flow (audio file reference lost, no header buttons, no audio player).

## Solution

Configure Pydantic schemas to output camelCase via `alias_generator = to_camel`. Backend
Python code stays snake_case. API responses become camelCase. Frontend receives data natively.
Zero manual mapping.

## Verified Behavior (tested in container)

```
to_camel("source_type")  → "sourceType"     ✓
to_camel("audio_file")   → "audioFile"      ✓
to_camel("ai_eval")      → "aiEval"         ✓
to_camel("metadata_")    → "metadata_"      ✗ DOES NOT strip trailing underscore
```

**Edge cases verified:**

| Scenario | Result | Solution |
|----------|--------|----------|
| `to_camel("metadata_")` | Returns `"metadata_"` (wrong) | Use explicit `Field(alias="metadata")` |
| UUID object in `id: str` field | **FAILS** validation | Change to `id: uuid.UUID` — Pydantic serializes to string in JSON |
| `None` in `list` field | **FAILS** validation | Add `@field_validator(mode='before')` to convert None→[] |
| `datetime` field | Serializes to ISO string | Works out of the box |
| Nested JSONB dict content | Keys untouched | `alias_generator` only affects schema's own fields |
| Input accepts both conventions | `populate_by_name=True` | Accepts `sourceType` AND `source_type` |

---

## Implementation

### Step 0: Create Base Classes

Create `backend/app/schemas/base.py`:

```python
"""Base schema classes with camelCase alias generation."""
from pydantic import BaseModel
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for request schemas (Create/Update). Accepts and outputs camelCase."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
    }


class CamelORMModel(BaseModel):
    """Base for response schemas. Reads from SQLAlchemy, outputs camelCase."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
        "from_attributes": True,
    }
```

All schemas inherit from these instead of `BaseModel` directly.

---

### Step 1: Update Backend Schemas

For each schema file, change `BaseModel` → `CamelModel` (Create/Update) or `CamelORMModel`
(Response), and handle edge cases.

#### `backend/app/schemas/listing.py`

```python
"""Listing request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import field_validator
from app.schemas.base import CamelModel, CamelORMModel


class ListingCreate(CamelModel):
    app_id: str
    title: str = ""
    status: str = "draft"
    source_type: str = "upload"
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: list = []
    structured_outputs: list = []
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: list = []


class ListingUpdate(CamelModel):
    title: Optional[str] = None
    status: Optional[str] = None
    source_type: Optional[str] = None
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: Optional[list] = None
    structured_outputs: Optional[list] = None
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: Optional[list] = None


class ListingResponse(CamelORMModel):
    id: uuid.UUID                                        # CHANGED from str
    app_id: str
    title: str
    status: str
    source_type: str
    audio_file: Optional[dict] = None
    transcript_file: Optional[dict] = None
    structured_json_file: Optional[dict] = None
    transcript: Optional[dict] = None
    api_response: Optional[dict] = None
    structured_output_references: list = []
    structured_outputs: list = []
    ai_eval: Optional[dict] = None
    human_eval: Optional[dict] = None
    evaluator_runs: list = []
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"

    @field_validator(
        'structured_output_references', 'structured_outputs', 'evaluator_runs',
        mode='before'
    )
    @classmethod
    def none_to_list(cls, v):
        return v if v is not None else []
```

#### `backend/app/schemas/chat.py`

```python
"""Chat request/response schemas."""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import Field
from app.schemas.base import CamelModel, CamelORMModel


class SessionCreate(CamelModel):
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str = "New Chat"
    status: str = "active"
    is_first_message: bool = True


class SessionUpdate(CamelModel):
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    is_first_message: Optional[bool] = None


class SessionResponse(CamelORMModel):
    id: uuid.UUID                                        # CHANGED from str
    app_id: str
    external_user_id: Optional[str] = None
    thread_id: Optional[str] = None
    server_session_id: Optional[str] = None
    last_response_id: Optional[str] = None
    title: str
    status: str
    is_first_message: bool
    created_at: datetime
    updated_at: datetime
    user_id: str = "default"


class MessageCreate(CamelModel):
    session_id: str
    role: str
    content: str = ""
    metadata_: Optional[dict] = Field(None, alias="metadata")  # EXPLICIT ALIAS
    status: str = "complete"
    error_message: Optional[str] = None


class MessageUpdate(CamelModel):
    role: Optional[str] = None
    content: Optional[str] = None
    metadata_: Optional[dict] = Field(None, alias="metadata")  # EXPLICIT ALIAS
    status: Optional[str] = None
    error_message: Optional[str] = None


class MessageResponse(CamelORMModel):
    id: uuid.UUID                                        # CHANGED from str
    session_id: uuid.UUID                                # CHANGED from str
    role: str
    content: str
    metadata_: Optional[dict] = Field(None, alias="metadata")  # EXPLICIT ALIAS
    status: str
    error_message: Optional[str] = None
    created_at: datetime
    user_id: str = "default"
```

**NOTE on `metadata_`**: `to_camel("metadata_")` returns `"metadata_"` (does NOT strip the
underscore). The explicit `Field(alias="metadata")` overrides the generator. This makes the API
output `"metadata"` which is what the frontend expects. Verified working.

#### `backend/app/schemas/prompt.py`

Same pattern: `CamelModel` for Create/Update, `CamelORMModel` for Response.
Change `id: str` → `id: uuid.UUID` if the model uses UUID primary key. (Check model — prompts
may use integer or string IDs, not UUID. Adjust accordingly.)

#### `backend/app/schemas/schema.py`

Same pattern. Note: field `schema_data` → `to_camel` produces `schemaData`.
Frontend type currently uses `schema`. Two options:
- **Option A (recommended)**: Rename frontend field from `schema` to `schemaData`
- **Option B**: Add explicit `schema_data: dict = Field(alias="schema")` — but `schema` is a
  Pydantic reserved/common word, could cause confusion

#### `backend/app/schemas/tag.py`

Same pattern. No special cases.

#### `backend/app/schemas/history.py`

Same pattern. Note: frontend `HistoryEntry` type currently uses snake_case fields throughout.
After this change, the API outputs camelCase. Update the frontend type to match.

#### `backend/app/schemas/evaluator.py`

Same pattern. Change `id: str` → `id: uuid.UUID`. Also `listing_id: Optional[str]` →
`listing_id: Optional[uuid.UUID]` and `forked_from: Optional[str]` →
`forked_from: Optional[uuid.UUID]`. Add `none_to_list` validator for `output_schema`.

#### `backend/app/schemas/setting.py`

Same pattern. No special cases.

#### `backend/app/schemas/file.py`

Same pattern. Change `id: str` → `id: uuid.UUID`.

#### `backend/app/schemas/job.py`

Same pattern. Change `id: str` → `id: uuid.UUID`.

---

### Step 2: Update Backend Routes — Remove `_to_response()` Helpers

Once schemas have `from_attributes=True` + `alias_generator`, routes can return SQLAlchemy
objects directly. FastAPI + Pydantic handles serialization.

**Before:**
```python
@router.get("/listings", response_model=list[ListingResponse])
async def list_listings(...):
    result = await db.execute(select(Listing).where(...))
    listings = result.scalars().all()
    return [_to_response(l) for l in listings]  # manual dict builder
```

**After:**
```python
@router.get("/listings", response_model=list[ListingResponse])
async def list_listings(...):
    result = await db.execute(select(Listing).where(...))
    return result.scalars().all()  # Pydantic serializes directly
```

**Files with helpers to remove:**

| File | Helper to remove |
|------|-----------------|
| `backend/app/routes/listings.py` | `_to_response()` |
| `backend/app/routes/chat.py` | `_session_to_response()`, `_message_to_response()` |
| `backend/app/routes/prompts.py` | `_to_response()` |
| `backend/app/routes/schemas.py` | `_to_response()` |
| `backend/app/routes/tags.py` | `_to_response()` |
| `backend/app/routes/settings.py` | `_to_response()` |
| `backend/app/routes/evaluators.py` | `_to_response()` |
| `backend/app/routes/history.py` | `_to_response()` |
| `backend/app/routes/files.py` | Inline dict creation (2 places) |
| `backend/app/routes/jobs.py` | `_to_dict()` |

**What the helpers currently do that Pydantic now handles:**
- `str(model.id)` → Pydantic serializes `uuid.UUID` to string in JSON mode
- `.isoformat()` on datetime → Pydantic serializes datetime to ISO string
- `model.field or []` for nullable lists → `@field_validator(mode='before')` in schema

**Test each route after removing its helper.** Use curl to verify the response has camelCase
field names and correct values.

---

### Step 3: Simplify Frontend API Modules

Once backend outputs camelCase, strip all manual mapping from frontend API modules.

**Before (manual mapping):**
```typescript
async getAll(appId: string): Promise<Listing[]> {
    const data = await apiRequest<ApiListing[]>(`/api/listings?app_id=${appId}`);
    return data.map(d => ({
        id: d.id,
        appId: d.app_id,           // manual mapping
        sourceType: d.source_type, // manual mapping
        audioFile: d.audio_file,   // manual mapping
        // ... 14 more fields
    }));
}
```

**After (direct):**
```typescript
async getAll(appId: string): Promise<Listing[]> {
    return apiRequest<Listing[]>(`/api/listings?appId=${appId}`);
}
```

**Files to simplify:**

| File | What to remove |
|------|---------------|
| `src/services/api/listingsApi.ts` | `ApiListing` interface, `fromApi()`, `toApi()` functions. Return `apiRequest<Listing>()` directly. |
| `src/services/api/chatApi.ts` | All inline field mapping in every method. ~100 lines of mapping code. |
| `src/services/api/promptsApi.ts` | Inline mapping in `getAll()`, `getById()`, `save()`. |
| `src/services/api/schemasApi.ts` | Inline mapping in `getAll()`, `getById()`, `save()`. |
| `src/services/api/tagsApi.ts` | Inline mapping in `getAllTags()`, request bodies. |
| `src/services/api/historyApi.ts` | `mapApiEntry()` function, query param mapping. |
| `src/services/api/evaluatorsApi.ts` | Extensive mapping in 8+ methods. |
| `src/services/api/settingsApi.ts` | Minimal mapping (just `app_id`). |
| `src/services/api/filesApi.ts` | `FileRecord` interface (currently snake_case). |
| `src/services/api/jobsApi.ts` | `Job` interface (currently snake_case). |
| `src/services/api/evalRunsApi.ts` | Raw snake_case responses. |

**Also update query parameters** where frontend sends `app_id=` in URLs. With the backend
accepting camelCase via `populate_by_name`, you can send `appId=` instead. But `app_id=` also
still works, so this is optional.

---

### Step 4: Update Frontend Types

Some frontend types need adjustment to match the new camelCase API output.

| Type | File | Change needed |
|------|------|--------------|
| `KairaChatMessage.timestamp` | `src/types/chat.types.ts` | Rename to `createdAt` (backend outputs `createdAt`) |
| `HistoryEntry.*` | `src/types/history.types.ts` | All fields are snake_case — convert to camelCase |
| Schema `schema` field | `src/types/` | Rename to `schemaData` if using Option A from Step 1 |
| `Job` interface | `src/services/api/jobsApi.ts` | Convert all fields to camelCase |
| `FileRecord` interface | `src/services/api/filesApi.ts` | Convert to camelCase or create proper type |

After renaming `KairaChatMessage.timestamp` → `createdAt`, update all consumers:
- `src/features/kaira/components/TraceMessageRow.tsx` (uses `message.timestamp`)
- Any other component that reads `message.timestamp`

---

## Execution Order

Do NOT do everything at once. Go entity by entity, full-stack for each:

### Round 1: Listings (most broken, fix first)
1. Create `backend/app/schemas/base.py` with `CamelModel` and `CamelORMModel`
2. Update `backend/app/schemas/listing.py` — inherit from base classes, add validators
3. Update `backend/app/routes/listings.py` — remove `_to_response()`, return models directly
4. Test: `curl "http://localhost:8721/api/listings?app_id=voice-rx"` — verify camelCase output
5. Simplify `src/services/api/listingsApi.ts` — strip `fromApi()`/`toApi()`
6. Test in browser: upload audio, verify listing page works

### Round 2: Chat
1. Update `backend/app/schemas/chat.py` — add `Field(alias="metadata")` for metadata_
2. Update `backend/app/routes/chat.py` — remove both helpers
3. Test: `curl "http://localhost:8721/api/chat/sessions?app_id=kaira-bot"` — verify camelCase
4. Simplify `src/services/api/chatApi.ts`
5. Rename `KairaChatMessage.timestamp` → `createdAt`, update consumers
6. Test in browser: Kaira chat, trace view

### Round 3: Evaluators
1. Update schema, route, frontend API module
2. Test evaluator CRUD

### Round 4: Prompts + Schemas
1. Update both schemas, routes, frontend modules
2. Handle `schema_data` → `schemaData` rename

### Round 5: Tags + Settings + History
1. Update schemas, routes, frontend modules
2. Handle history snake_case type conversion

### Round 6: Files + Jobs + EvalRuns
1. Update schemas, routes, frontend modules
2. These are less critical (internal APIs)

### Final: Cleanup
1. `npx tsc --noEmit` — zero errors
2. Test every feature in browser
3. Delete any leftover mapping utilities
4. Commit

---

## Quick Verification Commands

After each round, verify camelCase output:

```bash
# Listings
curl -s "http://localhost:8721/api/listings?app_id=voice-rx" | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d[0].keys()) if d else 'empty')"

# Chat sessions
curl -s "http://localhost:8721/api/chat/sessions?app_id=kaira-bot" | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d[0].keys()) if d else 'empty')"

# Evaluators
curl -s "http://localhost:8721/api/evaluators?app_id=voice-rx" | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d[0].keys()) if d else 'empty')"
```

Expected: `['id', 'appId', 'title', 'status', 'sourceType', 'audioFile', ...]`
NOT: `['id', 'app_id', 'title', 'status', 'source_type', 'audio_file', ...]`
