# Evaluation Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace standalone Prompts + Schemas libraries with paired Evaluation Templates, and surface them in the custom evaluator wizard via a "pick from library or write your own" toggle.

**Architecture:** New `eval_templates` table merges both tables. Evaluator model gets optional `template_id` FK for version-pinned references. Settings UI collapses to single Templates tab. Wizard adds source toggle with template picker and dirty detection. Voice-RX runner updates import paths only; custom evaluator runner adds template loading branch.

**Tech Stack:** SQLAlchemy (backend models), FastAPI (routes), Pydantic v2 (schemas), Zustand (frontend stores), React + Tailwind (components), existing design system primitives.

**Spec:** `docs/superpowers/specs/2026-04-07-eval-templates-design.md`
**Mocks:** `.superpowers/brainstorm/36994-1775584474/content/01-05`

---

## File Structure

### Backend — New Files
- `backend/app/models/eval_template.py` — ORM model
- `backend/app/schemas/eval_template.py` — Pydantic request/response schemas
- `backend/app/routes/eval_templates.py` — CRUD + version + fork routes
- `backend/app/services/migration/migrate_templates.py` — data migration script

### Backend — Modified Files
- `backend/app/models/__init__.py` — add EvalTemplate import, remove Prompt/Schema
- `backend/app/models/evaluator.py` — add template_id, template_branch_key columns
- `backend/app/schemas/evaluator.py` — add template fields to Create/Update/Response
- `backend/app/main.py` — register new router, remove old routers
- `backend/app/services/evaluators/custom_evaluator_runner.py` — template loading branch
- `backend/app/services/evaluators/voice_rx_runner.py` — update model imports (Prompt→EvalTemplate, Schema→EvalTemplate)
- `backend/app/services/seed_defaults.py` — seed eval_templates instead of prompts+schemas

### Backend — Deleted Files (after migration)
- `backend/app/models/prompt.py`
- `backend/app/models/schema.py`
- `backend/app/schemas/prompt.py`
- `backend/app/schemas/schema.py`
- `backend/app/routes/prompts.py`
- `backend/app/routes/schemas.py`

### Frontend — New Files
- `src/types/evalTemplate.types.ts` — TypeScript interfaces
- `src/services/api/evalTemplatesApi.ts` — API repository
- `src/stores/evalTemplatesStore.ts` — Zustand store
- `src/features/settings/components/TemplatesTab.tsx` — Settings tab (replaces PromptsTab + SchemasTab)
- `src/features/settings/components/TemplatePeekOverlay.tsx` — Right-side peek panel
- `src/features/settings/components/TemplateCreateOverlay.tsx` — New template creation
- `src/features/evals/components/SourceModeToggle.tsx` — "Use Template / Write Custom" toggle
- `src/features/evals/components/TemplatePicker.tsx` — SearchableSelect-based template dropdown + pair summary
- `src/features/evals/components/TemplateUpgradeModal.tsx` — Version upgrade review with diff
- `src/features/evals/components/PromptDiff.tsx` — Side-by-side prompt diff display
- `src/features/evals/components/SchemaDiff.tsx` — Field-level schema diff table

### Frontend — Modified Files
- `src/types/index.ts` — export evalTemplate types, remove prompt/schema types
- `src/types/evaluator.types.ts` — add templateId, templateBranchKey to EvaluatorDefinition
- `src/stores/evaluatorsStore.ts` — minor: no structural changes needed (template_id flows through save)
- `src/stores/llmSettingsStore.ts` — remove activePromptIds, activeSchemaIds
- `src/services/api/evaluatorsApi.ts` — add templateId, templateBranchKey to ApiEvaluator and mapping
- `src/features/evals/components/CreateEvaluatorWizard.tsx` — add source toggle, template picker, dirty detection
- `src/features/evals/components/EvaluatorsTable.tsx` — add Source column with template badge + upgrade badge
- `src/features/settings/pages/SettingsPage.tsx` (or equivalent) — swap tab references

### Frontend — Deleted Files
- `src/types/prompt.types.ts`
- `src/types/schema.types.ts`
- `src/stores/promptsStore.ts`
- `src/stores/schemasStore.ts`
- `src/services/api/promptsApi.ts`
- `src/services/api/schemasApi.ts`
- `src/services/prompts/resolvePromptText.ts`
- `src/features/settings/components/PromptsTab.tsx`
- `src/features/settings/components/SchemasTab.tsx`
- `src/features/settings/components/PromptCreateOverlay.tsx`
- `src/features/settings/components/SchemaCreateOverlay.tsx`

---

## Task 1: Backend — EvalTemplate Model

**Files:**
- Create: `backend/app/models/eval_template.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create the EvalTemplate ORM model**

Create `backend/app/models/eval_template.py`. Base it on the existing `Prompt` model pattern (`backend/app/models/prompt.py`), merging in the schema fields:

```python
"""Evaluation template — versioned prompt + schema pair."""

import uuid

from sqlalchemy import Boolean, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import ShareableMixin, TenantUserMixin, TimestampMixin


class EvalTemplate(Base, TimestampMixin, TenantUserMixin, ShareableMixin):
    __tablename__ = "eval_templates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(50), nullable=False)
    template_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    branch_key: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    schema_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    schema_format: Mapped[str] = mapped_column(String(20), nullable=False, default="output_fields")
    variables_used: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    change_summary: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    forked_from: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "app_id", "template_type", "source_type",
            "branch_key", "version",
            name="uq_eval_template_version",
        ),
        Index("ix_eval_template_tenant", "tenant_id"),
        Index("ix_eval_template_tenant_user", "tenant_id", "user_id"),
        Index("ix_eval_template_tenant_app", "tenant_id", "app_id"),
        Index("ix_eval_template_branch", "tenant_id", "branch_key"),
    )
```

- [ ] **Step 2: Register model in `__init__.py`**

In `backend/app/models/__init__.py`, add the import (keep Prompt and Schema imports for now — they're needed until migration completes):

```python
from app.models.eval_template import EvalTemplate
```

Add `"EvalTemplate"` to the `__all__` list.

- [ ] **Step 3: Verify model loads**

Run:
```bash
PYTHONPATH=backend python -c "from app.models import EvalTemplate; print(EvalTemplate.__tablename__)"
```
Expected: `eval_templates`

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/eval_template.py backend/app/models/__init__.py
git commit -m "$(cat <<'EOF'
feat: add EvalTemplate ORM model for prompt+schema pairs
EOF
)"
```

---

## Task 2: Backend — Evaluator Model Changes

**Files:**
- Modify: `backend/app/models/evaluator.py`

- [ ] **Step 1: Add template columns to Evaluator**

In `backend/app/models/evaluator.py`, add two nullable columns after the existing `forked_from` column:

```python
    template_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    template_branch_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
```

Ensure `uuid` is imported at the top (it already should be from the `id` field). Ensure `String` is imported from `sqlalchemy`.

- [ ] **Step 2: Verify model loads**

