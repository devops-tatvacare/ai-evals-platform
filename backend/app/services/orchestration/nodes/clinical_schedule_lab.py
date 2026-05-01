"""clinical.schedule_lab — enqueues a lab order in log_clinical_action_outbox.

Phase 11 (Commit 2): emits ``success`` / ``exhausted`` under the configured
``attempt_policy``. The outbox row is still the integration in v1 — a
future EMR-sync worker reads pending rows and flips ``status='consumed'``.
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
    test_code: str = Field(..., description="Lab test code (LOINC or local).")
    test_name: str
    frequency: Literal["once", "monthly", "quarterly", "biannual", "annual"] = "once"
    notify_roles: list[Literal["care_manager", "physician", "pharmacist"]] = Field(
        default_factory=lambda: ["care_manager"]
    )
    urgency: Literal["routine", "urgent", "stat"] = "routine"
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


@register_node(workflow_type="clinical", node_type="clinical.schedule_lab")
class _Handler:
    node_type = "clinical.schedule_lab"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        def _payload_for(_rid: str, _payload: dict) -> dict:
            return {
                "test_code": config.test_code,
                "test_name": config.test_name,
                "frequency": config.frequency,
                "notify_roles": list(config.notify_roles),
                "urgency": config.urgency,
            }

        return await dispatch_outbox_with_attempt_policy(
            ctx=ctx,
            input_cohort=input_cohort,
            action_type="clinical.schedule_lab",
            idem_parts=["lab", config.test_code],
            outbox_payload_for=_payload_for,
            summary_extra={"test_code": config.test_code},
            attempt_policy=config.attempt_policy,
            node_label="clinical.schedule_lab",
        )
