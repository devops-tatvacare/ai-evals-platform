"""Platform-wide registry of schedule-enabled workloads.

A workload is a `(app_id, job_type)` pair that can be driven by the
scheduler. The registry also carries UI labels and the launch source
descriptor so the Create Schedule overlay knows which source list to show.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


LaunchSource = Literal["canonical_run", "canonical_config", "explicit_params"]


@dataclass(frozen=True)
class ScheduledWorkload:
    app_id: str
    job_type: str
    label: str
    description: str
    launch_source: LaunchSource = "explicit_params"
    source_list_endpoint: str | None = None
    default_params: dict[str, Any] = field(default_factory=dict)


_REGISTRY: list[ScheduledWorkload] = []


def register_workload(workload: ScheduledWorkload) -> None:
    """Register a schedule-enabled workload. Idempotent on (app_id, job_type)."""
    key = (workload.app_id, workload.job_type)
    for existing in _REGISTRY:
        if (existing.app_id, existing.job_type) == key:
            return
    _REGISTRY.append(workload)


def get_workloads() -> list[ScheduledWorkload]:
    return list(_REGISTRY)


def get_workload(app_id: str, job_type: str) -> ScheduledWorkload | None:
    for workload in _REGISTRY:
        if workload.app_id == app_id and workload.job_type == job_type:
            return workload
    return None


# Bootstrap the first registered workload: inside-sales CRM sync.
# Registered here (not via import side-effects elsewhere) so the registry is
# deterministic and does not depend on runner import order.
register_workload(
    ScheduledWorkload(
        app_id="inside-sales",
        job_type="sync-external-source",
        label="Inside Sales CRM sync",
        description=(
            "Refreshes the trailing 7-day Inside Sales CRM data from LSQ."
        ),
        launch_source="explicit_params",
        source_list_endpoint=None,
        default_params={
            "app_id": "inside-sales",
            "source_system": "lsq",
            "sync_mode": "incremental",
        },
    ),
)
