"""clinical.assign_care_team_task — enqueues a care-team task in the outbox.

Phase 11 (Commit 2): emits ``success`` / ``exhausted`` under the configured
``attempt_policy``.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    attempt_policy_json_schema_extra,
)
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.nodes._clinical_outbox_dispatch import (
    dispatch_outbox_with_attempt_policy,
)


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    role: Literal["care_manager", "physician", "pharmacist", "nutritionist"] = "care_manager"
    task_label: str
    cadence: Literal["once", "weekly", "monthly"] = "once"
    sla_hours: int = 24
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


@register_node(workflow_type="clinical", node_type="clinical.assign_care_team_task")
class _Handler:
    node_type = "clinical.assign_care_team_task"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        def _payload_for(_rid: str, _payload: dict) -> dict:
            return {
                "role": config.role,
                "task_label": config.task_label,
                "cadence": config.cadence,
                "sla_hours": config.sla_hours,
            }

        return await dispatch_outbox_with_attempt_policy(
            ctx=ctx,
            input_cohort=input_cohort,
            action_type="clinical.assign_care_team_task",
            idem_parts=["care_task", config.task_label],
            outbox_payload_for=_payload_for,
            summary_extra={"role": config.role},
            attempt_policy=config.attempt_policy,
            node_label="clinical.assign_care_team_task",
        )
