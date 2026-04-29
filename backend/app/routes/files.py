"""Files API routes."""
import io
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FastAPIFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission, require_app_access
from app.config import settings
from app.database import get_db
from app.models.application_uploaded_file import ApplicationUploadedFile
from app.schemas.file import FileResponse as FileResponseSchema
from app.services.file_storage import file_storage

router = APIRouter(prefix="/api/files", tags=["files"])

_MAX_UPLOAD_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
_ALLOWED_MIMES = set(m.strip() for m in settings.ALLOWED_UPLOAD_MIMES.split(",") if m.strip())


@router.post("/upload", response_model=FileResponseSchema, status_code=201)
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    auth: AuthContext = require_permission('asset:create'),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and create a file record."""
    contents = await file.read()

    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    if file.content_type and file.content_type not in _ALLOWED_MIMES:
        raise HTTPException(
            400, detail=f"File type '{file.content_type}' not allowed",
        )

    storage_path = await file_storage.save(contents, file.filename or "unnamed")

    record = ApplicationUploadedFile(
        original_name=file.filename or "unnamed",
        mime_type=file.content_type,
        size_bytes=len(contents),
        storage_path=storage_path,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.get("/{file_id}", response_model=FileResponseSchema)
async def get_file_metadata(
    file_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Get file metadata by ID."""
    result = await db.execute(
        select(ApplicationUploadedFile).where(
            ApplicationUploadedFile.id == file_id,
            ApplicationUploadedFile.tenant_id == auth.tenant_id,
            ApplicationUploadedFile.user_id == auth.user_id,
        )
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")
    return file_rec


@router.get("/{file_id}/download")
async def download_file(
    file_id: UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Download a file by ID."""
    result = await db.execute(
        select(ApplicationUploadedFile).where(
            ApplicationUploadedFile.id == file_id,
            ApplicationUploadedFile.tenant_id == auth.tenant_id,
            ApplicationUploadedFile.user_id == auth.user_id,
        )
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")

    content = await file_storage.read(file_rec.storage_path)
    return StreamingResponse(
        io.BytesIO(content),
        media_type=file_rec.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{file_rec.original_name}"'},
    )


@router.delete("/{file_id}")
async def delete_file(
    file_id: UUID,
    auth: AuthContext = require_permission('asset:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Delete a file and its record."""
    result = await db.execute(
        select(ApplicationUploadedFile).where(
            ApplicationUploadedFile.id == file_id,
            ApplicationUploadedFile.tenant_id == auth.tenant_id,
            ApplicationUploadedFile.user_id == auth.user_id,
        )
    )
    file_rec = result.scalar_one_or_none()
    if not file_rec:
        raise HTTPException(status_code=404, detail="File not found")

    await file_storage.delete(file_rec.storage_path)
    await db.delete(file_rec)
    await db.commit()

    return {"deleted": True, "id": str(file_id)}