Run:
```bash
PYTHONPATH=backend python -c "from app.models import Evaluator; print([c.name for c in Evaluator.__table__.columns if 'template' in c.name])"
```
Expected: `['template_id', 'template_branch_key']`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/evaluator.py
git commit -m "$(cat <<'EOF'
feat: add template_id and template_branch_key columns to Evaluator model
EOF
)"
```

---

## Task 3: Backend — EvalTemplate Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/eval_template.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `backend/app/schemas/eval_template.py`. Follow the pattern from `backend/app/schemas/prompt.py`:

```python
"""Pydantic schemas for eval_templates API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import field_validator

from app.schemas.base import CamelModel


class EvalTemplateCreate(CamelModel):
    app_id: str
    template_type: str  # transcription | evaluation | extraction
    source_type: str | None = None  # upload | api | null
    name: str
    prompt: str
    schema_data: dict | list = {}
    schema_format: str = "output_fields"  # json_schema | output_fields
    description: str | None = None
    is_default: bool = False
    visibility: str = "private"
    forked_from: str | None = None


class EvalTemplateNewVersion(CamelModel):
    """Create a new version of an existing branch."""
    prompt: str
    schema_data: dict | list
    schema_format: str | None = None  # null = keep existing
    name: str | None = None  # null = keep existing
    description: str | None = None


class EvalTemplateUpdate(CamelModel):
    """Metadata-only update (no new version)."""
    name: str | None = None
    description: str | None = None


class EvalTemplateResponse(CamelModel):
    id: str
    app_id: str
    template_type: str
    source_type: str | None = None
    branch_key: str
    version: int
    name: str
    description: str | None = None
    prompt: str
    schema_data: dict | list
    schema_format: str
    variables_used: list
    change_summary: str | None = None
    is_default: bool
    forked_from: str | None = None
    visibility: str | None = None
    shared_by: str | None = None
    shared_at: datetime | None = None
    tenant_id: str | None = None
    user_id: str | None = None
    owner_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("id", "forked_from", "tenant_id", "user_id", "shared_by", mode="before")
    @classmethod
    def uuid_to_str(cls, v: uuid.UUID | str | None) -> str | None:
        return str(v) if v is not None else None
```

- [ ] **Step 2: Verify import**

Run:
```bash
PYTHONPATH=backend python -c "from app.schemas.eval_template import EvalTemplateCreate, EvalTemplateResponse; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/eval_template.py
git commit -m "$(cat <<'EOF'
feat: add Pydantic schemas for eval_templates API
EOF
)"
```

---

## Task 4: Backend — Evaluator Pydantic Schema Changes

**Files:**
- Modify: `backend/app/schemas/evaluator.py`

- [ ] **Step 1: Add template fields to EvaluatorCreate, EvaluatorUpdate, and EvaluatorResponse**

In `backend/app/schemas/evaluator.py`:

Add to `EvaluatorCreate` (after `forked_from` field):
```python
    template_id: str | None = None
    template_branch_key: str | None = None
```

Make `prompt` optional when template_id is provided — change from `prompt: str` to:
```python
    prompt: str = ""
```

Add to `EvaluatorUpdate`:
```python
    template_id: str | None = None
    template_branch_key: str | None = None
```

Add to `EvaluatorResponse` (after `forked_from` field):
```python
    template_id: str | None = None
    template_branch_key: str | None = None
    template_upgrade_available: bool = False
```

Add `"template_id"` and `"template_branch_key"` to the `uuid_to_str` field_validator's field list.

- [ ] **Step 2: Verify import**

Run:
```bash
PYTHONPATH=backend python -c "
from app.schemas.evaluator import EvaluatorCreate, EvaluatorResponse
e = EvaluatorCreate(app_id='test', name='test', prompt='', template_id='abc', template_branch_key='key')
print(e.template_id)
r = EvaluatorResponse(id='1', app_id='test', name='test', prompt='', template_upgrade_available=True)
print(r.template_upgrade_available)
"
```
Expected:
```
abc
True
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/evaluator.py
git commit -m "$(cat <<'EOF'
feat: add template_id, template_branch_key to evaluator Pydantic schemas
EOF
)"
```

---

## Task 5: Backend — EvalTemplate API Routes

**Files:**
- Create: `backend/app/routes/eval_templates.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the eval_templates route file**

Create `backend/app/routes/eval_templates.py`. Follow the pattern from `backend/app/routes/prompts.py` for auth, access control, and query patterns. This is the largest single file — all CRUD + versioning + fork endpoints:

```python
"""Eval templates API — versioned prompt+schema pair library."""

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_app_access, require_permission
from app.database import get_db
from app.models.eval_template import EvalTemplate
from app.models.user import User
from app.schemas.eval_template import (
    EvalTemplateCreate,
    EvalTemplateNewVersion,
    EvalTemplateResponse,
    EvalTemplateUpdate,
)
from app.services.access_control import SYSTEM_TENANT_ID, SYSTEM_USER_ID, readable_scope_clause

router = APIRouter(prefix="/api/eval-templates", tags=["eval-templates"])


def _extract_variables(prompt_text: str) -> list[str]:
    """Extract {{variable}} names from prompt text."""
    return sorted(set(re.findall(r"\{\{(\w+(?:\.\w+)*)\}\}", prompt_text)))


def _compute_change_summary(
    old_prompt: str, new_prompt: str,
    old_schema: dict | list, new_schema: dict | list,
) -> str:
    prompt_changed = old_prompt != new_prompt
    schema_changed = old_schema != new_schema
    if prompt_changed and schema_changed:
        return "both"
    if prompt_changed:
        return "prompt"
    if schema_changed:
        return "schema"
    return "both"  # fallback — something must have changed to warrant a new version


async def _annotate_owner(
    db: AsyncSession, template: EvalTemplate,
) -> dict:
    """Build response dict with owner_name annotation."""
    data = {c.name: getattr(template, c.name) for c in template.__table__.columns}
    if template.user_id:
        user = await db.get(User, template.user_id)
        data["owner_name"] = user.name if user else None
    else:
        data["owner_name"] = None
    return data


# ── LIST ──────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[EvalTemplateResponse])
async def list_eval_templates(
    app_id: str = Query(...),
    template_type: str | None = Query(None),
    source_type: str | None = Query(None),
    branch_key: str | None = Query(None),
    latest_only: bool = Query(True),
    filter: str = Query("all"),  # all | private | shared
    auth: AuthContext = Depends(require_app_access()),
    db: AsyncSession = Depends(get_db),
):
    q = select(EvalTemplate).where(
        readable_scope_clause(EvalTemplate, auth),
        EvalTemplate.app_id == app_id,
    )

    if template_type:
        q = q.where(EvalTemplate.template_type == template_type)

    if source_type is not None:
        q = q.where(
            (EvalTemplate.source_type == source_type)
            | (EvalTemplate.source_type.is_(None))
        )

    if branch_key:
        q = q.where(EvalTemplate.branch_key == branch_key)

    if filter == "private":
        q = q.where(
            EvalTemplate.tenant_id == auth.tenant_id,
            EvalTemplate.user_id == auth.user_id,
        )
    elif filter == "shared":
        q = q.where(EvalTemplate.visibility == "shared")

    if latest_only:
        # Subquery: max version per branch
        sub = (
            select(
                EvalTemplate.branch_key,
                func.max(EvalTemplate.version).label("max_ver"),
            )
            .where(
                readable_scope_clause(EvalTemplate, auth),
                EvalTemplate.app_id == app_id,
            )
            .group_by(EvalTemplate.branch_key)
            .subquery()
        )
        q = q.join(
            sub,
            and_(
                EvalTemplate.branch_key == sub.c.branch_key,
                EvalTemplate.version == sub.c.max_ver,
            ),
        )

    q = q.order_by(desc(EvalTemplate.updated_at))
    result = await db.execute(q)
    templates = result.scalars().all()

    rows = []
    for t in templates:
        rows.append(await _annotate_owner(db, t))
    return rows


# ── GET SINGLE ────────────────────────────────────────────────────────────────


@router.get("/{template_id}", response_model=EvalTemplateResponse)
async def get_eval_template(
    template_id: str,
    auth: AuthContext = Depends(require_app_access()),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    q = select(EvalTemplate).where(
        readable_scope_clause(EvalTemplate, auth),
        EvalTemplate.id == uid,
    )
    result = await db.execute(q)
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(404, "Template not found")
    return await _annotate_owner(db, template)


# ── BRANCH VERSION HISTORY ────────────────────────────────────────────────────


@router.get("/branch/{branch_key}/versions", response_model=list[EvalTemplateResponse])
async def get_branch_versions(
    branch_key: str,
    auth: AuthContext = Depends(require_app_access()),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(EvalTemplate)
        .where(
            readable_scope_clause(EvalTemplate, auth),
            EvalTemplate.branch_key == branch_key,
        )
        .order_by(desc(EvalTemplate.version))
    )
    result = await db.execute(q)
    templates = result.scalars().all()
    rows = []
    for t in templates:
        rows.append(await _annotate_owner(db, t))
    return rows


# ── CREATE ────────────────────────────────────────────────────────────────────


@router.post("", response_model=EvalTemplateResponse, status_code=201)
async def create_eval_template(
    body: EvalTemplateCreate,
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    branch_key = body.name.lower().replace(" ", "-")[:40] + "-" + uuid.uuid4().hex[:8]

    template = EvalTemplate(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=body.app_id,
        template_type=body.template_type,
        source_type=body.source_type,
        branch_key=branch_key,
        version=1,
        name=body.name,
        description=body.description,
        prompt=body.prompt,
        schema_data=body.schema_data,
        schema_format=body.schema_format,
        variables_used=_extract_variables(body.prompt),
        change_summary="created",
        is_default=body.is_default,
        forked_from=uuid.UUID(body.forked_from) if body.forked_from else None,
        visibility=body.visibility,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return await _annotate_owner(db, template)


# ── NEW VERSION ───────────────────────────────────────────────────────────────


@router.post("/{template_id}/new-version", response_model=EvalTemplateResponse, status_code=201)
async def create_new_version(
    template_id: str,
    body: EvalTemplateNewVersion,
    auth: AuthContext = require_permission("asset:edit"),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    existing = await db.get(EvalTemplate, uid)
    if not existing:
        raise HTTPException(404, "Template not found")

    # Owner-only: must own the branch
    if existing.tenant_id != auth.tenant_id or existing.user_id != auth.user_id:
        raise HTTPException(403, "Only the template owner can create new versions. Fork instead.")

    # Get latest version number for this branch
    q = select(func.max(EvalTemplate.version)).where(
        EvalTemplate.tenant_id == auth.tenant_id,
        EvalTemplate.user_id == auth.user_id,
        EvalTemplate.branch_key == existing.branch_key,
    )
    result = await db.execute(q)
    max_ver = result.scalar() or 0

    new_template = EvalTemplate(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=existing.app_id,
        template_type=existing.template_type,
        source_type=existing.source_type,
        branch_key=existing.branch_key,
        version=max_ver + 1,
        name=body.name or existing.name,
        description=body.description if body.description is not None else existing.description,
        prompt=body.prompt,
        schema_data=body.schema_data,
        schema_format=body.schema_format or existing.schema_format,
        variables_used=_extract_variables(body.prompt),
        change_summary=_compute_change_summary(
            existing.prompt, body.prompt,
            existing.schema_data, body.schema_data,
        ),
        is_default=existing.is_default,
        forked_from=None,
        visibility=existing.visibility,
    )
    db.add(new_template)
    await db.commit()
    await db.refresh(new_template)
    return await _annotate_owner(db, new_template)


# ── FORK ──────────────────────────────────────────────────────────────────────


@router.post("/{template_id}/fork", response_model=EvalTemplateResponse, status_code=201)
async def fork_eval_template(
    template_id: str,
    app_id: str = Query(...),
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    q = select(EvalTemplate).where(
        readable_scope_clause(EvalTemplate, auth),
        EvalTemplate.id == uid,
    )
    result = await db.execute(q)
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Template not found")

    branch_key = source.name.lower().replace(" ", "-")[:40] + "-" + uuid.uuid4().hex[:8]

    forked = EvalTemplate(
        id=uuid.uuid4(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=app_id,
        template_type=source.template_type,
        source_type=source.source_type,
        branch_key=branch_key,
        version=1,
        name=source.name,
        description=source.description,
        prompt=source.prompt,
        schema_data=source.schema_data,
        schema_format=source.schema_format,
        variables_used=source.variables_used,
        change_summary="created",
        is_default=False,
        forked_from=source.id,
        visibility="private",
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return await _annotate_owner(db, forked)


# ── UPDATE METADATA ───────────────────────────────────────────────────────────


@router.put("/{template_id}", response_model=EvalTemplateResponse)
async def update_eval_template_metadata(
    template_id: str,
    body: EvalTemplateUpdate,
    auth: AuthContext = require_permission("asset:edit"),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    template = await db.get(EvalTemplate, uid)
    if not template:
        raise HTTPException(404, "Template not found")
    if template.tenant_id != auth.tenant_id or template.user_id != auth.user_id:
        raise HTTPException(403, "Only the owner can update this template")

    if body.name is not None:
        template.name = body.name
    if body.description is not None:
        template.description = body.description

    await db.commit()
    await db.refresh(template)
    return await _annotate_owner(db, template)


# ── VISIBILITY ────────────────────────────────────────────────────────────────


@router.patch("/{template_id}/visibility", response_model=EvalTemplateResponse)
async def patch_eval_template_visibility(
    template_id: str,
    body: dict,
    auth: AuthContext = require_permission("asset:share"),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    template = await db.get(EvalTemplate, uid)
    if not template:
        raise HTTPException(404, "Template not found")
    if template.tenant_id != auth.tenant_id or template.user_id != auth.user_id:
        raise HTTPException(403, "Only the owner can change visibility")

    template.visibility = body["visibility"]
    if body["visibility"] == "shared":
        template.shared_by = auth.user_id
        template.shared_at = datetime.now(timezone.utc)
    else:
        template.shared_by = None
        template.shared_at = None

    await db.commit()
    await db.refresh(template)
    return await _annotate_owner(db, template)


# ── DELETE ────────────────────────────────────────────────────────────────────


@router.delete("/{template_id}", status_code=204)
async def delete_eval_template(
    template_id: str,
    auth: AuthContext = require_permission("asset:delete"),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(template_id)
    template = await db.get(EvalTemplate, uid)
    if not template:
        raise HTTPException(404, "Template not found")
    if template.is_default:
        raise HTTPException(403, "Cannot delete system default templates")
    if template.tenant_id != auth.tenant_id or template.user_id != auth.user_id:
        raise HTTPException(403, "Only the owner can delete this template")

    await db.delete(template)
    await db.commit()
```

- [ ] **Step 2: Register the router in `main.py`**

In `backend/app/main.py`, find where routers are registered (look for `app.include_router` calls). Add:

```python
from app.routes.eval_templates import router as eval_templates_router
app.include_router(eval_templates_router)
```

Keep the old prompts and schemas routers for now — they'll be removed in the cleanup task.

- [ ] **Step 3: Verify server starts**

Run:
```bash
PYTHONPATH=backend python -c "from app.routes.eval_templates import router; print(len(router.routes), 'routes')"
```
Expected: `9 routes` (or similar — list, get, branch versions, create, new-version, fork, update, visibility, delete)

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/eval_templates.py backend/app/main.py
git commit -m "$(cat <<'EOF'
feat: add eval-templates API routes with CRUD, versioning, and fork
EOF
)"
```

---

## Task 6: Backend — Custom Evaluator Runner Template Loading

**Files:**
- Modify: `backend/app/services/evaluators/custom_evaluator_runner.py`

- [ ] **Step 1: Add template loading branch**

In `custom_evaluator_runner.py`, find the section where `evaluator.prompt` and `evaluator.output_schema` are used (around line 225). Add the template loading branch BEFORE the existing prompt resolution.

Add import at top:
```python
from app.models.eval_template import EvalTemplate
```

Then, before the line that calls `resolve_prompt(evaluator.prompt, ...)`, add the template loading logic:

```python
    # ── Load prompt & schema from template if linked, else use inline ──
    if evaluator.template_id:
        template = await db.get(EvalTemplate, evaluator.template_id)
        if not template:
            raise RuntimeError(f"Linked template {evaluator.template_id} not found")
        prompt_text = template.prompt
        if template.schema_format == "output_fields":
            output_schema = template.schema_data
        else:
            # json_schema format — pass through directly (Voice-RX style)
            output_schema = template.schema_data
    else:
        prompt_text = evaluator.prompt
        output_schema = evaluator.output_schema
```

Then update the existing `resolve_prompt` call to use `prompt_text` instead of `evaluator.prompt`, and `output_schema` instead of `evaluator.output_schema` for the `generate_json_schema` call.

Also update the config snapshot (around line 271) to include template info:

```python
    config_snapshot = {
        "prompt": prompt_text,
        "output_schema": output_schema,
        "template_id": str(evaluator.template_id) if evaluator.template_id else None,
        "template_branch_key": evaluator.template_branch_key,
        # ... existing fields ...
    }
```

- [ ] **Step 2: Verify import works**

Run:
```bash
PYTHONPATH=backend python -c "from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/evaluators/custom_evaluator_runner.py
git commit -m "$(cat <<'EOF'
feat: custom evaluator runner loads prompt+schema from template when linked
EOF
)"
```

---

## Task 7: Backend — Voice-RX Runner Model Updates

**Files:**
- Modify: `backend/app/services/evaluators/voice_rx_runner.py`

- [ ] **Step 1: Update imports and queries**

In `voice_rx_runner.py`, the helper functions `_load_default_prompt()` (line ~69) and `_load_default_schema()` (line ~88) currently query `Prompt` and `Schema` models. Update them to query `EvalTemplate`.

Replace the `Prompt` import with:
```python
from app.models.eval_template import EvalTemplate
```

Update `_load_default_prompt()`:
- Change `Prompt` → `EvalTemplate` in the select query
- Change `Prompt.prompt_type` → `EvalTemplate.template_type`
- Change `Prompt.source_type` → `EvalTemplate.source_type`
- Change `Prompt.is_default` → `EvalTemplate.is_default`
- Return `template.prompt` instead of `prompt.prompt`

Update `_load_default_schema()`:
- Change `Schema` → `EvalTemplate` in the select query
- Change `Schema.prompt_type` → `EvalTemplate.template_type`
- Change `Schema.source_type` → `EvalTemplate.source_type`
- Change `Schema.is_default` → `EvalTemplate.is_default`
- Return `template.schema_data` instead of `schema.schema_data`

Remove the old `Prompt` and `Schema` imports.

- [ ] **Step 2: Verify import works**

Run:
```bash
PYTHONPATH=backend python -c "from app.services.evaluators.voice_rx_runner import run_voice_rx_evaluation; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/evaluators/voice_rx_runner.py
git commit -m "$(cat <<'EOF'
refactor: voice-rx runner queries EvalTemplate instead of Prompt/Schema
EOF
)"
```

---

## Task 8: Backend — Update Evaluator Route for template_upgrade_available

**Files:**
- Modify: `backend/app/routes/evaluators.py`

- [ ] **Step 1: Add upgrade check to evaluator list/get responses**

In `backend/app/routes/evaluators.py`, find the function that builds EvaluatorResponse dicts (likely `_to_response` or inline dict construction in list/get endpoints).

Add import at top:
```python
from app.models.eval_template import EvalTemplate
```

Add a helper function:

```python
async def _check_template_upgrade(db: AsyncSession, evaluator) -> bool:
    """Return True if a newer template version exists for this evaluator's branch."""
    if not evaluator.template_id or not evaluator.template_branch_key:
        return False
    pinned = await db.get(EvalTemplate, evaluator.template_id)
    if not pinned:
        return False
    q = select(func.max(EvalTemplate.version)).where(
        EvalTemplate.branch_key == evaluator.template_branch_key,
    )
    result = await db.execute(q)
    max_ver = result.scalar() or 0
    return max_ver > pinned.version
