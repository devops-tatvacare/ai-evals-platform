"""EvaluationTemplate API routes."""
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.database import get_db
from app.models.eval_template import EvaluationTemplate
from app.models.mixins.shareable import Visibility
from app.schemas.eval_template import (
    EvalTemplateCreate,
    EvalTemplateNewVersion,
    EvalTemplateUpdate,
    EvalTemplateResponse,
)
from app.services.access_control import readable_scope_clause

router = APIRouter(prefix="/api/eval-templates", tags=["eval-templates"])

_VAR_RE = re.compile(r"\{\{(\w+(?:\.\w+)*)\}\}")


def _extract_variables(prompt_text: str) -> list[str]:
    """Return deduplicated list of {{variable}} names from prompt text."""
    seen: set[str] = set()
    result: list[str] = []
    for match in _VAR_RE.finditer(prompt_text):
        name = match.group(1)
        if name not in seen:
            seen.add(name)
            result.append(name)
    return result


def _compute_change_summary(
    old_prompt: str,
    new_prompt: str,
    old_schema: object,
    new_schema: object,
) -> str:
    """Return 'prompt', 'schema', or 'both' based on what changed."""
    prompt_changed = old_prompt != new_prompt
    schema_changed = old_schema != new_schema
    if prompt_changed and schema_changed:
        return "both"
    if prompt_changed:
        return "prompt"
    return "schema"


