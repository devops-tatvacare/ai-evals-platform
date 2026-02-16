# Phase 1: Backend Foundation

**Branch:** `feat/phase-1-backend`
**Goal:** A fully working FastAPI server with PostgreSQL, all CRUD routes, file handling.
**Outcome:** You can `docker compose up`, then hit every API endpoint with curl.

---

## Step 1.1: Create branch and Docker Compose

**Files to create:** `docker-compose.yml`, `.env.backend`
**Files to edit:** `.gitignore`

### Instructions

1. Create the branch:
```bash
git checkout main
git checkout -b feat/phase-1-backend
```

2. Create `docker-compose.yml` at project root:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: evals-postgres
    environment:
      POSTGRES_USER: evals_user
      POSTGRES_PASSWORD: evals_pass
      POSTGRES_DB: ai_evals_platform
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evals_user -d ai_evals_platform"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

> NOTE: We are NOT containerizing the FastAPI server yet. During development, run it natively with uvicorn. The Dockerfile comes in Step 1.15.

3. Create `.env.backend` at project root:

```env
DATABASE_URL=postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform
FILE_STORAGE_TYPE=local
FILE_STORAGE_PATH=./backend/uploads
API_PORT=8721
CORS_ORIGINS=http://localhost:5173
```

4. Add to `.gitignore`:
```
# Backend
.env.backend
backend/uploads/
backend/__pycache__/
backend/app/__pycache__/
**/__pycache__/
*.pyc
```

### Test
```bash
docker compose up -d
docker compose ps  # postgres should be "healthy"
psql postgresql://evals_user:evals_pass@localhost:5432/ai_evals_platform -c "SELECT 1"
```

### Commit
```bash
git add docker-compose.yml .env.backend .gitignore
git commit -m "phase 1.1: docker compose with PostgreSQL"
```

---

## Step 1.2: Backend directory structure and dependencies

**Files to create:** `backend/` directory tree, `backend/requirements.txt`, `backend/app/__init__.py`

### Instructions

1. Create directory structure:
```bash
mkdir -p backend/app/{models,schemas,routes,services}
mkdir -p backend/uploads
touch backend/app/__init__.py
touch backend/app/models/__init__.py
touch backend/app/schemas/__init__.py
touch backend/app/routes/__init__.py
touch backend/app/services/__init__.py
```

2. Create `backend/requirements.txt`:

```txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy[asyncio]==2.0.35
asyncpg==0.30.0
pydantic==2.9.0
pydantic-settings==2.5.0
python-multipart==0.0.12
python-dotenv==1.0.1
aiofiles==24.1.0
```

3. Set up Python environment:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> NOTE: Add `backend/.venv/` to `.gitignore` if not already covered by a global pattern.

### Test
```bash
cd backend
source .venv/bin/activate
python -c "import fastapi, sqlalchemy, asyncpg; print('All imports OK')"
```

### Commit
```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/models/__init__.py backend/app/schemas/__init__.py backend/app/routes/__init__.py backend/app/services/__init__.py
git commit -m "phase 1.2: backend directory structure and dependencies"
```

---

## Step 1.3: Database connection and config

**Files to create:** `backend/app/config.py`, `backend/app/database.py`

### Instructions

1. Create `backend/app/config.py`:

```python
"""Application configuration from environment variables."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """All config comes from env vars or .env.backend file."""

    DATABASE_URL: str = "postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform"
    FILE_STORAGE_TYPE: str = "local"  # "local" or "azure_blob"
    FILE_STORAGE_PATH: str = "./backend/uploads"
    API_PORT: int = 8721
    CORS_ORIGINS: str = "http://localhost:5173"

    # Azure Blob (production only)
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_CONTAINER: str = "evals-files"

    class Config:
        env_file = ".env.backend"
        env_file_encoding = "utf-8"


settings = Settings()
```

2. Create `backend/app/database.py`:

```python
"""Async SQLAlchemy engine and session factory.

Usage in routes:
    from app.database import get_db

    @router.get("/items")
    async def list_items(db: AsyncSession = Depends(get_db)):
        result = await db.execute(select(Item))
        return result.scalars().all()
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    """FastAPI dependency that yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
```

### Test
```bash
cd backend
source .venv/bin/activate
python -c "from app.config import settings; print(settings.DATABASE_URL)"
python -c "from app.database import engine; print('Engine created:', engine.url)"
```

