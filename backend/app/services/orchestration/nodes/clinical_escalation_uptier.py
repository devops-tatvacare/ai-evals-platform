"""clinical.escalation_uptier — escalates to physician/specialist via the outbox.

Phase 11 (Commit 2): emits ``success`` / ``exhausted`` under the configured
``attempt_policy``. ``category='escalation'`` keeps the run-canvas overlay
colour-coding distinct from plain action nodes.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

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
    target_role: Literal["physician", "specialist", "ed", "crisis_team"] = "physician"
    urgency: Literal["same_day", "48h", "next_review", "next_month"] = "same_day"
    reason: str
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


@register_node(workflow_type="clinical", node_type="clinical.escalation_uptier")
class _Handler:
    node_type = "clinical.escalation_uptier"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "escalation"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        def _payload_for(_rid: str, _payload: dict) -> dict:
            return {
                "target_role": config.target_role,
                "urgency": config.urgency,
                "reason": config.reason,
            }

        return await dispatch_outbox_with_attempt_policy(
            ctx=ctx,
            input_cohort=input_cohort,
            action_type="clinical.escalation_uptier",
            idem_parts=["escalation", config.urgency, config.target_role],
            outbox_payload_for=_payload_for,
            summary_extra={"target_role": config.target_role, "urgency": config.urgency},
            attempt_policy=config.attempt_policy,
            node_label="clinical.escalation_uptier",
        )
