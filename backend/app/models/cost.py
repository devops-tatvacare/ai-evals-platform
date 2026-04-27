"""LLM usage + cost tracking ORM models.

These tables back the Phase 1 fact pipeline and the pricing data Phase 4 will
consume. Only the schema definitions + indexes live here; recording logic and
pricing resolution live in ``app.services.cost_tracking``.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    ARRAY,
    Boolean,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LlmUsage(Base):
    """Unified append-only fact table for every model-generation call.

    Tool execution traces stay in ``agent_tool_logs`` / Sherlock runtime
    events. Only generation spans are persisted here.
    """

    __tablename__ = 'llm_usage'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='RESTRICT'),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Active app IDs only: voice-rx, kaira-bot, inside-sales. Non-app surfaces
    # (sherlock, report_builder, system_library) go in ``subsystem``.
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    subsystem: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Polymorphic ownership
    owner_type: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    parent_usage_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    model_family: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_surface: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage_index: Mapped[int | None] = mapped_column(Integer, nullable=True)

    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    cached_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    cached_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    cached_write_ttl: Mapped[str | None] = mapped_column(Text, nullable=True)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    tool_use_prompt_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text('0')
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer,
        Computed(
            'input_tokens + output_tokens + reasoning_tokens + cached_read_tokens '
            '+ cached_write_tokens + tool_use_prompt_tokens',
            persisted=True,
        ),
    )

    modality_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    audio_seconds: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(14, 8), nullable=False, server_default=text('0')
    )
    cost_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    pricing_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('model_pricing.id', ondelete='RESTRICT'),
        nullable=True,
    )
    pricing_fallback: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )

    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'ok'"))
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    finish_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    server_tool_usage: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    traffic_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index('idx_llm_usage_tenant_created', 'tenant_id', 'created_at'),
        Index('idx_llm_usage_tenant_app_created', 'tenant_id', 'app_id', 'created_at'),
        Index('idx_llm_usage_tenant_user_created', 'tenant_id', 'user_id', 'created_at'),
        Index('idx_llm_usage_owner', 'owner_type', 'owner_id'),
        Index('idx_llm_usage_provider_model_created', 'provider', 'model', 'created_at'),
        Index(
            'uq_llm_usage_idempotency_key',
            'idempotency_key',
            unique=True,
            postgresql_where=text('idempotency_key IS NOT NULL'),
        ),
    )


class ModelPricing(Base):
    """Effective-dated billing rates.

    Global (not tenant-scoped). Immutable history: new rate = close the current
    row (``effective_to = now()``) and insert a new row.
    """

    __tablename__ = 'model_pricing'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    input_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    cached_read_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    cache_write_5m_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    cache_write_1h_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    output_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    reasoning_per_1m_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, server_default=text('0')
    )
    audio_input_per_1m_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    audio_input_per_minute_usd: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    image_input_per_1m_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    server_tool_prices: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'USD'"))
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'manual'"))
    source_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint('provider', 'model', 'effective_from', name='uq_model_pricing_effective'),
        Index('idx_model_pricing_lookup', 'provider', 'model', 'effective_from'),
        Index('idx_model_pricing_source_snapshot', 'source_snapshot_id'),
    )


class ModelAlias(Base):
    """Map observed model strings to canonical ``model_pricing.model`` keys.

    Live pricing lookup consults this table when an exact match fails. Rows can
    be tenant-scoped (a tenant's Azure deployment name maps to a base model) or
    system-wide (``tenant_id = NULL``; applies to every tenant unless they
    override with their own row).

    Resolution order: tenant-specific > system-wide > no alias.
    """

    __tablename__ = 'model_aliases'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=True,
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    observed: Mapped[str] = mapped_column(Text, nullable=False)
    canonical: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint('tenant_id', 'provider', 'observed', name='uq_model_alias_scope'),
        Index('idx_model_alias_lookup', 'provider', 'observed', 'tenant_id'),
    )


class LlmUsageDailyRollup(Base):
    """Aggregate cache for overview/spend/efficiency surfaces only.

    Never the source of truth for entity drill-down, raw calls, or CostChip
    lookups — those read ``llm_usage`` directly.
    """

    __tablename__ = 'llm_usage_daily_rollup'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    call_purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'ok'"))

    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    cached_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    cached_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    reasoning_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    tool_use_prompt_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text('0')
    )
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))

    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(14, 8), nullable=False, server_default=text('0')
    )
    call_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))

    __table_args__ = (
        UniqueConstraint(
            'day',
            'tenant_id',
            'app_id',
            'user_id',
            'provider',
            'model',
            'call_purpose',
            'status',
            name='uq_llm_usage_daily_rollup_scope',
        ),
        Index('idx_llm_usage_daily_rollup_tenant_day', 'tenant_id', 'day'),
        Index('idx_llm_usage_daily_rollup_tenant_app_day', 'tenant_id', 'app_id', 'day'),
    )


class ModelsDevCatalog(Base):
    """Normalized snapshot of model metadata from models.dev.

    One row per (provider, model). Refreshes upsert in place. Billing data
    lives in ``model_pricing``; this table only tracks model capability
    metadata.
    """

    __tablename__ = 'models_dev_catalog'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_key: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    family: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    supports_reasoning: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )
    supports_tool_call: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )
    supports_attachment: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )
    modalities_input: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    modalities_output: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    open_weights: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text('false')
    )
    release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_updated_source: Mapped[date | None] = mapped_column(Date, nullable=True)
    knowledge_cutoff: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    last_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint('provider', 'model', name='uq_models_dev_catalog_provider_model'),
        Index('idx_models_dev_catalog_source_id', 'provider_key', 'model_id'),
        Index('idx_models_dev_catalog_status', 'status'),
    )


class ModelsDevSnapshot(Base):
    """One row per models.dev refresh run."""

    __tablename__ = 'models_dev_snapshots'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_url: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'https://models.dev/api.json'")
    )
    source_etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_hash: Mapped[str] = mapped_column(Text, nullable=False)
    model_count: Mapped[int] = mapped_column(Integer, nullable=False)
    added_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    unchanged_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    removed_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        Index('idx_models_dev_snapshots_fetched_at', 'fetched_at'),
        Index('idx_models_dev_snapshots_payload_hash', 'payload_hash'),
    )
