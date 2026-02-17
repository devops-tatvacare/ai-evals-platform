"""Listings API routes."""
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.listing import Listing
from app.models.file_record import FileRecord
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
    return result.scalars().all()


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
    return result.scalars().all()


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
    return listing


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
    return listing


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
    return listing


@router.delete("/{listing_id}")
async def delete_listing(
    listing_id: UUID,
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Delete a listing. ORM cascade deletes eval_runs → api_logs/threads/adversarial.
    Manual cleanup for file storage only.
    """
    result = await db.execute(
        select(Listing).where(Listing.id == listing_id, Listing.app_id == app_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    # Manual: delete associated file from storage
    if listing.audio_file and listing.audio_file.get("id"):
        file_result = await db.execute(
            select(FileRecord).where(FileRecord.id == UUID(listing.audio_file["id"]))
        )
        file_rec = file_result.scalar_one_or_none()
        if file_rec:
            from app.services.file_storage import file_storage
            await file_storage.delete(file_rec.storage_path)
            await db.delete(file_rec)

    # ORM cascade handles: eval_runs → thread_evaluations, adversarial_evaluations, api_logs
    await db.delete(listing)
    await db.commit()
    return {"deleted": True, "id": str(listing_id)}
