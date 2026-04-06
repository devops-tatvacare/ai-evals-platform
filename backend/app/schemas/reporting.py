"""Reporting persistence schemas for phases 2-3."""

import uuid
from datetime import datetime

from app.models.mixins.shareable import Visibility
from app.schemas.base import CamelORMModel
from app.schemas.visibility import VisibilityOutputMixin


class ReportConfigResponse(VisibilityOutputMixin, CamelORMModel):
    id: uuid.UUID
    app_id: str
    report_id: str
    scope: str
    name: str
    description: str
    status: str
    is_default: bool
    visibility: Visibility
    shared_by: uuid.UUID | None = None
    shared_at: datetime | None = None
    presentation_config: dict
    narrative_config: dict
    export_config: dict
    default_report_run_visibility: Visibility
    version: int
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ReportRunResponse(CamelORMModel):
    id: uuid.UUID
    app_id: str
    report_id: str
    scope: str
    source_eval_run_id: uuid.UUID | None = None
    status: str
    job_id: uuid.UUID | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    report_config_version: int | None = None
    prompt_asset_version: str | None = None
    schema_asset_version: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ReportArtifactResponse(CamelORMModel):
    id: uuid.UUID
    report_run_id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    report_id: str
    scope: str
    artifact_data: dict
    computed_at: datetime
    content_hash: str | None = None
    source_run_count: int | None = None
    latest_source_run_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
