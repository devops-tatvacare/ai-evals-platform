"""Tags API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.database import get_db
from app.models.application_tag import ApplicationTag
from app.schemas.tag import TagCreate, TagUpdate, TagResponse

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    app_id: str = Query(...),
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """List all tags for an app."""
    result = await db.execute(
        select(ApplicationTag)
        .where(
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
            ApplicationTag.app_id == app_id,
        )
        .order_by(ApplicationTag.name)
    )
    return result.scalars().all()


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: int,
    auth: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Get a single tag by ID."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.id == tag_id,
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    body: TagCreate,
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Create a new tag or increment count if it already exists."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
            ApplicationTag.app_id == body.app_id,
            ApplicationTag.name == body.name,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.count += 1
        existing.last_used = func.now()
        await db.commit()
        await db.refresh(existing)
        return existing

    tag = ApplicationTag(
        **body.model_dump(),
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    tag.count = 1
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Update a tag. Only provided fields are updated."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.id == tag_id,
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(tag, key, value)

    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}")
async def delete_tag(
    tag_id: int,
    auth: AuthContext = require_permission('asset:delete'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Delete a tag."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.id == tag_id,
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    await db.delete(tag)
    await db.commit()
    return {"deleted": True, "id": tag_id}


@router.post("/{tag_id}/increment", response_model=TagResponse)
async def increment_tag_count(
    tag_id: int,
    auth: AuthContext = require_permission('asset:create'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Increment tag usage count."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.id == tag_id,
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.count += 1
    tag.last_used = func.now()
    await db.commit()
    await db.refresh(tag)
    return tag


@router.post("/{tag_id}/decrement", response_model=TagResponse)
async def decrement_tag_count(
    tag_id: int,
    auth: AuthContext = require_permission('asset:edit'),
    _app_check: AuthContext = require_app_access(),
    db: AsyncSession = Depends(get_db),
):
    """Decrement tag usage count."""
    result = await db.execute(
        select(ApplicationTag).where(
            ApplicationTag.id == tag_id,
            ApplicationTag.tenant_id == auth.tenant_id,
            ApplicationTag.user_id == auth.user_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.count = max(0, tag.count - 1)
    await db.commit()
    await db.refresh(tag)
    return tag
