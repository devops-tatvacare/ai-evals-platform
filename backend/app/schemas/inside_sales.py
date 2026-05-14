"""Schemas for Inside Sales API."""

from datetime import datetime
from typing import Any, Optional
from pydantic import Field
from app.schemas.base import CamelModel


class CallRecord(CamelModel):
    """One ``fact_lead_activity`` (call) row in the manifest
    ``{structural columns + attributes JSONB}`` shape (Phase 11E).

    Typed structural columns at the top level; the call-specific payload
    (direction, status, duration_seconds, recording_url, phone_number,
    display_number, call_notes, call_session_id, rep_email, has_recording,
    event_code) lives in ``attributes`` and is rendered generically by the
    frontend against ``useCrmSchema``. PII keys inside ``attributes`` are
    masked by the role-aware serializer."""
    activity_id: str
    lead_id: str
    rep_name: Optional[str] = None
    event_code: Optional[int] = None
    activity_type: str
    call_start_time: str
    created_on: str
    attributes: dict[str, Any] = Field(default_factory=dict)
    last_eval_score: Optional[float] = None
    eval_count: int = 0


class CollectionFreshness(CamelModel):
    last_synced_at: datetime | None = None
    sync_in_progress: bool = False
    stale: bool = True


class CallListResponse(CamelModel):
    calls: list[CallRecord]
    total: int
    page: int
    page_size: int
    freshness: CollectionFreshness = Field(default_factory=CollectionFreshness)


class LeadDetailResponse(CamelModel):
    lead_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class LeadPlanPurchase(CamelModel):
    """Plan-purchase surface derived from LSQ ``mx_*`` fields.

    All optional — a lead in a pre-converted stage will have these null.
    Values are stored on the ``analytics.crm_lead_record.raw_payload`` JSONB
    blob and extracted at API-response time.
    """
    plan_name: Optional[str] = None
    duration_or_quantity: Optional[str] = None
    program_price: Optional[str] = None
    invoice_amount: Optional[str] = None
    payment_id: Optional[str] = None
    payment_date_and_time: Optional[str] = None
    plan_assigned_at: Optional[str] = None
    sign_up_date: Optional[str] = None
    program_start_date: Optional[str] = None
    program_end_date: Optional[str] = None
    plan_includes_cgm: Optional[str] = None
    cgm: Optional[str] = None
    cgm_brand: Optional[str] = None
    sensor_count: Optional[str] = None
    transmitter_count: Optional[str] = None
    bca_device: Optional[str] = None
    nutraceuticals_sold: Optional[str] = None
    sales_team: Optional[str] = None
    device_awb_number: Optional[str] = None
    lead_conversion_date: Optional[str] = None


class LeadListRecord(CamelModel):
    """One ``dim_lead`` row in the manifest ``{structural columns +
    attributes JSONB}`` shape (Phase 11E).

    Identity + current-state are typed structural columns (the
    ``firstName/lastName/phone/email/city`` PII columns are masked by the
    role-aware serializer). ``attributesAtFirstSeen`` is the frozen
    lead-profile snapshot (age_group, condition, hba1c_band, intent_to_pay,
    source_campaign, ...); ``attributes`` is the mutable current-state bag
    (plan_name, ...). MQL is assembled from ``fact_lead_signal``. The
    frontend renders the bags generically against ``useCrmSchema``."""
    lead_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    prospect_stage: Optional[str] = None
    rep_name: Optional[str] = None
    source: Optional[str] = None
    created_on: str
    mql_score: Optional[int] = None
    mql_signals: dict[str, bool] = Field(default_factory=dict)
    attributes_at_first_seen: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)


class LeadListResponse(CamelModel):
    leads: list[LeadListRecord]
    total: int
    page: int
    page_size: int
    freshness: CollectionFreshness = Field(default_factory=CollectionFreshness)


class CollectionRefreshRequest(CamelModel):
    # ``sync_mode`` lets ops trigger either a one-shot 90-day bootstrap
    # (``date_range`` with explicit ``dateFrom``/``dateTo``) or an
    # on-demand delta (``incremental``). ``bootstrap`` is sugar for a
    # 90-day ``date_range`` with the plan's defaults.
    sync_mode: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    event_codes: str | None = None
    overlap_minutes: int | None = None


class CollectionRefreshResponse(CamelModel):
    job_id: str
    source_family: str
    sync_mode: str
    status: str


class CollectionRunEntry(CamelModel):
    """One row in the last-N ``analytics.log_crm_source_sync`` list surfaced to ops."""
    id: str
    sync_mode: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    watermark_from: str | None = None
    watermark_to: str | None = None
    records_scanned: int = 0
    records_upserted: int = 0
    records_failed: int = 0
    is_scheduled_run: bool = False
    error_message: str | None = None


class CollectionRunsResponse(CamelModel):
    source_family: str
    runs: list[CollectionRunEntry]


class CollectionSyncStatus(CamelModel):
    """Durable freshness signal for a collection. Read from ``analytics.log_crm_source_sync``.

    ``lastSuccessAt`` is the most recent ``completed`` sync. ``lastAttemptAt``
    is the most recent attempt regardless of outcome. ``lastStatus`` /
    ``lastError`` describe that attempt so the UI can render failure state
    after a page reload (frontend cache is not durable across reloads).
    ``syncInProgress`` is true when any sync is currently ``running``.
    """
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_status: str | None = None  # 'running' | 'completed' | 'failed' | 'cancelled'
    last_error: str | None = None
    sync_in_progress: bool = False


class LeadEvalHistoryEntry(CamelModel):
    """One evaluation record for a lead's call history."""
    id: str
    thread_id: str
    run_id: str
    result: dict                    # raw evaluator JSON
    created_at: str


class LeadCallRecord(CamelModel):
    activity_id: str
    call_time: str
    rep_name: Optional[str] = None
    duration_seconds: int = 0
    status: str
    recording_url: Optional[str] = None
    eval_score: Optional[float] = None
    is_counseling: bool = False              # duration_seconds >= 600


class LeadDetailFullResponse(CamelModel):
    # Profile
    lead_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    prospect_stage: str
    city: Optional[str] = None
    age_group: Optional[str] = None
    condition: Optional[str] = None
    hba1c_band: Optional[str] = None
    blood_sugar_band: Optional[str] = None
    diabetes_duration: Optional[str] = None
    current_management: Optional[str] = None
    goal: Optional[str] = None
    intent_to_pay: Optional[str] = None
    job_title: Optional[str] = None
    preferred_call_time: Optional[str] = None
    rep_name: Optional[str] = None
    source: Optional[str] = None
    source_campaign: Optional[str] = None
    created_on: str
    # MQL
    mql_score: int = 0
    mql_signals: dict[str, bool] = Field(default_factory=dict)
    # Computed metrics
    frt_seconds: Optional[int] = None
    total_dials: int = 0
    connect_rate: Optional[float] = None
    counseling_count: int = 0
    counseling_rate: Optional[float] = None
    callback_adherence_seconds: Optional[int] = None
    lead_age_days: int = 0
    days_since_last_contact: Optional[int] = None
    # Call history
    call_history: list[LeadCallRecord] = Field(default_factory=list)
    history_truncated: bool = False
    # Eval history
    eval_history: list[LeadEvalHistoryEntry] = Field(default_factory=list)
    # Plan-purchase surface. Null fields for pre-converted leads.
    plan: LeadPlanPurchase = Field(default_factory=LeadPlanPurchase)
