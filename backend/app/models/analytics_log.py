"""Analytics job logs, agent tool logs, and query cache."""
import uuid
from datetime import datetime
from sqlalchemy import Text, Integer, Float, Boolean, ForeignKey, DateTime, Index, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TenantUserMixin


class AnalyticsJobLog(Base):
    __tablename__ = "analytics_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.eval_runs.id", ondelete="SET NULL"), nullable=True
    )
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform.tenants.id", ondelete="CASCADE"), nullable=False
    )
    job_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    rows_inserted: Mapped[int | None] = mapped_column(Integer, default=0)
    rows_updated: Mapped[int | None] = mapped_column(Integer, default=0)
    rows_deleted: Mapped[int | None] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, server_default=text("'{}'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_aj_tenant", "tenant_id", created_at.desc()),
        Index("idx_aj_run", "run_id"),
        Index("idx_aj_status", "status"),
    )


class AgentToolLog(Base, TenantUserMixin):
    __tablename__ = "agent_tool_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    db_session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str] = mapped_column(Text, nullable=False)
    arguments: Mapped[dict | None] = mapped_column(JSONB, server_default=text("'{}'"))
    generated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    validated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    execution_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_hit: Mapped[bool | None] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_atl_tenant", "tenant_id", created_at.desc()),
        Index("idx_atl_tool", "tool_name", "status"),
        Index("idx_atl_session", "db_session_id"),
    )


class AnalyticsQueryCache(Base):
    __tablename__ = "analytics_query_cache"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sql_hash: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    app_id: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("sql_hash", "tenant_id", "app_id"),
        Index("idx_aqc_lookup", "sql_hash", "tenant_id", "app_id", "expires_at"),
    )