```

Then in the list and get endpoints, add `template_upgrade_available` to the response dict by calling this helper for each evaluator.

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/evaluators.py
git commit -m "$(cat <<'EOF'
feat: evaluator API returns template_upgrade_available flag
EOF
)"
```

---

## Task 9: Backend — Seed Defaults Update

**Files:**
- Modify: `backend/app/services/seed_defaults.py`

- [ ] **Step 1: Update seed functions to write eval_templates**

In `seed_defaults.py`, find the `_seed_prompts()` and `_seed_schemas()` functions (around line 2478+). These need to be merged into a single `_seed_eval_templates()` function that:

1. Pairs each existing prompt constant with its matching schema constant by `(app_id, prompt_type, source_type)`
2. Creates `EvalTemplate` rows with both `prompt` and `schema_data` fields
3. Sets `schema_format='json_schema'` for all system defaults (Voice-RX uses raw JSON Schema)
4. Uses the same idempotency pattern (check if exists before insert)

Replace the `Prompt` and `Schema` imports with `EvalTemplate`.

The existing prompt/schema constant data structures in the file stay — just change which model they get inserted into.

Update the `_seed_prompts()` function signature and body to become `_seed_eval_templates()`, and remove `_seed_schemas()` as a separate function.

Update the main `seed_defaults()` function to call `_seed_eval_templates()` instead of the two separate functions.

