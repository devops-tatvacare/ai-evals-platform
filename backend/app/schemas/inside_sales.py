"""Schemas for Inside Sales API."""

from datetime import datetime
from typing import Optional
from pydantic import Field
from app.schemas.base import CamelModel


class CallRecord(CamelModel):
    activity_id: str
    prospect_id: str
    agent_name: str
    agent_email: str
    event_code: int
    direction: str
    status: str
    call_start_time: str
    duration_seconds: int
    recording_url: str
    phone_number: str
    display_number: str
    call_notes: str
    call_session_id: str
    created_on: str
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
    prospect_id: str
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
    prospect_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    prospect_stage: str
    city: Optional[str] = None
    age_group: Optional[str] = None
    condition: Optional[str] = None
    hba1c_band: Optional[str] = None
    intent_to_pay: Optional[str] = None
    agent_name: Optional[str] = None
    rnr_count: int = 0
    answered_count: int = 0
    total_dials: int = 0
    connect_rate: Optional[float] = None      # None when total_dials == 0
    frt_seconds: Optional[int] = None         # None when null source or negative delta
    lead_age_days: int = 0
    days_since_last_contact: Optional[int] = None  # None when no activity yet
    mql_score: int = 0
    mql_signals: dict[str, bool] = Field(default_factory=dict)
    created_on: str
    last_activity_on: Optional[str] = None
    source: Optional[str] = None
    source_campaign: Optional[str] = None
    plan_name: Optional[str] = None
    plan: LeadPlanPurchase = Field(default_factory=LeadPlanPurchase)


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
    agent_name: Optional[str] = None
    duration_seconds: int = 0
    status: str
    recording_url: Optional[str] = None
    eval_score: Optional[float] = None
    is_counseling: bool = False              # duration_seconds >= 600


class LeadDetailFullResponse(CamelModel):
    # Profile
    prospect_id: str
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
    agent_name: Optional[str] = None
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
