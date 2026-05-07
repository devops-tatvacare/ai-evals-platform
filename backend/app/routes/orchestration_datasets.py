"""Cohort dataset routes (auth-required).

Phase 12 — REST surface for the Phase-12 cohort dataset CRUD + import service.
All routes are tenant-scoped via ``Depends(get_auth_context)`` and (where the
app_id is known) app-gated via ``ensure_registered_app_access``.

Service-layer exceptions from ``services.orchestration.api.datasets`` are
mapped here to stable client-facing HTTP errors:

- ``DatasetNotFound``  -> 404 ("dataset not found" / "dataset version not found")
- ``DatasetConflict``  -> 409 (str(exc))
- ``DatasetInUse``     -> 409 (workflow names listed in detail)
- ``CsvImportError``   -> 400 (str(exc))

Tenant-mismatch returns 404, never 403, to avoid leaking row existence across
tenants.
"""
from __future__ import annotations

import io
import uuid
from typing import Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.orchestration import CohortDataset
from app.services.access_control import can_access
from app.schemas.orchestration_dataset import (
    DatasetCreate,
    DatasetDetailResponse,
    DatasetResponse,
    DatasetUpdate,
    DatasetVersionResponse,
)
from app.services.orchestration.api import datasets as dataset_service
from app.services.orchestration.datasets.csv_importer import CsvImportError


router = APIRouter(prefix="/api/orchestration/datasets", tags=["orchestration"])


_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB outer guard


# ─── helpers ────────────────────────────────────────────────────────────────


async def _load_and_gate_dataset(
    db: AsyncSession,
    auth: AuthContext,
    dataset_id: uuid.UUID,
    *,
    action: Literal["read", "edit"] = "read",
) -> CohortDataset:
    row = await db.scalar(
        select(CohortDataset).where(
            CohortDataset.id == dataset_id,
            CohortDataset.tenant_id == auth.tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="dataset not found")
    await ensure_registered_app_access(db, auth, row.app_id)
    if not can_access(auth, row, action):
        if action == "read":
            raise HTTPException(status_code=404, detail="dataset not found")
        raise HTTPException(status_code=403, detail="dataset is read-only")
    return row


def _format_in_use_detail(exc: dataset_service.DatasetInUse) -> str:
    names = sorted(exc.workflow_names)
    return f"dataset version is in use by workflow(s): {', '.join(names)}"


# ─── dataset routes ─────────────────────────────────────────────────────────


@router.post("", response_model=DatasetResponse, status_code=201)
async def create_dataset_route(
    body: DatasetCreate,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await ensure_registered_app_access(db, auth, body.app_id)
    try:
        return await dataset_service.create_dataset(
            db,
            tenant_id=auth.tenant_id,
            app_id=body.app_id,
            name=body.name,
            description=body.description,
            created_by=auth.user_id,
            visibility=body.visibility,
        )
    except dataset_service.DatasetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("", response_model=list[DatasetResponse])
async def list_datasets_route(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    app_id: str = Query(..., alias="appId"),
    visibility: Literal["all", "private", "shared"] = Query("all"),
):
    await ensure_registered_app_access(db, auth, app_id)
    return await dataset_service.list_datasets(
        db,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=app_id,
        visibility=visibility,
    )


@router.get("/{dataset_id}", response_model=DatasetDetailResponse)
async def get_dataset_route(
    dataset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_dataset(db, auth, dataset_id)
    return await dataset_service.get_dataset(
        db, tenant_id=auth.tenant_id, dataset_id=dataset_id,
    )


@router.patch("/{dataset_id}", response_model=DatasetDetailResponse)
async def update_dataset_route(
    dataset_id: uuid.UUID,
    body: DatasetUpdate,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_dataset(db, auth, dataset_id, action="edit")
    try:
        return await dataset_service.update_dataset(
            db,
            tenant_id=auth.tenant_id,
            dataset_id=dataset_id,
            name=body.name,
            description=body.description,
            visibility=body.visibility,
        )
    except dataset_service.DatasetConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset_route(
    dataset_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_dataset(db, auth, dataset_id, action="edit")
    try:
        await dataset_service.delete_dataset(
            db, tenant_id=auth.tenant_id, dataset_id=dataset_id,
        )
    except dataset_service.DatasetNotFound:
        raise HTTPException(status_code=404, detail="dataset not found")
    except dataset_service.DatasetInUse as exc:
        raise HTTPException(status_code=409, detail=_format_in_use_detail(exc))
    return Response(status_code=204)


# ─── version routes ─────────────────────────────────────────────────────────


@router.post(
    "/{dataset_id}/versions",
    response_model=DatasetVersionResponse,
    status_code=201,
)
async def import_version_route(
    dataset_id: uuid.UUID,
    file: UploadFile = File(...),
    id_strategy: str = Form(...),
    id_column: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    auth: AuthContext = require_permission('orchestration:manage'),
):
    await _load_and_gate_dataset(db, auth, dataset_id, action="edit")

    # Outer guard: reject upload bodies > 50 MB before parsing. The parser
    # then enforces the 20k row cap (CsvImportError -> 400 below).
    declared_size = getattr(file, "size", None)
    if isinstance(declared_size, int) and declared_size > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="csv upload exceeds 50MB limit")

    raw = await file.read()
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="csv upload exceeds 50MB limit")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="csv must be UTF-8 encoded")

    buf = io.StringIO(text)
    try:
        return await dataset_service.import_version(
            db,
            tenant_id=auth.tenant_id,
            dataset_id=dataset_id,
            file_handle=buf,
            source_filename=file.filename,
            source_byte_size=len(raw),
            id_strategy=id_strategy,
            id_column=id_column,
            imported_by=auth.user_id,
        )
    except dataset_service.DatasetNotFound:
        raise HTTPException(status_code=404, detail="dataset not found")
    except CsvImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get(
    "/{dataset_id}/versions/{version_id}", response_model=DatasetVersionResponse,
)
async def get_version_route(
    dataset_id: uuid.UUID,
    version_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
    sample_rows: int = Query(0, alias="sampleRows"),
):
    if sample_rows < 0 or sample_rows > 50:
        raise HTTPException(
            status_code=400, detail="sampleRows must be between 0 and 50",
        )
    await _load_and_gate_dataset(db, auth, dataset_id)
    try:
        return await dataset_service.get_version(
            db,
            tenant_id=auth.tenant_id,
            dataset_id=dataset_id,
            version_id=version_id,
            sample_rows=sample_rows,
        )
    except dataset_service.DatasetNotFound:
        raise HTTPException(status_code=404, detail="dataset version not found")


@router.delete("/{dataset_id}/versions/{version_id}", status_code=204)
async def delete_version_route(
    dataset_id: uuid.UUID,
    version_id: uuid.UUID,
    auth: AuthContext = require_permission('orchestration:manage'),
    db: AsyncSession = Depends(get_db),
):
    await _load_and_gate_dataset(db, auth, dataset_id, action="edit")
    try:
        await dataset_service.delete_version(
            db,
            tenant_id=auth.tenant_id,
            dataset_id=dataset_id,
            version_id=version_id,
        )
    except dataset_service.DatasetNotFound:
        raise HTTPException(status_code=404, detail="dataset version not found")
    except dataset_service.DatasetInUse as exc:
        raise HTTPException(status_code=409, detail=_format_in_use_detail(exc))
    return Response(status_code=204)