### Commit
```bash
git add backend/app/config.py backend/app/database.py
git commit -m "phase 1.3: database connection and config"
```

---

## Step 1.4: SQLAlchemy base model and mixins

**Files to create:** `backend/app/models/base.py`

### Instructions

Create `backend/app/models/base.py`:

```python
"""SQLAlchemy declarative base and shared mixins."""
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


class TimestampMixin:
    """Adds created_at and updated_at columns."""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserMixin:
    """Adds user_id column for future auth. Default 'default' until auth is added."""
    user_id: Mapped[str] = mapped_column(String(100), default="default")
```

### Commit
```bash
git add backend/app/models/base.py
git commit -m "phase 1.4: SQLAlchemy base model and mixins"
```

---

## Step 1.5: All SQLAlchemy models

**Files to create:** All model files in `backend/app/models/`

> IMPORTANT: Create ALL model files in this step. They are all independent and define the DB schema. The complete SQL schema is in `OVERVIEW.md` - these models are the Python equivalent.

### Instructions

Create each file below. Every model follows the same pattern:
- Inherit from `Base`
- Use `TimestampMixin` and `UserMixin` where applicable
- JSONB columns use `JSON` type from SQLAlchemy
- UUIDs use `Uuid` type with `gen_random_uuid()` default

**File: `backend/app/models/listing.py`**
```python
"""Listing model - evaluation records."""
import uuid
from sqlalchemy import String, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Listing(Base, TimestampMixin, UserMixin):
    __tablename__ = "listings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    source_type: Mapped[str] = mapped_column(String(20), default="upload")
    audio_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    transcript_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_json_file: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    transcript: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    api_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_output_references: Mapped[list] = mapped_column(JSON, default=list)
    structured_outputs: Mapped[list] = mapped_column(JSON, default=list)
    ai_eval: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    human_eval: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    evaluator_runs: Mapped[list] = mapped_column(JSON, default=list)

    __table_args__ = (
        Index("idx_listings_updated_at", "updated_at", postgresql_using="btree"),
    )
```

**File: `backend/app/models/file_record.py`**
```python
"""FileRecord model - file metadata (actual bytes on filesystem/blob storage)."""
import uuid
from sqlalchemy import String, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class FileRecord(Base, TimestampMixin, UserMixin):
    __tablename__ = "files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
```

> NOTE: `TimestampMixin` adds created_at/updated_at. `UserMixin` adds user_id. FileRecord only really needs created_at but including both via mixin is fine.

**File: `backend/app/models/prompt.py`**
```python
"""Prompt model - versioned LLM prompt templates."""
from sqlalchemy import String, Text, Integer, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Prompt(Base, TimestampMixin, UserMixin):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    source_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    __table_args__ = (
        UniqueConstraint("app_id", "prompt_type", "version", "user_id", name="uq_prompt_version"),
    )
```

**File: `backend/app/models/schema.py`**
```python
"""Schema model - versioned JSON schemas for structured LLM output."""
from sqlalchemy import String, Text, Integer, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Schema(Base, TimestampMixin, UserMixin):
    __tablename__ = "schemas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt_type: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    schema_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint("app_id", "prompt_type", "version", "user_id", name="uq_schema_version"),
    )
```

**File: `backend/app/models/evaluator.py`**
```python
"""Evaluator model - custom evaluator definitions."""
import uuid
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UserMixin


class Evaluator(Base, TimestampMixin, UserMixin):
    __tablename__ = "evaluators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    output_schema: Mapped[list] = mapped_column(JSON, default=list)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_header: Mapped[bool] = mapped_column(Boolean, default=False)
    forked_from: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evaluators.id", ondelete="SET NULL"), nullable=True
    )
```

**File: `backend/app/models/chat.py`**
```python
"""Chat models - sessions and messages."""
import uuid
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, UserMixin


class ChatSession(Base, TimestampMixin, UserMixin):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    external_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    server_session_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_response_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(500), default="New Chat")
    status: Mapped[str] = mapped_column(String(20), default="active")
    is_first_message: Mapped[bool] = mapped_column(Boolean, default=True)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base, UserMixin):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(
        String, server_default="now()"
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
```

> NOTE: `metadata` is a reserved name in SQLAlchemy. The column uses `metadata_` in Python but maps to `"metadata"` in SQL via `mapped_column("metadata", ...)`.

