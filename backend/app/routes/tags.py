"""Tags API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tag import Tag
from app.models.chat import ChatMessage
from app.schemas.tag import TagCreate, TagUpdate, TagResponse

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """List all tags for an app."""
    result = await db.execute(
        select(Tag)
        .where(Tag.app_id == app_id)
        .order_by(Tag.name)
    )
    return result.scalars().all()


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single tag by ID."""
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new tag."""
    tag = Tag(**body.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a tag. Only provided fields are updated."""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Delete a tag."""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    await db.delete(tag)
    await db.commit()
    return {"deleted": True, "id": tag_id}


@router.post("/{tag_id}/increment", response_model=TagResponse)
async def increment_tag_count(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Increment tag usage count."""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
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
    db: AsyncSession = Depends(get_db),
):
    """Decrement tag usage count."""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.count = max(0, tag.count - 1)
    await db.commit()
    await db.refresh(tag)
    return tag