- [ ] **Step 2: Also remove `activePromptIds` / `activeSchemaIds` from LLM settings seed**

Search `seed_defaults.py` for where `activePromptIds` or `activeSchemaIds` appear in seed data for the `llm-settings` key. Remove those fields from the seed payload.

- [ ] **Step 3: Verify seed function loads**

Run:
```bash
PYTHONPATH=backend python -c "from app.services.seed_defaults import seed_defaults; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/seed_defaults.py
git commit -m "$(cat <<'EOF'
refactor: seed_defaults writes eval_templates instead of separate prompts+schemas
EOF
)"
```

---

## Task 10: Frontend — EvalTemplate Types

**Files:**
- Create: `src/types/evalTemplate.types.ts`
- Modify: `src/types/evaluator.types.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Create EvalTemplate types**

Create `src/types/evalTemplate.types.ts`:

```typescript
import type { AssetVisibility } from './settings.types';

export interface EvalTemplate {
  id: string;
  userId?: string;
  tenantId?: string;
  ownerName?: string;
  appId: string;
  templateType: 'transcription' | 'evaluation' | 'extraction';
  sourceType?: 'upload' | 'api' | null;
  branchKey: string;
  version: number;
  name: string;
  description?: string;
  prompt: string;
  schemaData: Record<string, unknown> | EvalTemplateOutputField[];
  schemaFormat: 'json_schema' | 'output_fields';
  variablesUsed: string[];
  changeSummary?: 'prompt' | 'schema' | 'both' | 'created' | null;
  isDefault?: boolean;
  forkedFrom?: string | null;
  visibility?: AssetVisibility;
  sharedBy?: string | null;
  sharedAt?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Re-export for convenience — this is EvaluatorOutputField under a template-context alias
export type { EvaluatorOutputField as EvalTemplateOutputField } from './evaluator.types';

export interface CreateTemplatePayload {
  appId: string;
  templateType: string;
  sourceType?: string | null;
  name: string;
  prompt: string;
  schemaData: Record<string, unknown> | unknown[];
  schemaFormat: string;
  description?: string;
  visibility?: string;
}

export interface NewVersionPayload {
  prompt: string;
  schemaData: Record<string, unknown> | unknown[];
  schemaFormat?: string;
  name?: string;
  description?: string;
}
```

- [ ] **Step 2: Add template fields to EvaluatorDefinition**

In `src/types/evaluator.types.ts`, add to the `EvaluatorDefinition` interface (after `forkedFrom`):

```typescript
  templateId?: string | null;
  templateBranchKey?: string | null;
  templateUpgradeAvailable?: boolean;
```

- [ ] **Step 3: Update type exports**

In `src/types/index.ts`, add:
```typescript
export * from './evalTemplate.types';
```

- [ ] **Step 4: Commit**

```bash
git add src/types/evalTemplate.types.ts src/types/evaluator.types.ts src/types/index.ts
git commit -m "$(cat <<'EOF'
feat: add EvalTemplate TypeScript types, add template fields to EvaluatorDefinition
EOF
)"
```

---

## Task 11: Frontend — EvalTemplates API Service

**Files:**
- Create: `src/services/api/evalTemplatesApi.ts`

- [ ] **Step 1: Create the API repository**

Create `src/services/api/evalTemplatesApi.ts`. Follow the pattern from `src/services/api/promptsApi.ts`:

```typescript
import { apiRequest } from './client';
import type { EvalTemplate, CreateTemplatePayload, NewVersionPayload } from '@/types';

function toEvalTemplate(raw: Record<string, unknown>): EvalTemplate {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
  } as EvalTemplate;
}

export const evalTemplatesRepository = {
  async getAll(
    appId: string,
    opts?: {
      templateType?: string;
      sourceType?: string;
      latestOnly?: boolean;
      filter?: 'all' | 'private' | 'shared';
    },
  ): Promise<EvalTemplate[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (opts?.templateType) params.set('template_type', opts.templateType);
    if (opts?.sourceType) params.set('source_type', opts.sourceType);
    if (opts?.latestOnly === false) params.set('latest_only', 'false');
    if (opts?.filter) params.set('filter', opts.filter);
    const data = await apiRequest<Record<string, unknown>[]>(`/api/eval-templates?${params}`);
    return data.map(toEvalTemplate);
  },

  async getById(id: string): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>(`/api/eval-templates/${id}`);
    return toEvalTemplate(data);
  },

  async getBranchVersions(appId: string, branchKey: string): Promise<EvalTemplate[]> {
    const params = new URLSearchParams({ app_id: appId });
    const data = await apiRequest<Record<string, unknown>[]>(
      `/api/eval-templates/branch/${branchKey}/versions?${params}`,
    );
    return data.map(toEvalTemplate);
  },

  async create(appId: string, payload: CreateTemplatePayload): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>('/api/eval-templates', {
      method: 'POST',
      body: JSON.stringify({ ...payload, appId }),
    });
    return toEvalTemplate(data);
  },

  async createNewVersion(templateId: string, payload: NewVersionPayload): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>(
      `/api/eval-templates/${templateId}/new-version`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    return toEvalTemplate(data);
  },

  async fork(appId: string, templateId: string): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>(
      `/api/eval-templates/${templateId}/fork?app_id=${appId}`,
      { method: 'POST' },
    );
    return toEvalTemplate(data);
  },

  async updateMetadata(
    templateId: string,
    updates: { name?: string; description?: string },
  ): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>(
      `/api/eval-templates/${templateId}`,
      { method: 'PUT', body: JSON.stringify(updates) },
    );
    return toEvalTemplate(data);
  },

  async setVisibility(templateId: string, visibility: string): Promise<EvalTemplate> {
    const data = await apiRequest<Record<string, unknown>>(
      `/api/eval-templates/${templateId}/visibility`,
      { method: 'PATCH', body: JSON.stringify({ visibility }) },
    );
    return toEvalTemplate(data);
  },

  async delete(templateId: string): Promise<void> {
    await apiRequest(`/api/eval-templates/${templateId}`, { method: 'DELETE' });
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api/evalTemplatesApi.ts
git commit -m "$(cat <<'EOF'
feat: add evalTemplatesApi service for eval-templates endpoints
EOF
)"
```

---

## Task 12: Frontend — EvalTemplates Zustand Store

**Files:**
- Create: `src/stores/evalTemplatesStore.ts`

- [ ] **Step 1: Create the store**

Create `src/stores/evalTemplatesStore.ts`. Follow the pattern from `src/stores/promptsStore.ts`:

```typescript
import { create } from 'zustand';
import type { AppId } from '@/types/app.types';
import type { EvalTemplate, CreateTemplatePayload, NewVersionPayload } from '@/types';
import { evalTemplatesRepository } from '@/services/api/evalTemplatesApi';

interface EvalTemplatesState {
  templates: Record<string, EvalTemplate[]>; // keyed by appId
  isLoaded: Record<string, boolean>;

  loadTemplates: (appId: AppId) => Promise<void>;
  getTemplate: (appId: AppId, id: string) => EvalTemplate | undefined;
  getTemplatesByType: (appId: AppId, type: string) => EvalTemplate[];
  getBranchVersions: (appId: AppId, branchKey: string) => Promise<EvalTemplate[]>;
  createTemplate: (appId: AppId, data: CreateTemplatePayload) => Promise<EvalTemplate>;
  createNewVersion: (templateId: string, data: NewVersionPayload) => Promise<EvalTemplate>;
  forkTemplate: (appId: AppId, templateId: string) => Promise<EvalTemplate>;
  updateMetadata: (
    appId: AppId,
    templateId: string,
    data: { name?: string; description?: string },
  ) => Promise<EvalTemplate>;
  setVisibility: (appId: AppId, templateId: string, visibility: string) => Promise<EvalTemplate>;
  deleteTemplate: (appId: AppId, templateId: string) => Promise<void>;
  reset: () => void;
}

