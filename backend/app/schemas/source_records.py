"""Typed schemas for synced source records served from the generic CRM tables."""

import uuid
from datetime import datetime

from app.schemas.base import CamelORMModel


class SourceRecordRowBase(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    source_system: str
    source_record_hash: str | None = None
    first_synced_at: datetime
    last_synced_at: datetime
    last_seen_in_source_at: datetime
    last_synced_by_user_id: uuid.UUID | None = None
    raw_payload: dict | None = None
    created_at: datetime
    updated_at: datetime


class SourceCallRecordRow(SourceRecordRowBase):
    activity_id: str
    prospect_id: str
    agent_id: str | None = None
    agent_name: str | None = None
    agent_name_normalized: str | None = None
    agent_email: str | None = None
    event_code: int
    direction: str
    status: str | None = None
    status_normalized: str | None = None
    call_started_at: datetime | None = None
    duration_seconds: int
    has_recording: bool
    recording_url: str | None = None
    phone_number: str | None = None
    display_number: str | None = None
    call_notes: str | None = None
    call_session_id: str | None = None
    created_on: datetime | None = None


class SourceLeadRecordRow(SourceRecordRowBase):
    prospect_id: str
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    prospect_stage: str
    prospect_stage_normalized: str | None = None
    city: str | None = None
    city_normalized: str | None = None
    age_group: str | None = None
    condition: str | None = None
    condition_normalized: str | None = None
    hba1c_band: str | None = None
    intent_to_pay: str | None = None
    agent_name: str | None = None
    agent_name_normalized: str | None = None
    source: str | None = None
    source_campaign: str | None = None
    created_on: datetime | None = None
    first_activity_on: datetime | None = None
    last_activity_on: datetime | None = None
    rnr_count: int
    answered_count: int
    total_dials: int
    connect_rate: float | None = None
    frt_seconds: int | None = None
    lead_age_days: int
    days_since_last_contact: int | None = None
    mql_score: int
    mql_signals: dict


class SourceSyncRunResponse(CamelORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    app_id: str
    source_system: str
    source_family: str
    sync_mode: str
    status: str
    requested_by_user_id: uuid.UUID | None = None
    targeted_source_id: str | None = None
    watermark_from: str | None = None
    watermark_to: str | None = None
    records_scanned: int
    records_upserted: int
    records_failed: int
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    details: dict
    created_at: datetime
    updated_at: datetime