@router.get("", response_model=list[EvalTemplateResponse])
async def list_eval_templates(
    app_id: str = Query(...),
    template_type: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    branch_key: Optional[str] = Query(None),
    latest_only: bool = Query(True),
    filter: Optional[str] = Query("all"),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """List eval templates visible to the current user for an app."""
    query = select(EvaluationTemplate).where(
        readable_scope_clause(EvaluationTemplate, auth),
        EvaluationTemplate.app_id == app_id,
    )
    if template_type:
        query = query.where(EvaluationTemplate.template_type == template_type)
    if source_type:
        query = query.where(
            or_(EvaluationTemplate.source_type == source_type, EvaluationTemplate.source_type.is_(None))
        )
    if branch_key:
        query = query.where(EvaluationTemplate.branch_key == branch_key)
    if filter == "private":
        query = query.where(EvaluationTemplate.visibility == Visibility.PRIVATE)
    elif filter == "shared":
        query = query.where(EvaluationTemplate.visibility == Visibility.SHARED)

    if latest_only and not branch_key:
        query = query.order_by(EvaluationTemplate.branch_key, desc(EvaluationTemplate.version))
        result = await db.execute(query)
        all_rows = result.scalars().all()
        seen_branches: set[tuple[str, str, str | None]] = set()
        latest: list[EvaluationTemplate] = []
        for row in all_rows:
            branch_identity = (row.branch_key, row.template_type, row.source_type)
            if branch_identity not in seen_branches:
                seen_branches.add(branch_identity)
                latest.append(row)
        return latest

    query = query.order_by(desc(EvaluationTemplate.version))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/branch/{branch_key}/versions", response_model=list[EvalTemplateResponse])
async def get_branch_versions(
    branch_key: str,
    app_id: str = Query(...),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get all versions of a branch ordered by version desc."""
    result = await db.execute(
        select(EvaluationTemplate).where(
            readable_scope_clause(EvaluationTemplate, auth),
            EvaluationTemplate.app_id == app_id,
            EvaluationTemplate.branch_key == branch_key,
        ).order_by(desc(EvaluationTemplate.version))
    )
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="Branch not found")
    return rows


@router.get("/{template_id}", response_model=EvalTemplateResponse)
async def get_eval_template(
    template_id: str,
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get a single eval template by UUID id."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")
    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            readable_scope_clause(EvaluationTemplate, auth),
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="EvaluationTemplate not found")
    return template


@router.post("", response_model=EvalTemplateResponse, status_code=201)
async def create_eval_template(
    body: EvalTemplateCreate,
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new eval template (v1 of a new branch)."""
    data = body.model_dump(exclude_none=True)

    # Auto-generate branch_key from name if not provided
    branch_key = data.get("branch_key") or re.sub(r"[^a-z0-9_-]", "-", body.name.lower()).strip("-")
    data["branch_key"] = branch_key

    variables_used = _extract_variables(body.prompt)
    data["variables_used"] = variables_used
    data["change_summary"] = "created"

    template = EvaluationTemplate(
        **data,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        version=1,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.post("/{template_id}/new-version", response_model=EvalTemplateResponse, status_code=201)
async def new_version_eval_template(
    template_id: str,
    body: EvalTemplateNewVersion,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new version of an existing branch. Owner-only."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")

    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            EvaluationTemplate.tenant_id == auth.tenant_id,
            EvaluationTemplate.user_id == auth.user_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=403, detail="EvaluationTemplate not found or not owned by you")

    # Compute next version within this branch
    max_version = await db.scalar(
        select(func.max(EvaluationTemplate.version)).where(
            EvaluationTemplate.tenant_id == auth.tenant_id,
            EvaluationTemplate.app_id == source.app_id,
            EvaluationTemplate.template_type == source.template_type,
            EvaluationTemplate.source_type == source.source_type,
            EvaluationTemplate.branch_key == source.branch_key,
        )
    )
    next_version = (max_version or 0) + 1

    change_summary = _compute_change_summary(
        source.prompt, body.prompt, source.schema_data, body.schema_data
    )
    variables_used = _extract_variables(body.prompt)

    new_template = EvaluationTemplate(
        app_id=source.app_id,
        template_type=source.template_type,
        source_type=source.source_type,
        branch_key=source.branch_key,
        version=next_version,
        name=body.name if body.name is not None else source.name,
        description=body.description if body.description is not None else source.description,
        prompt=body.prompt,
        schema_data=body.schema_data,
        schema_format=body.schema_format if body.schema_format is not None else source.schema_format,
        variables_used=variables_used,
        change_summary=change_summary,
        is_default=False,
        visibility=source.visibility,
        forked_from=source.forked_from,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(new_template)
    await db.commit()
    await db.refresh(new_template)
    return new_template


@router.post("/{template_id}/fork", response_model=EvalTemplateResponse, status_code=201)
async def fork_eval_template(
    template_id: str,
    app_id: str = Query(...),
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Fork a readable template into a new private branch."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")

    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            readable_scope_clause(EvaluationTemplate, auth),
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="EvaluationTemplate not found")

    forked = EvaluationTemplate(
        app_id=app_id,
        template_type=source.template_type,
        source_type=source.source_type,
        branch_key=str(uuid.uuid4()),
        version=1,
        name=source.name,
        description=source.description,
        prompt=source.prompt,
        schema_data=source.schema_data,
        schema_format=source.schema_format,
        variables_used=source.variables_used,
        change_summary="created",
        is_default=False,
        visibility=Visibility.PRIVATE,
        forked_from=source.id,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return forked


@router.put("/{template_id}", response_model=EvalTemplateResponse)
async def update_eval_template(
    template_id: str,
    body: EvalTemplateUpdate,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Metadata-only update (name, description). Owner-only. No new version."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")

    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            EvaluationTemplate.tenant_id == auth.tenant_id,
            EvaluationTemplate.user_id == auth.user_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="EvaluationTemplate not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    await db.commit()
    await db.refresh(template)
    return template


@router.patch("/{template_id}/visibility", response_model=EvalTemplateResponse)
async def patch_eval_template_visibility(
    template_id: str,
    body: dict,
    auth: AuthContext = require_permission('asset:share'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Change visibility on a template. Owner-only."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")

    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            EvaluationTemplate.tenant_id == auth.tenant_id,
            EvaluationTemplate.user_id == auth.user_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="EvaluationTemplate not found or not owned by you")

    if template.is_default:
        raise HTTPException(status_code=400, detail="Cannot change visibility of system defaults")

    latest_version = await db.scalar(
        select(func.max(EvaluationTemplate.version)).where(
            EvaluationTemplate.tenant_id == template.tenant_id,
            EvaluationTemplate.user_id == template.user_id,
            EvaluationTemplate.app_id == template.app_id,
            EvaluationTemplate.template_type == template.template_type,
            EvaluationTemplate.source_type == template.source_type,
            EvaluationTemplate.branch_key == template.branch_key,
        )
    )
    if latest_version != template.version:
        raise HTTPException(
            status_code=409,
            detail="Visibility can only be changed on the latest template version",
        )

    try:
        new_visibility = Visibility.normalize(body.get("visibility"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="visibility must be 'private' or 'shared'") from exc
    if new_visibility is None:
        raise HTTPException(status_code=422, detail="visibility must be 'private' or 'shared'")

    template.visibility = new_visibility
    if new_visibility == Visibility.SHARED:
        template.shared_by = auth.user_id
        from sqlalchemy import func as sqlfunc
        template.shared_at = sqlfunc.now()

    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/{template_id}")
async def delete_eval_template(
    template_id: str,
    auth: AuthContext = require_permission('asset:delete'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Delete a template. Cannot delete system defaults."""
    try:
        tid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid template_id UUID")

    result = await db.execute(
        select(EvaluationTemplate).where(
            EvaluationTemplate.id == tid,
            EvaluationTemplate.tenant_id == auth.tenant_id,
            EvaluationTemplate.user_id == auth.user_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="EvaluationTemplate not found")

    if template.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default template")

    await db.delete(template)
    await db.commit()
    return {"deleted": True, "id": template_id}
