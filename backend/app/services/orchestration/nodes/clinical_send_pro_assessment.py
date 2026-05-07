"""clinical.send_pro_assessment — enqueues a PRO instrument link via the outbox.

Phase 11 (Commit 2): emits ``success`` / ``exhausted`` under the configured
``attempt_policy``. Outbox-backed; no live SMS/email sending in v1.
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

    instrument: Literal["PHQ9", "DDS", "MMAS", "EQ5D", "PROMIS"] = "PHQ9"
    delivery_channel: Literal["sms", "email", "wa"] = "wa"
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


@register_node(workflow_type="clinical", node_type="clinical.send_pro_assessment")
class _Handler:
    node_type = "clinical.send_pro_assessment"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        def _payload_for(_rid: str, _payload: dict) -> dict:
            return {
                "instrument": config.instrument,
                "delivery_channel": config.delivery_channel,
            }

        return await dispatch_outbox_with_attempt_policy(
            ctx=ctx,
            input_cohort=input_cohort,
            action_type="clinical.send_pro_assessment",
            idem_parts=["pro", config.instrument],
            outbox_payload_for=_payload_for,
            summary_extra={"instrument": config.instrument},
            attempt_policy=config.attempt_policy,
            node_label="clinical.send_pro_assessment",
        )
