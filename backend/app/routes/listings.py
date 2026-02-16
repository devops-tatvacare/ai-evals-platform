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
