"""Pydantic request/response schemas for /api/orchestration/datasets.

Schemas describe shape only. Tenant scoping, version increment, and
workflow-binding checks live in
``app.services.orchestration.api.datasets``. CSV parsing lives in
``app.services.orchestration.datasets.csv_importer``.

Naming follows project convention: snake_case in Python, camelCase on the
wire via ``CamelModel`` / ``CamelORMModel`` from ``app.schemas.base``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from app.schemas.base import CamelModel, CamelORMModel


class DatasetCreate(CamelModel):
    app_id: str
    name: str
    description: Optional[str] = None


class DatasetVersionResponse(CamelORMModel):
    id: uuid.UUID
    dataset_id: uuid.UUID
    version_number: int
    source_type: str
    source_filename: Optional[str]
    source_byte_size: Optional[int]
    row_count: int
    id_strategy: str
    id_column: Optional[str]
    schema_descriptor: dict[str, Any]
    imported_by: uuid.UUID
    imported_at: datetime
    # Populated only by ``get_version`` when ``sample_rows > 0`` is requested.
    # Each entry is ``{"recipient_id": str, "payload": dict}``.
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


class DatasetResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    name: str
    description: Optional[str]
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Inlined latest version (or None when no version has been imported yet).
    # Used by the list endpoint so the table can show "row count / imported_at"
    # without a per-row round-trip.
    latest_version: Optional[DatasetVersionResponse] = None


class DatasetDetailResponse(DatasetResponse):
    # Full version history, ordered version_number DESC.
    versions: list[DatasetVersionResponse] = Field(default_factory=list)
