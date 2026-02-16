"""History API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.history import History
from app.schemas.history import HistoryCreate, HistoryUpdate, HistoryResponse

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=list[HistoryResponse])
async def query_history(
    app_id: str = Query(None),
    entity_type: str = Query(None),
    entity_id: str = Query(None),
    source_type: str = Query(None),
    source_id: str = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """Query history with multiple optional filters and pagination."""
    query = select(History).order_by(desc(History.timestamp))
    
    if app_id:
        query = query.where(History.app_id == app_id)
    if entity_type:
        query = query.where(History.entity_type == entity_type)
    if entity_id:
        query = query.where(History.entity_id == entity_id)
    if source_type:
        query = query.where(History.source_type == source_type)
    if source_id:
        query = query.where(History.source_id == source_id)
    
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    history_records = result.scalars().all()
    return [_to_response(h) for h in history_records]


@router.get("/{history_id}", response_model=HistoryResponse)
async def get_history(
    history_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single history record by ID."""
    result = await db.execute(
        select(History).where(History.id == history_id)
    )
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="History record not found")
    return _to_response(history)


@router.post("", response_model=HistoryResponse, status_code=201)
async def create_history(
    body: HistoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new history record."""
    history = History(**body.model_dump())
    db.add(history)
    await db.commit()
    await db.refresh(history)
    return _to_response(history)


@router.put("/{history_id}", response_model=HistoryResponse)
async def update_history(
    history_id: UUID,
    body: HistoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a history record. Only provided fields are updated."""
    result = await db.execute(select(History).where(History.id == history_id))
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="History record not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(history, key, value)

    await db.commit()
    await db.refresh(history)
    return _to_response(history)


@router.delete("/{history_id}")
async def delete_history(
    history_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a history record."""
    result = await db.execute(select(History).where(History.id == history_id))
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="History record not found")
    
    await db.delete(history)
    await db.commit()
    return {"deleted": True, "id": str(history_id)}


def _to_response(history: History) -> dict:
    """Convert SQLAlchemy model to response dict."""
    return {
        "id": str(history.id),
        "app_id": history.app_id,
        "entity_type": history.entity_type,
        "entity_id": history.entity_id,
        "source_type": history.source_type,
        "source_id": history.source_id,
        "status": history.status,
        "duration_ms": history.duration_ms,
        "data": history.data,
        "triggered_by": history.triggered_by,
        "schema_version": history.schema_version,
        "user_context": history.user_context,
        "timestamp": history.timestamp,
        "user_id": history.user_id,
    }