export const useEvalTemplatesStore = create<EvalTemplatesState>((set, get) => ({
  templates: {},
  isLoaded: {},

  loadTemplates: async (appId) => {
    const templates = await evalTemplatesRepository.getAll(appId);
    set((state) => ({
      templates: { ...state.templates, [appId]: templates },
      isLoaded: { ...state.isLoaded, [appId]: true },
    }));
  },

  getTemplate: (appId, id) => {
    return (get().templates[appId] ?? []).find((t) => t.id === id);
  },

  getTemplatesByType: (appId, type) => {
    return (get().templates[appId] ?? []).filter((t) => t.templateType === type);
  },

  getBranchVersions: async (appId, branchKey) => {
    return evalTemplatesRepository.getBranchVersions(appId, branchKey);
  },

  createTemplate: async (appId, data) => {
    const created = await evalTemplatesRepository.create(appId, data);
    set((state) => ({
      templates: {
        ...state.templates,
        [appId]: [...(state.templates[appId] ?? []), created],
      },
    }));
    return created;
  },

  createNewVersion: async (templateId, data) => {
    const newVersion = await evalTemplatesRepository.createNewVersion(templateId, data);
    // Reload to get latest-only list correct
    const appId = newVersion.appId;
    await get().loadTemplates(appId as AppId);
    return newVersion;
  },

  forkTemplate: async (appId, templateId) => {
    const forked = await evalTemplatesRepository.fork(appId, templateId);
    set((state) => ({
      templates: {
        ...state.templates,
        [appId]: [...(state.templates[appId] ?? []), forked],
      },
    }));
    return forked;
  },

  updateMetadata: async (appId, templateId, data) => {
    const updated = await evalTemplatesRepository.updateMetadata(templateId, data);
    set((state) => ({
      templates: {
        ...state.templates,
        [appId]: (state.templates[appId] ?? []).map((t) =>
          t.id === templateId ? updated : t,
        ),
      },
    }));
    return updated;
  },

  setVisibility: async (appId, templateId, visibility) => {
    const updated = await evalTemplatesRepository.setVisibility(templateId, visibility);
    set((state) => ({
      templates: {
        ...state.templates,
        [appId]: (state.templates[appId] ?? []).map((t) =>
          t.id === templateId ? updated : t,
        ),
      },
    }));
    return updated;
  },

  deleteTemplate: async (appId, templateId) => {
    await evalTemplatesRepository.delete(templateId);
    set((state) => ({
      templates: {
        ...state.templates,
        [appId]: (state.templates[appId] ?? []).filter((t) => t.id !== templateId),
      },
    }));
  },

  reset: () => set({ templates: {}, isLoaded: {} }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/evalTemplatesStore.ts
git commit -m "$(cat <<'EOF'
feat: add evalTemplatesStore replacing promptsStore + schemasStore
EOF
)"
```

---

## Task 13: Frontend — Evaluator API Service Template Fields

**Files:**
- Modify: `src/services/api/evaluatorsApi.ts`

- [ ] **Step 1: Add template fields to ApiEvaluator interface and mappings**

In `src/services/api/evaluatorsApi.ts`, find the `ApiEvaluator` interface (around line 18). Add:

```typescript
  templateId?: string | null;
  templateBranchKey?: string | null;
  templateUpgradeAvailable?: boolean;
```

Find the `toEvaluatorDefinition()` function (around line 49). Add the template fields to the return mapping:

```typescript
  templateId: raw.templateId ?? null,
  templateBranchKey: raw.templateBranchKey ?? null,
  templateUpgradeAvailable: raw.templateUpgradeAvailable ?? false,
```

Find the `save()` method body where the request payload is built. Add:

```typescript
  templateId: evaluator.templateId ?? null,
  templateBranchKey: evaluator.templateBranchKey ?? null,
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api/evaluatorsApi.ts
git commit -m "$(cat <<'EOF'
feat: evaluator API service passes template_id and template_branch_key
EOF
)"
```

---

## Task 14: Frontend — SourceModeToggle Component

**Files:**
- Create: `src/features/evals/components/SourceModeToggle.tsx`

- [ ] **Step 1: Create the toggle component**

Create `src/features/evals/components/SourceModeToggle.tsx`. Base on `BuildModeToggle.tsx`:

```typescript
import { cn } from '@/utils/cn';

export type SourceMode = 'template' | 'custom';

interface SourceModeToggleProps {
  value: SourceMode;
  onChange: (mode: SourceMode) => void;
}

export function SourceModeToggle({ value, onChange }: SourceModeToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-text-primary">Prompt Source</span>
      <div className="flex rounded-lg border border-border-default overflow-hidden">
        <button
          type="button"
          className={cn(
            'px-4 py-1.5 text-xs font-medium transition-colors',
            value === 'template'
              ? 'bg-interactive-primary text-text-on-color'
              : 'bg-bg-secondary text-text-muted hover:text-text-primary',
          )}
          onClick={() => onChange('template')}
        >
          Use Template
        </button>
        <button
          type="button"
          className={cn(
            'px-4 py-1.5 text-xs font-medium transition-colors',
            value === 'custom'
              ? 'bg-interactive-primary text-text-on-color'
              : 'bg-bg-secondary text-text-muted hover:text-text-primary',
          )}
          onClick={() => onChange('custom')}
        >
          Write Custom
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/evals/components/SourceModeToggle.tsx
git commit -m "$(cat <<'EOF'
feat: add SourceModeToggle component for template vs custom selection
EOF
)"
```

---

## Task 15: Frontend — TemplatePicker Component

**Files:**
- Create: `src/features/evals/components/TemplatePicker.tsx`

- [ ] **Step 1: Create the template picker**

Create `src/features/evals/components/TemplatePicker.tsx`. Uses `SearchableSelect` for the dropdown with grouped options and pair summary below:

```typescript
import { useMemo } from 'react';
import { SearchableSelect } from '@/components/ui';
import { Badge } from '@/components/ui';
import type { AppId, EvalTemplate } from '@/types';
import type { EvaluatorOutputField } from '@/types/evaluator.types';

interface TemplatePickerProps {
  appId: AppId;
  templates: EvalTemplate[];
  selectedId: string | null;
  onChange: (template: EvalTemplate | null) => void;
}

export function TemplatePicker({ appId, templates, selectedId, onChange }: TemplatePickerProps) {
  const options = useMemo(() => {
    return templates.map((t) => ({
      value: t.id,
      label: t.name,
      searchText: `${t.name} ${t.description ?? ''} ${t.ownerName ?? ''}`,
      group: t.isDefault
        ? 'System Defaults'
        : t.userId === undefined
          ? 'Shared in Team'
          : 'My Templates',
    }));
  }, [templates]);

  const selected = templates.find((t) => t.id === selectedId);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-text-muted mb-1.5 block">
          Template
        </label>
        <SearchableSelect
          value={selectedId ?? ''}
          onChange={(val) => {
            const tmpl = templates.find((t) => t.id === val) ?? null;
            onChange(tmpl);
          }}
          options={options}
          placeholder="Search templates..."
        />
      </div>

      {selected && (
        <div className="flex gap-3">
          {/* Prompt preview */}
          <div className="flex-1 rounded-lg border border-border-subtle bg-bg-secondary p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted mb-1">
              Prompt
            </div>
            <div className="text-xs text-text-secondary line-clamp-3 font-mono">
              {selected.prompt.slice(0, 200)}
              {selected.prompt.length > 200 ? '...' : ''}
            </div>
            <div className="flex gap-1 mt-2 flex-wrap">
              {selected.variablesUsed.map((v) => (
                <Badge key={v} variant="info" size="sm">
                  <span className="font-mono">{v}</span>
                </Badge>
              ))}
            </div>
          </div>

          {/* Schema preview */}
          <div className="flex-1 rounded-lg border border-border-subtle bg-bg-secondary p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted mb-1">
              Schema &middot;{' '}
              {Array.isArray(selected.schemaData)
                ? `${(selected.schemaData as unknown[]).length} fields`
                : 'JSON Schema'}
            </div>
            {Array.isArray(selected.schemaData) && (
              <div className="space-y-0.5">
                {(selected.schemaData as EvaluatorOutputField[]).slice(0, 4).map((f) => (
                  <div key={f.key} className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono text-text-secondary">{f.key}</span>
                    {f.isMainMetric && (
                      <Badge variant="warning" size="sm">MAIN</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/evals/components/TemplatePicker.tsx
git commit -m "$(cat <<'EOF'
feat: add TemplatePicker component with searchable dropdown and pair summary
EOF
)"
```

---

## Task 16: Frontend — Evaluator Wizard Integration

**Files:**
- Modify: `src/features/evals/components/CreateEvaluatorWizard.tsx`

- [ ] **Step 1: Add template state and source toggle to the wizard**

This is the most complex frontend change. In `CreateEvaluatorWizard.tsx`:

**Add imports:**
```typescript
import { SourceModeToggle, type SourceMode } from './SourceModeToggle';
import { TemplatePicker } from './TemplatePicker';
import { Alert } from '@/components/ui';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';
import type { EvalTemplate } from '@/types';
```

**Add state** (inside the component, near existing state declarations):
```typescript
const [sourceMode, setSourceMode] = useState<SourceMode>(
  editEvaluator?.templateId ? 'template' : 'custom',
);
const [selectedTemplate, setSelectedTemplate] = useState<EvalTemplate | null>(null);
const [promptSnapshot, setPromptSnapshot] = useState<string>('');
const [schemaSnapshot, setSchemaSnapshot] = useState<unknown[]>([]);
const [isDirty, setIsDirty] = useState(false);
```

**Load templates** (in a useEffect or alongside existing data loading):
```typescript
const templates = useEvalTemplatesStore((s) => s.templates[context.appId] ?? []);
const loadTemplates = useEvalTemplatesStore((s) => s.loadTemplates);
const createNewVersion = useEvalTemplatesStore((s) => s.createNewVersion);
const forkTemplate = useEvalTemplatesStore((s) => s.forkTemplate);

useEffect(() => {
  loadTemplates(context.appId);
}, [context.appId, loadTemplates]);
```

**Template selection handler:**
```typescript
const handleTemplateSelect = (template: EvalTemplate | null) => {
  setSelectedTemplate(template);
  if (template && template.schemaFormat === 'output_fields') {
    const fields = template.schemaData as EvaluatorOutputField[];
    setPrompt(template.prompt);
    setPromptSnapshot(template.prompt);
    setOutputSchema(fields);
    setSchemaSnapshot(structuredClone(fields));
    setIsDirty(false);
  }
};
```

**Dirty detection** (check on prompt/schema changes):
```typescript
useEffect(() => {
  if (sourceMode !== 'template' || !selectedTemplate) return;
  const promptChanged = prompt !== promptSnapshot;
  const schemaChanged = JSON.stringify(outputSchema) !== JSON.stringify(schemaSnapshot);
  setIsDirty(promptChanged || schemaChanged);
}, [prompt, outputSchema, promptSnapshot, schemaSnapshot, sourceMode, selectedTemplate]);
```

**In the Prompt step JSX**, add the source toggle and conditional rendering:
- At the top of step 2 content: render `<SourceModeToggle value={sourceMode} onChange={setSourceMode} />`
- If `sourceMode === 'template'`: render `<TemplatePicker>`, info `<Alert>`, read-only prompt `<pre>` (or editable textarea with dirty banner)
- If `sourceMode === 'custom'`: render existing textarea + variable picker (no changes)

**In the Schema step JSX:**
- If `sourceMode === 'template'`: render info `<Alert>`, then existing `<SchemaTable>` pre-populated from template
- If dirty: render amber `<Alert variant="warning">` with "Save as vN" button
- If `sourceMode === 'custom'`: render existing `<SchemaTable>` (no changes)

**"Save as vN" handler:**
```typescript
const handleSaveNewVersion = async () => {
  if (!selectedTemplate) return;
  const isOwner = selectedTemplate.userId === auth.user?.id;
  let newTemplate: EvalTemplate;
  if (isOwner) {
    newTemplate = await createNewVersion(selectedTemplate.id, {
      prompt,
      schemaData: outputSchema,
    });
  } else {
    // Fork then the fork becomes v1 of a new branch
    newTemplate = await forkTemplate(context.appId, selectedTemplate.id);
  }
  setSelectedTemplate(newTemplate);
  setPromptSnapshot(newTemplate.prompt);
  setSchemaSnapshot(structuredClone(newTemplate.schemaData as unknown[]));
  setIsDirty(false);
};
```

**On wizard save** (modify `onSave` callback):
```typescript
if (sourceMode === 'template' && selectedTemplate) {
  onSave({
    ...evaluatorData,
    prompt: '',
    outputSchema: [],
    templateId: selectedTemplate.id,
    templateBranchKey: selectedTemplate.branchKey,
  });
} else {
  onSave({
    ...evaluatorData,
    templateId: null,
    templateBranchKey: null,
  });
}
```

- [ ] **Step 2: Verify the wizard still renders**

Start the dev server and open the evaluator creation wizard. Verify:
- Source toggle appears
- Switching between modes doesn't crash
- Template picker loads and shows templates (may be empty if no seed data yet)

- [ ] **Step 3: Commit**

```bash
git add src/features/evals/components/CreateEvaluatorWizard.tsx
git commit -m "$(cat <<'EOF'
feat: evaluator wizard supports template selection with dirty detection and version save
EOF
)"
```

---

## Task 17: Frontend — EvaluatorsTable Source Column + Upgrade Badge

**Files:**
- Modify: `src/features/evals/components/EvaluatorsTable.tsx`

- [ ] **Step 1: Add Source column**

In `EvaluatorsTable.tsx`, add a new column in the table header and body:

**Header** (after the Name column):
```tsx
<th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
  Source
</th>
```

**Body cell** (for each evaluator row):
```tsx
<td className="px-3 py-3">
  {evaluator.templateId ? (
    <div className="flex items-center gap-1.5">
      <Badge variant="info" size="sm">
        {evaluator.templateBranchKey
          ? `${evaluator.name} v${evaluator.version ?? '?'}`
          : 'template'}
      </Badge>
      {evaluator.templateUpgradeAvailable && (
        <Badge
          variant="warning"
          size="sm"
          className="cursor-pointer"
          onClick={() => onUpgradeReview?.(evaluator)}
        >
          ↑ upgrade
        </Badge>
      )}
    </div>
  ) : (
    <Badge variant="neutral" size="sm">custom</Badge>
  )}
</td>
```

Add `onUpgradeReview` to the component's props interface:
```typescript
onUpgradeReview?: (evaluator: EvaluatorDefinition) => void;
```

- [ ] **Step 2: Commit**

```bash
git add src/features/evals/components/EvaluatorsTable.tsx
git commit -m "$(cat <<'EOF'
feat: evaluators table shows template source badge and upgrade nudge
EOF
)"
```

---

## Task 18: Frontend — PromptDiff and SchemaDiff Components

**Files:**
- Create: `src/features/evals/components/PromptDiff.tsx`
- Create: `src/features/evals/components/SchemaDiff.tsx`

- [ ] **Step 1: Create PromptDiff**

Create `src/features/evals/components/PromptDiff.tsx` — simple line-by-line side-by-side diff:

```typescript
import { cn } from '@/utils/cn';

interface PromptDiffProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}

export function PromptDiff({ oldText, newText, oldLabel, newLabel }: PromptDiffProps) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const maxLines = Math.max(oldLines.length, newLines.length);

  return (
    <div className="flex gap-0 overflow-auto">
      {/* Left: old */}
      <div className="flex-1 border-r border-border-default">
        <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted bg-bg-secondary border-b border-border-subtle">
          {oldLabel}
        </div>
        <pre className="p-3 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
          {oldLines.map((line, i) => {
            const inNew = newLines.includes(line);
            return (
              <div
                key={i}
                className={cn(!inNew && 'bg-surface-error text-error')}
              >
                {line}
              </div>
            );
          })}
        </pre>
      </div>

      {/* Right: new */}
      <div className="flex-1">
        <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-text-muted bg-bg-secondary border-b border-border-subtle">
          {newLabel}
        </div>
        <pre className="p-3 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
          {newLines.map((line, i) => {
            const inOld = oldLines.includes(line);
            return (
              <div
                key={i}
                className={cn(!inOld && 'bg-surface-success text-success')}
              >
                {line}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create SchemaDiff**

Create `src/features/evals/components/SchemaDiff.tsx` — field-level diff table:

```typescript
import { Badge } from '@/components/ui';
import type { EvaluatorOutputField } from '@/types/evaluator.types';

interface SchemaDiffProps {
  oldFields: EvaluatorOutputField[];
  newFields: EvaluatorOutputField[];
}

type FieldStatus = 'unchanged' | 'modified' | 'added' | 'removed';

interface DiffRow {
  key: string;
  type: string;
  status: FieldStatus;
  detail: string;
}

export function SchemaDiff({ oldFields, newFields }: SchemaDiffProps) {
  const oldMap = new Map(oldFields.map((f) => [f.key, f]));
  const newMap = new Map(newFields.map((f) => [f.key, f]));

  const rows: DiffRow[] = [];

  // Check old fields
  for (const f of oldFields) {
    const n = newMap.get(f.key);
    if (!n) {
      rows.push({ key: f.key, type: f.type, status: 'removed', detail: '' });
    } else if (JSON.stringify(f) !== JSON.stringify(n)) {
      const changes: string[] = [];
      if (f.type !== n.type) changes.push(`type: ${f.type} → ${n.type}`);
      if (f.thresholds?.green !== n.thresholds?.green) changes.push(`green: ${f.thresholds?.green} → ${n.thresholds?.green}`);
      if (f.thresholds?.yellow !== n.thresholds?.yellow) changes.push(`yellow: ${f.thresholds?.yellow} → ${n.thresholds?.yellow}`);
      if (f.role !== n.role) changes.push(`role: ${f.role} → ${n.role}`);
      if (f.displayMode !== n.displayMode) changes.push(`display: ${f.displayMode} → ${n.displayMode}`);
      rows.push({ key: f.key, type: n.type, status: 'modified', detail: changes.join(', ') || 'fields changed' });
    } else {
      rows.push({ key: f.key, type: f.type, status: 'unchanged', detail: '' });
    }
  }

  // Check new fields not in old
  for (const f of newFields) {
    if (!oldMap.has(f.key)) {
      rows.push({ key: f.key, type: f.type, status: 'added', detail: `${f.role ?? 'detail'}, ${f.displayMode}` });
    }
  }

  const added = rows.filter((r) => r.status === 'added').length;
  const modified = rows.filter((r) => r.status === 'modified').length;
  const removed = rows.filter((r) => r.status === 'removed').length;

  const statusVariant: Record<FieldStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
    added: 'success',
    modified: 'warning',
    removed: 'error',
    unchanged: 'neutral',
  };

  return (
    <div>
      <div className="rounded-lg border border-border-default bg-bg-secondary px-3 py-2 mb-3 text-xs text-text-secondary">
        <strong className="text-text-primary">Schema changes:</strong>
        {added > 0 && <span className="text-success ml-2">+{added} added</span>}
        {modified > 0 && <span className="text-warning ml-2">{modified} modified</span>}
        {removed > 0 && <span className="text-error ml-2">{removed} removed</span>}
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default text-[10px] font-medium uppercase tracking-wide text-text-muted">
            <th className="text-left px-3 py-2">Field</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Change</th>
            <th className="text-left px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border-subtle">
              <td className="px-3 py-2 font-mono text-text-primary">{r.key}</td>
              <td className="px-3 py-2 text-text-muted">{r.type}</td>
              <td className="px-3 py-2">
                {r.status !== 'unchanged' ? (
                  <Badge variant={statusVariant[r.status]} size="sm">{r.status}</Badge>
                ) : (
                  <span className="text-text-muted">&mdash;</span>
                )}
              </td>
              <td className="px-3 py-2 text-text-muted">{r.detail || (r.status === 'unchanged' ? 'unchanged' : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/evals/components/PromptDiff.tsx src/features/evals/components/SchemaDiff.tsx
git commit -m "$(cat <<'EOF'
feat: add PromptDiff and SchemaDiff components for template upgrade review
EOF
)"
```

---

## Task 19: Frontend — TemplateUpgradeModal

**Files:**
- Create: `src/features/evals/components/TemplateUpgradeModal.tsx`

- [ ] **Step 1: Create the upgrade review modal**

Create `src/features/evals/components/TemplateUpgradeModal.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Modal, Tabs, Button } from '@/components/ui';
import { PromptDiff } from './PromptDiff';
import { SchemaDiff } from './SchemaDiff';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';
import type { AppId, EvalTemplate, EvaluatorDefinition } from '@/types';
import type { EvaluatorOutputField } from '@/types/evaluator.types';

interface TemplateUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  evaluator: EvaluatorDefinition;
  appId: AppId;
  onUpgrade: (evaluatorId: string, newTemplateId: string, newBranchKey: string) => void;
}

export function TemplateUpgradeModal({
  isOpen,
  onClose,
  evaluator,
  appId,
  onUpgrade,
}: TemplateUpgradeModalProps) {
  const [currentTemplate, setCurrentTemplate] = useState<EvalTemplate | null>(null);
  const [latestTemplate, setLatestTemplate] = useState<EvalTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'prompt' | 'schema'>('prompt');
  const getBranchVersions = useEvalTemplatesStore((s) => s.getBranchVersions);

  useEffect(() => {
    if (!isOpen || !evaluator.templateId || !evaluator.templateBranchKey) return;
    (async () => {
      const versions = await getBranchVersions(appId, evaluator.templateBranchKey!);
      const current = versions.find((v) => v.id === evaluator.templateId);
      const latest = versions[0]; // sorted desc by version
      setCurrentTemplate(current ?? null);
      setLatestTemplate(latest ?? null);
    })();
  }, [isOpen, evaluator.templateId, evaluator.templateBranchKey, appId, getBranchVersions]);

  if (!currentTemplate || !latestTemplate) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Upgrade "${evaluator.name}"`}
    >
      <div className="text-xs text-text-muted mb-4">
        {currentTemplate.name} v{currentTemplate.version} → v{latestTemplate.version}
        {latestTemplate.ownerName && <> · by {latestTemplate.ownerName}</>}
      </div>

      <Tabs
        tabs={[
          { key: 'prompt', label: 'Prompt Diff' },
          { key: 'schema', label: 'Schema Diff' },
        ]}
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as 'prompt' | 'schema')}
      />

      <div className="mt-3 max-h-[400px] overflow-auto rounded-lg border border-border-default">
        {activeTab === 'prompt' ? (
          <PromptDiff
            oldText={currentTemplate.prompt}
            newText={latestTemplate.prompt}
            oldLabel={`Current · v${currentTemplate.version}`}
            newLabel={`New · v${latestTemplate.version}`}
          />
        ) : (
          <SchemaDiff
            oldFields={(currentTemplate.schemaData as EvaluatorOutputField[]) ?? []}
            newFields={(latestTemplate.schemaData as EvaluatorOutputField[]) ?? []}
          />
        )}
      </div>

      <div className="text-xs text-text-muted mt-3">
        Previous runs retain their original config.
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Stay on v{currentTemplate.version}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onUpgrade(evaluator.id, latestTemplate.id, latestTemplate.branchKey);
            onClose();
          }}
        >
          Upgrade to v{latestTemplate.version}
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/evals/components/TemplateUpgradeModal.tsx
git commit -m "$(cat <<'EOF'
feat: add TemplateUpgradeModal with prompt and schema diff views
EOF
)"
```

---

## Task 20: Frontend — Settings TemplatesTab

**Files:**
- Create: `src/features/settings/components/TemplatesTab.tsx`
- Create: `src/features/settings/components/TemplatePeekOverlay.tsx`

- [ ] **Step 1: Create TemplatePeekOverlay**

Create `src/features/settings/components/TemplatePeekOverlay.tsx` — the right-side peek panel with Prompt/Schema/History tabs. This component:

- Accepts an `EvalTemplate` and renders its details
- Uses `Tabs` component for Prompt / Schema / History views
- Prompt tab: `<pre>` with monospace text, variables highlighted with `Badge`
- Schema tab: field list with type, role badge, thresholds
- History tab: loads branch versions via `getBranchVersions()`, renders timeline with change badges
- Header: Fork / Edit buttons, visibility badge, owner info

Read the existing `PromptsTab.tsx` for the component patterns (state management, store usage, action handlers). The peek overlay is a new layout pattern but uses all existing primitives (`Tabs`, `Badge`, `Button`, `VisibilityBadge`).

- [ ] **Step 2: Create TemplatesTab**

Create `src/features/settings/components/TemplatesTab.tsx` — the main templates table + peek overlay. This component:

- Loads templates via `useEvalTemplatesStore.loadTemplates(appId)`
- Renders filter bar with two segmented controls (type filter + ownership filter) using the `BuildModeToggle` pattern
- Renders a table following the `EvaluatorsTable` pattern (raw `<table>`, not a library)
- Columns: Name (+description), Type badge, Version, Variables (monospace badges), Visibility badge, Updated
- Row click opens TemplatePeekOverlay on the right side
- "+ New Template" button opens a creation overlay

Read `PromptsTab.tsx` and `SchemasTab.tsx` for the existing settings tab patterns. The new TemplatesTab replaces both.

- [ ] **Step 3: Wire into Settings page**

Find the settings page component that renders PromptsTab and SchemasTab (likely in `src/features/settings/` or the page layout). Replace both tab references with single TemplatesTab. Remove imports of PromptsTab and SchemasTab.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/components/TemplatesTab.tsx src/features/settings/components/TemplatePeekOverlay.tsx
git commit -m "$(cat <<'EOF'
feat: add TemplatesTab replacing PromptsTab + SchemasTab in settings
EOF
)"
```

---

## Task 21: Frontend — Dead Code Removal

**Files:**
- Delete: `src/types/prompt.types.ts`, `src/types/schema.types.ts`
- Delete: `src/stores/promptsStore.ts`, `src/stores/schemasStore.ts`
- Delete: `src/services/api/promptsApi.ts`, `src/services/api/schemasApi.ts`
- Delete: `src/services/prompts/resolvePromptText.ts`
- Delete: `src/features/settings/components/PromptsTab.tsx`, `SchemasTab.tsx`
- Delete: `src/features/settings/components/PromptCreateOverlay.tsx`, `SchemaCreateOverlay.tsx`
- Modify: `src/types/index.ts` — remove prompt/schema type exports
- Modify: `src/stores/llmSettingsStore.ts` — remove activePromptIds/activeSchemaIds

- [ ] **Step 1: Remove old type exports from index**

In `src/types/index.ts`, remove the lines:
```typescript
export * from './prompt.types';
export * from './schema.types';
```

- [ ] **Step 2: Remove activePromptIds/activeSchemaIds from llmSettingsStore**

In `src/stores/llmSettingsStore.ts`:
- Remove the `activePromptIds` and `activeSchemaIds` from the default state (lines ~28-36)
- Remove the `setActivePromptId` and `setActiveSchemaId` methods (lines ~227-243)
- Remove these fields from the `save()` payload construction (lines ~189-190)
- Remove from the `loadSettings()` merge (lines ~152-158)
- Remove from `updateLLMSettings()` merge (lines ~247-260)

Search for all remaining references to `activePromptId` and `activeSchemaId` across the codebase and remove them.

- [ ] **Step 3: Delete old files**

```bash
rm src/types/prompt.types.ts src/types/schema.types.ts
rm src/stores/promptsStore.ts src/stores/schemasStore.ts
rm src/services/api/promptsApi.ts src/services/api/schemasApi.ts
rm src/services/prompts/resolvePromptText.ts
rm src/features/settings/components/PromptsTab.tsx src/features/settings/components/SchemasTab.tsx
```

Also check for and delete `PromptCreateOverlay.tsx` and `SchemaCreateOverlay.tsx` if they exist in the settings components directory.

- [ ] **Step 4: Fix any remaining import errors**

Run:
```bash
npx tsc -b --noEmit 2>&1 | head -50
```

Fix any remaining references to deleted files. Common spots:
- `src/app/Providers.tsx` — may reference promptsStore/schemasStore for initialization
- `src/stores/authStore.ts` — may call `.reset()` on old stores during logout
- Settings page barrel exports

- [ ] **Step 5: Verify build passes**

Run:
```bash
npm run build
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove dead code — old prompts/schemas stores, types, APIs, settings tabs, resolvePromptText
EOF
)"
```

---

## Task 22: Backend — Dead Code Removal + Route Cleanup

**Files:**
- Delete: `backend/app/routes/prompts.py`, `backend/app/routes/schemas.py`
- Delete: `backend/app/schemas/prompt.py`, `backend/app/schemas/schema.py`
- Modify: `backend/app/main.py` — remove old router registrations
- Modify: `backend/app/models/__init__.py` — remove Prompt/Schema imports (only after confirming no other references)

- [ ] **Step 1: Remove old route registrations from main.py**

In `backend/app/main.py`, remove the `include_router` lines for prompts and schemas routers. Keep the eval_templates router.

- [ ] **Step 2: Delete old route and schema files**

```bash
rm backend/app/routes/prompts.py backend/app/routes/schemas.py
rm backend/app/schemas/prompt.py backend/app/schemas/schema.py
```

- [ ] **Step 3: Check for remaining references**

Search for any remaining imports of `Prompt` or `Schema` models (other than EvalTemplate):

```bash
cd backend && grep -r "from app.models.prompt import\|from app.models.schema import\|from app.schemas.prompt import\|from app.schemas.schema import" --include="*.py" .
```

Fix any remaining references. The main spots will be:
- `seed_defaults.py` (should already be updated in Task 9)
- `voice_rx_runner.py` (should already be updated in Task 7)
- `models/__init__.py` — remove `Prompt` and `Schema` from imports and `__all__`

- [ ] **Step 4: Do NOT delete model files yet**

Keep `backend/app/models/prompt.py` and `backend/app/models/schema.py` for now — they're needed for the data migration. They'll be deleted after migration runs successfully in production.

- [ ] **Step 5: Verify server starts**

```bash
PYTHONPATH=backend python -c "from app.main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove old prompts/schemas routes and Pydantic schemas
EOF
)"
```

---

## Task 23: Backend — Data Migration Script

**Files:**
- Create: `backend/app/services/migration/migrate_templates.py`

- [ ] **Step 1: Create the migration script**

Create `backend/app/services/migration/migrate_templates.py`. This script:

1. Reads all rows from `prompts` table
2. Reads all rows from `schemas` table
3. Pairs them by `(tenant_id, user_id, app_id, prompt_type, source_type, branch_key, version)`
4. Creates `eval_templates` rows for each pair
5. Handles orphans (prompt without schema → `schema_data={}`, schema without prompt → `prompt=''`)

```python
"""One-time migration: merge prompts + schemas into eval_templates."""

import asyncio
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models.eval_template import EvalTemplate
from app.models.prompt import Prompt
from app.models.schema import Schema


def _extract_variables(prompt_text: str) -> list[str]:
    return sorted(set(re.findall(r"\{\{(\w+(?:\.\w+)*)\}\}", prompt_text)))


async def migrate():
    async with async_session_factory() as db:
        # Load all prompts
        prompts = (await db.execute(select(Prompt))).scalars().all()
        # Load all schemas
        schemas = (await db.execute(select(Schema))).scalars().all()

        # Index schemas by matching key
        schema_map: dict[tuple, Schema] = {}
        for s in schemas:
            key = (
                str(s.tenant_id), str(s.user_id), s.app_id,
                s.prompt_type, s.source_type, s.branch_key, s.version,
            )
            schema_map[key] = s

        created = 0
        orphan_prompts = 0
        orphan_schemas = 0

        # Process prompts (primary side)
        seen_keys: set[tuple] = set()
        for p in prompts:
            key = (
                str(p.tenant_id), str(p.user_id), p.app_id,
                p.prompt_type, p.source_type, p.branch_key, p.version,
            )
            seen_keys.add(key)
            schema_row = schema_map.get(key)

            template = EvalTemplate(
                id=uuid.uuid4(),
                tenant_id=p.tenant_id,
                user_id=p.user_id,
                app_id=p.app_id,
                template_type=p.prompt_type,
                source_type=p.source_type,
                branch_key=p.branch_key,
                version=p.version,
                name=p.name,
                description=p.description,
                prompt=p.prompt,
                schema_data=schema_row.schema_data if schema_row else {},
                schema_format="json_schema",  # existing data is all json_schema format
                variables_used=_extract_variables(p.prompt),
                change_summary="created",
                is_default=p.is_default,
                forked_from=None,
                visibility=p.visibility if hasattr(p, "visibility") else "private",
            )
            # Copy sharing info if available
            if hasattr(p, "shared_by") and p.shared_by:
                template.shared_by = p.shared_by
                template.shared_at = p.shared_at

            db.add(template)
            created += 1
            if not schema_row:
                orphan_prompts += 1

        # Process orphan schemas (no matching prompt)
        for s in schemas:
            key = (
                str(s.tenant_id), str(s.user_id), s.app_id,
                s.prompt_type, s.source_type, s.branch_key, s.version,
            )
            if key in seen_keys:
                continue  # already handled

            template = EvalTemplate(
                id=uuid.uuid4(),
                tenant_id=s.tenant_id,
                user_id=s.user_id,
                app_id=s.app_id,
                template_type=s.prompt_type,
                source_type=s.source_type,
                branch_key=s.branch_key,
                version=s.version,
                name=s.name,
                description=s.description,
                prompt="",
                schema_data=s.schema_data,
                schema_format="json_schema",
                variables_used=[],
                change_summary="created",
                is_default=s.is_default,
                forked_from=None,
                visibility=s.visibility if hasattr(s, "visibility") else "private",
            )
            db.add(template)
            created += 1
            orphan_schemas += 1

        await db.commit()
        print(f"Migration complete: {created} templates created")
        print(f"  Paired: {created - orphan_prompts - orphan_schemas}")
        print(f"  Orphan prompts (no schema): {orphan_prompts}")
        print(f"  Orphan schemas (no prompt): {orphan_schemas}")


if __name__ == "__main__":
    asyncio.run(migrate())
```

- [ ] **Step 2: Ensure migration directory exists**

```bash
mkdir -p backend/app/services/migration
touch backend/app/services/migration/__init__.py
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/migration/
git commit -m "$(cat <<'EOF'
feat: add data migration script to merge prompts+schemas into eval_templates
EOF
)"
```

---

## Task 24: Final Verification

- [ ] **Step 1: Run TypeScript build**

```bash
npm run build
```
Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Fix any lint issues.

- [ ] **Step 3: Run TypeScript type check**

```bash
npx tsc -b --noEmit
```
Expected: No errors.

- [ ] **Step 4: Verify backend imports**

```bash
PYTHONPATH=backend python -c "
from app.models import EvalTemplate, Evaluator
from app.routes.eval_templates import router
from app.services.evaluators.custom_evaluator_runner import run_custom_evaluator
from app.services.evaluators.voice_rx_runner import run_voice_rx_evaluation
print('All imports OK')
"
```

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: resolve build and lint issues from eval-templates integration
EOF
)"
```
