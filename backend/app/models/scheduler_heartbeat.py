"""Per-worker scheduler tick heartbeat.

One row per worker process running the scheduler tick loop. The engine
upserts its row at the end of every tick so operators can alert on
``max(last_tick_at) < now() - N`` (stalled ticker, no worker has the
scheduler turned on, etc.).

Not tenant-scoped: this is infra metadata, owned by the platform.
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SchedulerWorkerHeartbeat(Base):
    __tablename__ = "scheduler_worker_heartbeats"

    # hostname:pid:shortuuid — stable for the lifetime of a worker
    # process. Matches the shape used by ``job_worker.WORKER_INSTANCE_ID``
    # so cost/observability queries can join on the same dimension.
    worker_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_tick_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    tick_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Optional identifier of the process's container/pod, pulled from
    # env when present. Purely informational.
    host_label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Fired-job counter mirror of ``tick_count`` — useful for sanity:
    # ``(fired_count / tick_count)`` approximates schedule density.
    fired_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # Non-PK surrogate id is intentionally absent: the worker_id IS the key.
    __table_args__ = ({"schema": "platform"},)


__all__ = ["SchedulerWorkerHeartbeat"]
