"""Evaluators API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.evaluator import Evaluator
from app.schemas.evaluator import EvaluatorCreate, EvaluatorUpdate, EvaluatorSetGlobal, EvaluatorResponse

router = APIRouter(prefix="/api/evaluators", tags=["evaluators"])


@router.get("", response_model=list[EvaluatorResponse])
async def list_evaluators(
    app_id: str = Query(...),
    listing_id: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List evaluators for an app, optionally filtered by listing_id."""
    query = select(Evaluator).where(Evaluator.app_id == app_id)
    if listing_id:
        query = query.where(Evaluator.listing_id == UUID(listing_id))
    elif app_id == "kaira-bot":
        # For kaira-bot without listing_id, return app-level evaluators only
        query = query.where(Evaluator.listing_id == None)
    query = query.order_by(desc(Evaluator.created_at))

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/registry", response_model=list[EvaluatorResponse])
async def list_registry(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """List all global evaluators (the registry) for an app."""
    query = (
        select(Evaluator)
        .where(Evaluator.app_id == app_id, Evaluator.is_global == True)
        .order_by(desc(Evaluator.created_at))
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{evaluator_id}", response_model=EvaluatorResponse)
async def get_evaluator(
    evaluator_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single evaluator by ID."""
    result = await db.execute(
        select(Evaluator).where(Evaluator.id == evaluator_id)
    )
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")
    return evaluator


@router.post("", response_model=EvaluatorResponse, status_code=201)
async def create_evaluator(
    body: EvaluatorCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new evaluator."""
    evaluator = Evaluator(**body.model_dump())
    db.add(evaluator)
    await db.commit()
    await db.refresh(evaluator)
    return evaluator


@router.put("/{evaluator_id}", response_model=EvaluatorResponse)
async def update_evaluator(
    evaluator_id: UUID,
    body: EvaluatorUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an evaluator. Only provided fields are updated."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(evaluator, key, value)

    await db.commit()
    await db.refresh(evaluator)
    return evaluator


@router.delete("/{evaluator_id}")
async def delete_evaluator(
    evaluator_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete an evaluator."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    await db.delete(evaluator)
    await db.commit()
    return {"deleted": True, "id": str(evaluator_id)}


@router.post("/{evaluator_id}/fork", response_model=EvaluatorResponse, status_code=201)
async def fork_evaluator(
    evaluator_id: UUID,
    listing_id: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Fork an evaluator for a specific listing (or app-level if listing_id is empty)."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    forked = Evaluator(
        app_id=source.app_id,
        listing_id=UUID(listing_id) if listing_id else None,
        name=source.name,
        prompt=source.prompt,
        model_id=source.model_id,
        output_schema=source.output_schema,
        is_global=False,
        show_in_header=source.show_in_header,
        forked_from=source.id,
    )
    db.add(forked)
    await db.commit()
    await db.refresh(forked)
    return forked


@router.put("/{evaluator_id}/global", response_model=EvaluatorResponse)
async def set_global(
    evaluator_id: UUID,
    body: EvaluatorSetGlobal,
    db: AsyncSession = Depends(get_db),
):
    """Set the is_global flag on an evaluator."""
    result = await db.execute(select(Evaluator).where(Evaluator.id == evaluator_id))
    evaluator = result.scalar_one_or_none()
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    evaluator.is_global = body.is_global
    await db.commit()
    await db.refresh(evaluator)
    return evaluator