**File: `backend/app/models/history.py`**
```python
"""History model - audit log for evaluator runs and events."""
import uuid
from sqlalchemy import String, Float, BigInteger, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class History(Base, UserMixin):
    __tablename__ = "history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String(20), default="manual")
    schema_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (
        Index("idx_history_timestamp", "timestamp"),
        Index("idx_history_entity", "entity_type", "entity_id", "timestamp"),
        Index("idx_history_source", "source_type", "source_id", "timestamp"),
        Index("idx_history_app_source", "app_id", "source_type", "timestamp"),
        Index("idx_history_entity_source", "entity_id", "source_type", "source_id", "timestamp"),
    )
```

**File: `backend/app/models/setting.py`**
```python
"""Setting model - user/app configuration."""
from sqlalchemy import String, JSON, UniqueConstraint, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from app.models.base import Base, UserMixin


class Setting(Base, UserMixin):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("app_id", "key", "user_id", name="uq_setting"),
    )
```

**File: `backend/app/models/tag.py`**
```python
"""Tag model - tag registry for autocomplete."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class Tag(Base, UserMixin):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0)
    last_used: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("app_id", "name", "user_id", name="uq_tag"),
    )
```

**File: `backend/app/models/job.py`**
```python
"""Job model - background job queue for batch evaluations."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, JSON, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class Job(Base, UserMixin):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    progress: Mapped[dict] = mapped_column(JSON, default=lambda: {"current": 0, "total": 0, "message": ""})
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default="now()")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

**File: `backend/app/models/eval_run.py`**
```python
"""Eval run models - from kaira-evals merge (Phase 3 will populate routes)."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, JSON, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, UserMixin


class EvalRun(Base, UserMixin):
    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    command: Mapped[str] = mapped_column(String(50), nullable=False)
    llm_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    eval_temperature: Mapped[float] = mapped_column(Float, default=0.0)
    data_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    data_file_hash: Mapped[str | None] = mapped_column(String(50), nullable=True)
    flags: Mapped[dict] = mapped_column(JSON, default=dict)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="running")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ThreadEvaluation(Base):
    __tablename__ = "thread_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    thread_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    data_file_hash: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    intent_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    worst_correctness: Mapped[str | None] = mapped_column(String(20), nullable=True)
    efficiency_verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    success_status: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdversarialEvaluation(Base):
    __tablename__ = "adversarial_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    goal_achieved: Mapped[bool] = mapped_column(Boolean, default=False)
    total_turns: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiLog(Base):
    __tablename__ = "api_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    method: Mapped[str] = mapped_column(String(50), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

Now update `backend/app/models/__init__.py` to import all models:

```python
"""Import all models so SQLAlchemy metadata knows about them."""
from app.models.base import Base
from app.models.listing import Listing
from app.models.file_record import FileRecord
from app.models.prompt import Prompt
from app.models.schema import Schema
from app.models.evaluator import Evaluator
from app.models.chat import ChatSession, ChatMessage
from app.models.history import History
from app.models.setting import Setting
from app.models.tag import Tag
from app.models.job import Job
from app.models.eval_run import EvalRun, ThreadEvaluation, AdversarialEvaluation, ApiLog

__all__ = [
    "Base",
    "Listing", "FileRecord", "Prompt", "Schema", "Evaluator",
    "ChatSession", "ChatMessage", "History", "Setting", "Tag",
    "Job", "EvalRun", "ThreadEvaluation", "AdversarialEvaluation", "ApiLog",
]
```

### Test
```bash
cd backend && source .venv/bin/activate
python -c "from app.models import Base; print(f'Tables: {list(Base.metadata.tables.keys())}')"
```

Expected output should list all 14 tables.

### Commit
```bash
git add backend/app/models/
git commit -m "phase 1.5: all SQLAlchemy models (14 tables)"
```

---

## Step 1.6: FastAPI main.py with table creation and health check

**Files to create:** `backend/app/main.py`

### Instructions

Create `backend/app/main.py`:

```python
"""FastAPI application entry point."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine, get_db
from app.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup. In production, use Alembic migrations instead."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="AI Evals Platform API",
    version="1.0.0",
    description="Backend API for AI evaluation pipelines.",
    lifespan=lifespan,
)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Verify API and database connectivity."""
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}
```

### Test

Make sure PostgreSQL is running, then:

```bash
docker compose up -d  # ensure postgres is running
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8721 --reload
```

In another terminal:
```bash
curl http://localhost:8721/api/health
# Expected: {"status":"ok","database":"connected"}

# Verify tables were created:
psql postgresql://evals_user:evals_pass@localhost:5432/ai_evals_platform -c "\dt"
# Should list all 14 tables
```

### Commit
```bash
git add backend/app/main.py
git commit -m "phase 1.6: FastAPI app with health check and auto table creation"
```

---

## Step 1.7: Pydantic schemas (request/response models)

**Files to create:** All files in `backend/app/schemas/`

> These define what the API accepts and returns. They are NOT the same as SQLAlchemy models. Pydantic validates input, SQLAlchemy talks to the DB.

### Instructions

**File: `backend/app/schemas/common.py`**
```python
"""Shared Pydantic schemas."""
from pydantic import BaseModel
from typing import Optional


class PaginationParams(BaseModel):
    limit: int = 50
    offset: int = 0


class DeleteResponse(BaseModel):
    deleted: bool = True
    id: str = ""
```

**File: `backend/app/schemas/listing.py`**
```python
"""Listing request/response schemas."""
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class ListingCreate(BaseModel):
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


class ListingUpdate(BaseModel):
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


class ListingResponse(BaseModel):
    id: str
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

    model_config = {"from_attributes": True}
```

> PATTERN FOR ALL OTHER SCHEMAS: Follow the same Create/Update/Response pattern.
> - `Create` = fields required to create (no id, no timestamps)
> - `Update` = all fields Optional (partial update)
> - `Response` = all fields including id and timestamps, with `model_config = {"from_attributes": True}`

**Repeat this pattern for each resource.** Create these files following the pattern above:

- `backend/app/schemas/prompt.py` - fields: app_id, prompt_type, version, name, prompt, description, is_default, source_type
- `backend/app/schemas/schema.py` - fields: app_id, prompt_type, version, name, schema_data, description, is_default
- `backend/app/schemas/evaluator.py` - fields: app_id, listing_id, name, prompt, model_id, output_schema, is_global, show_in_header, forked_from
- `backend/app/schemas/chat.py` - TWO sets: SessionCreate/Response + MessageCreate/Response
- `backend/app/schemas/history.py` - fields: app_id, entity_type, entity_id, source_type, source_id, status, duration_ms, data, triggered_by, schema_version, user_context, timestamp
- `backend/app/schemas/setting.py` - fields: app_id, key, value
- `backend/app/schemas/tag.py` - fields: app_id, name, count, last_used
- `backend/app/schemas/file.py` - Response only: id, original_name, mime_type, size_bytes, storage_path, created_at
- `backend/app/schemas/job.py` - fields: job_type, params, status, progress, result, error_message

Update `backend/app/schemas/__init__.py`:
```python
"""Pydantic schemas for request/response validation."""
```

### Commit
```bash
git add backend/app/schemas/
git commit -m "phase 1.7: all Pydantic request/response schemas"
```

---

## Step 1.8: File storage service

**Files to create:** `backend/app/services/file_storage.py`

### Instructions

```python
"""File storage abstraction. Local filesystem for dev, Azure Blob for production."""
import os
import uuid
import aiofiles
from pathlib import Path
from app.config import settings


class FileStorageService:
    """Handles file read/write to local disk or Azure Blob Storage."""

    def __init__(self):
        if settings.FILE_STORAGE_TYPE == "local":
            self.base_path = Path(settings.FILE_STORAGE_PATH)
            self.base_path.mkdir(parents=True, exist_ok=True)

    async def save(self, file_bytes: bytes, original_name: str) -> str:
        """Save file bytes. Returns the storage path (relative for local, URL for blob)."""
        file_id = str(uuid.uuid4())
        ext = Path(original_name).suffix
        filename = f"{file_id}{ext}"

        if settings.FILE_STORAGE_TYPE == "local":
            file_path = self.base_path / filename
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(file_bytes)
            return str(file_path)

        elif settings.FILE_STORAGE_TYPE == "azure_blob":
            # Phase 3 / production: implement Azure Blob upload
            # from azure.storage.blob.aio import BlobServiceClient
            # client = BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONNECTION_STRING)
            # container = client.get_container_client(settings.AZURE_STORAGE_CONTAINER)
            # await container.upload_blob(filename, file_bytes)
            # return f"https://{...}/{filename}"
            raise NotImplementedError("Azure Blob storage not yet implemented")

        raise ValueError(f"Unknown storage type: {settings.FILE_STORAGE_TYPE}")

    async def read(self, storage_path: str) -> bytes:
        """Read file bytes from storage path."""
        if settings.FILE_STORAGE_TYPE == "local":
            async with aiofiles.open(storage_path, "rb") as f:
                return await f.read()
        raise NotImplementedError(f"Read not implemented for {settings.FILE_STORAGE_TYPE}")

    async def delete(self, storage_path: str) -> None:
        """Delete file from storage."""
        if settings.FILE_STORAGE_TYPE == "local":
            path = Path(storage_path)
            if path.exists():
                os.remove(path)
            return
        raise NotImplementedError(f"Delete not implemented for {settings.FILE_STORAGE_TYPE}")


file_storage = FileStorageService()
```

### Commit
```bash
git add backend/app/services/file_storage.py
git commit -m "phase 1.8: file storage service (local filesystem)"
```

---

## Step 1.9: Routes - Listings (COMPLETE EXAMPLE)

**Files to create:** `backend/app/routes/listings.py`

> This is the COMPLETE, fully-coded example route. ALL other routes follow this exact same pattern. Study this carefully.

### Instructions

```python
"""Listings API routes."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.listing import Listing
from app.models.file_record import FileRecord
from app.models.history import History
from app.schemas.listing import ListingCreate, ListingUpdate, ListingResponse

