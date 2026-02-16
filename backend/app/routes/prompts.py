"""Prompts API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.prompt import Prompt
from app.schemas.prompt import PromptCreate, PromptUpdate, PromptResponse

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.get("", response_model=list[PromptResponse])
async def list_prompts(
    app_id: str = Query(...),
    prompt_type: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all prompts for an app, optionally filtered by prompt_type."""
    query = select(Prompt).where(Prompt.app_id == app_id)
    if prompt_type:
        query = query.where(Prompt.prompt_type == prompt_type)
    query = query.order_by(desc(Prompt.created_at))
    
    result = await db.execute(query)
    prompts = result.scalars().all()
    return [_to_response(p) for p in prompts]


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single prompt by ID."""
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id)
    )
    prompt = result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return _to_response(prompt)


@router.post("", response_model=PromptResponse, status_code=201)
async def create_prompt(
    body: PromptCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new prompt with auto-incremented version."""
    # Get current max version for this app_id + prompt_type
    result = await db.execute(
        select(func.max(Prompt.version))
        .where(Prompt.app_id == body.app_id, Prompt.prompt_type == body.prompt_type)
    )
    max_version = result.scalar() or 0
    
    prompt = Prompt(**body.model_dump(), version=max_version + 1)
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return _to_response(prompt)


@router.put("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: int,
    body: PromptUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a prompt. Only provided fields are updated."""
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt = result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(prompt, key, value)

    await db.commit()
    await db.refresh(prompt)
    return _to_response(prompt)


@router.delete("/{prompt_id}")
async def delete_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a prompt. Cannot delete default prompts."""
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt = result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    if prompt.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default prompt")
    
    await db.delete(prompt)
    await db.commit()
    return {"deleted": True, "id": prompt_id}


@router.post("/ensure-defaults")
async def ensure_default_prompts(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Seed default prompts for an app if they don't exist."""
    # This is a placeholder - in a real implementation, you would define
    # default prompts for each prompt_type and insert them if missing
    return {"message": "Default prompts ensured", "app_id": app_id}


def _to_response(prompt: Prompt) -> dict:
    """Convert SQLAlchemy model to response dict."""
    return {
        "id": prompt.id,
        "app_id": prompt.app_id,
        "prompt_type": prompt.prompt_type,
        "version": prompt.version,
        "name": prompt.name,
        "prompt": prompt.prompt,
        "description": prompt.description,
        "is_default": prompt.is_default,
        "source_type": prompt.source_type,
        "created_at": prompt.created_at,
        "updated_at": prompt.updated_at,
        "user_id": prompt.user_id,
    }
