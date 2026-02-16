"""Files API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FastAPIFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.file_record import FileRecord
from app.schemas.file import FileResponse as FileResponseSchema
from app.services.file_storage import file_storage

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/upload", response_model=FileResponseSchema, status_code=201)
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and create a file record."""
    contents = await file.read()
    storage_path = await file_storage.save(contents, file.filename or "unnamed")

    record = FileRecord(
        original_name=file.filename or "unnamed",
        mime_type=file.content_type,
        size_bytes=len(contents),
        storage_path=storage_path,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.get("/{file_id}", response_model=FileResponseSchema)
async def get_file_metadata(
    file_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get file metadata by ID."""
    result = await db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")
    return file_rec


@router.get("/{file_id}/download")
async def download_file(
    file_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Download a file by ID."""
    result = await db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_rec.storage_path,
        filename=file_rec.original_name,
        media_type=file_rec.mime_type or "application/octet-stream",
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a file and its record."""
    result = await db.execute(
        select(FileRecord).where(FileRecord.id == file_id)
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")

    await file_storage.delete(file_rec.storage_path)
    await db.delete(file_rec)
    await db.commit()

    return {"deleted": True, "id": str(file_id)}