router = APIRouter(prefix="/api/listings", tags=["listings"])


@router.get("", response_model=list[ListingResponse])
async def list_listings(
    app_id: str = Query(..., description="App ID filter (required)"),
    db: AsyncSession = Depends(get_db),
):
    """List all listings for an app, sorted by updated_at DESC."""
    result = await db.execute(
        select(Listing)
        .where(Listing.app_id == app_id)
        .order_by(desc(Listing.updated_at))
    )
    listings = result.scalars().all()
    return [_to_response(l) for l in listings]


@router.get("/search", response_model=list[ListingResponse])
async def search_listings(
    app_id: str = Query(...),
    q: str = Query("", description="Search query for title"),
    db: AsyncSession = Depends(get_db),
):
    """Search listings by title."""
    result = await db.execute(
        select(Listing)
        .where(Listing.app_id == app_id)
        .where(Listing.title.ilike(f"%{q}%"))
        .order_by(desc(Listing.updated_at))
    )
    return [_to_response(l) for l in result.scalars().all()]


@router.get("/{listing_id}", response_model=ListingResponse)
async def get_listing(
    listing_id: UUID,
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Get a single listing by ID."""
    result = await db.execute(
        select(Listing).where(Listing.id == listing_id, Listing.app_id == app_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    return _to_response(listing)


@router.post("", response_model=ListingResponse, status_code=201)
async def create_listing(
    body: ListingCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new listing."""
    listing = Listing(**body.model_dump())
    db.add(listing)
    await db.commit()
    await db.refresh(listing)
    return _to_response(listing)


@router.put("/{listing_id}", response_model=ListingResponse)
async def update_listing(
    listing_id: UUID,
    body: ListingUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a listing. Only provided fields are updated."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(listing, key, value)

    await db.commit()
    await db.refresh(listing)
    return _to_response(listing)


@router.delete("/{listing_id}")
async def delete_listing(
    listing_id: UUID,
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Delete a listing and cascade delete associated files and history."""
    result = await db.execute(
        select(Listing).where(Listing.id == listing_id, Listing.app_id == app_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    # Cascade: delete associated file records
    # (The file_storage.delete() for actual bytes would be called here too,
    #  but we need to read audio_file.id etc. from the JSONB first)
    if listing.audio_file and listing.audio_file.get("id"):
        file_result = await db.execute(
            select(FileRecord).where(FileRecord.id == UUID(listing.audio_file["id"]))
        )
        file_rec = file_result.scalar_one_or_none()
        if file_rec:
            from app.services.file_storage import file_storage
            await file_storage.delete(file_rec.storage_path)
            await db.delete(file_rec)

    # Cascade: delete history entries
    await db.execute(
        select(History).where(History.entity_id == str(listing_id))
    )
    # Use delete statement instead of select for bulk delete
    from sqlalchemy import delete as sql_delete
    await db.execute(
        sql_delete(History).where(History.entity_id == str(listing_id))
    )

    await db.delete(listing)
    await db.commit()
    return {"deleted": True, "id": str(listing_id)}


def _to_response(listing: Listing) -> dict:
    """Convert SQLAlchemy model to response dict."""
    return {
        "id": str(listing.id),
        "app_id": listing.app_id,
        "title": listing.title,
        "status": listing.status,
        "source_type": listing.source_type,
        "audio_file": listing.audio_file,
        "transcript_file": listing.transcript_file,
        "structured_json_file": listing.structured_json_file,
        "transcript": listing.transcript,
        "api_response": listing.api_response,
        "structured_output_references": listing.structured_output_references or [],
        "structured_outputs": listing.structured_outputs or [],
        "ai_eval": listing.ai_eval,
        "human_eval": listing.human_eval,
        "evaluator_runs": listing.evaluator_runs or [],
        "created_at": listing.created_at,
        "updated_at": listing.updated_at,
        "user_id": listing.user_id,
    }
```

Then register the router in `backend/app/main.py`. Add AFTER the health check:

```python
from app.routes.listings import router as listings_router
app.include_router(listings_router)
```

### Test
```bash
# Start the server
cd backend && source .venv/bin/activate
uvicorn app.main:app --port 8721 --reload

# Test in another terminal:
# Create
curl -X POST http://localhost:8721/api/listings \
  -H "Content-Type: application/json" \
  -d '{"app_id": "voice-rx", "title": "Test Listing", "status": "draft"}'

# List
curl "http://localhost:8721/api/listings?app_id=voice-rx"

# The returned ID can be used for GET/PUT/DELETE
```

### Commit
```bash
git add backend/app/routes/listings.py backend/app/main.py
git commit -m "phase 1.9: listings CRUD routes (complete example)"
```

---

## Steps 1.10 - 1.16: Remaining Routes

> PATTERN: Every route file follows the EXACT same structure as listings.py above. Create each one following that pattern. Register each router in main.py.

### Step 1.10: Files routes
**File:** `backend/app/routes/files.py`
**Key difference:** Uses `UploadFile` from FastAPI for multipart upload. Download endpoint returns `FileResponse` or `StreamingResponse`.

```python
# Key imports for file routes:
from fastapi import UploadFile, File as FastAPIFile
from fastapi.responses import FileResponse
from app.services.file_storage import file_storage

@router.post("/api/files/upload")
async def upload_file(file: UploadFile, db: AsyncSession = Depends(get_db)):
    contents = await file.read()
    storage_path = await file_storage.save(contents, file.filename)
    record = FileRecord(
        original_name=file.filename,
        mime_type=file.content_type,
        size_bytes=len(contents),
        storage_path=storage_path,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return {"id": str(record.id), "original_name": record.original_name, ...}

@router.get("/api/files/{file_id}/download")
async def download_file(file_id: UUID, db: AsyncSession = Depends(get_db)):
    # Look up FileRecord, return FileResponse(record.storage_path)
    ...
```

### Step 1.11: Prompts routes
**File:** `backend/app/routes/prompts.py`
**Key logic:** Version auto-increment on create. `ensure-defaults` endpoint seeds defaults. Block deletion of is_default=True prompts.

```python
# Version auto-increment pattern:
@router.post("/api/prompts")
async def create_prompt(body: PromptCreate, db: AsyncSession = Depends(get_db)):
    # Get current max version for this app_id + prompt_type
    result = await db.execute(
        select(func.max(Prompt.version))
        .where(Prompt.app_id == body.app_id, Prompt.prompt_type == body.prompt_type)
    )
    max_version = result.scalar() or 0
    prompt = Prompt(**body.model_dump(), version=max_version + 1)
    ...
```

### Step 1.12: Schemas routes
**File:** `backend/app/routes/schemas.py`
**Identical pattern to prompts.** Version auto-increment, ensure-defaults, block default deletion.

### Step 1.13: Evaluators routes
**File:** `backend/app/routes/evaluators.py`
**Key logic:** Strict listing scoping on GET (filter by listing_id). Fork endpoint creates a copy with new UUID. Global toggle endpoint.

```python
# Fork pattern:
@router.post("/api/evaluators/{evaluator_id}/fork")
async def fork_evaluator(evaluator_id: UUID, listing_id: UUID = Query(...), db = Depends(get_db)):
    source = await db.get(Evaluator, evaluator_id)
    if not source:
        raise HTTPException(404)
    forked = Evaluator(
        app_id=source.app_id,
        listing_id=listing_id,
        name=source.name,
        prompt=source.prompt,
        model_id=source.model_id,
        output_schema=source.output_schema,
        is_global=False,
        forked_from=source.id,
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return {...}
```

### Step 1.14: Chat routes
**File:** `backend/app/routes/chat.py`
**Key logic:** Session deletion cascades to messages (DB handles via ON DELETE CASCADE). Tag management on messages (update metadata JSONB).

### Step 1.15: History routes
**File:** `backend/app/routes/history.py`
**Key logic:** Complex queries with multiple optional filters. Uses compound indexes. Supports pagination.

```python
@router.get("/api/history")
async def query_history(
    app_id: str = Query(None),
    entity_type: str = Query(None),
    entity_id: str = Query(None),
    source_type: str = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    query = select(History).order_by(desc(History.timestamp))
    if app_id:
        query = query.where(History.app_id == app_id)
    if entity_type:
        query = query.where(History.entity_type == entity_type)
    if entity_id:
        query = query.where(History.entity_id == entity_id)
    if source_type:
        query = query.where(History.source_type == source_type)
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    return [_to_dict(h) for h in result.scalars().all()]
```

### Step 1.16: Settings + Tags routes
**Files:** `backend/app/routes/settings.py`, `backend/app/routes/tags.py`
**Settings key logic:** Upsert pattern using `INSERT ... ON CONFLICT UPDATE`.
**Tags key logic:** Increment/decrement count, rename across all chat messages.

```python
# Settings upsert pattern:
from sqlalchemy.dialects.postgresql import insert as pg_insert

@router.put("/api/settings")
async def upsert_setting(body: SettingUpsert, db = Depends(get_db)):
    stmt = pg_insert(Setting).values(
        app_id=body.app_id, key=body.key, value=body.value, user_id="default"
    ).on_conflict_do_update(
        constraint="uq_setting",
        set_={"value": body.value, "updated_at": func.now()}
    )
    await db.execute(stmt)
    await db.commit()
    return {"updated": True}
```

### After each route file:
1. Register the router in `main.py`: `app.include_router(xxx_router)`
2. Test with curl
3. Commit

### Step 1.17: Register ALL routes in main.py

Update `backend/app/main.py` to include all routers:

```python
from app.routes.listings import router as listings_router
from app.routes.files import router as files_router
from app.routes.prompts import router as prompts_router
from app.routes.schemas import router as schemas_router
from app.routes.evaluators import router as evaluators_router
from app.routes.chat import router as chat_router
from app.routes.history import router as history_router
from app.routes.settings import router as settings_router
from app.routes.tags import router as tags_router

app.include_router(listings_router)
app.include_router(files_router)
app.include_router(prompts_router)
app.include_router(schemas_router)
app.include_router(evaluators_router)
app.include_router(chat_router)
app.include_router(history_router)
app.include_router(settings_router)
app.include_router(tags_router)
```

### Final Phase 1 Test

```bash
# Start everything
docker compose up -d
cd backend && source .venv/bin/activate
uvicorn app.main:app --port 8721 --reload

# Hit every endpoint group:
curl http://localhost:8721/api/health
curl "http://localhost:8721/api/listings?app_id=voice-rx"
curl http://localhost:8721/api/prompts?app_id=voice-rx
curl http://localhost:8721/api/schemas?app_id=voice-rx
curl http://localhost:8721/api/evaluators?app_id=voice-rx
curl http://localhost:8721/api/chat/sessions?app_id=kaira-bot
curl http://localhost:8721/api/history?app_id=voice-rx
curl "http://localhost:8721/api/settings?app_id=voice-rx&key=test"
curl http://localhost:8721/api/tags?app_id=voice-rx

# Check OpenAPI docs:
# Open http://localhost:8721/docs in browser - should show all endpoints
```

### Phase 1 Final Commit
```bash
git add backend/
git commit -m "phase 1: complete backend - FastAPI + PostgreSQL + all CRUD routes"
```

### Merge to main
```bash
git checkout main
git merge feat/phase-1-backend
```
