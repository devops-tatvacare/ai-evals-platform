"""crm.lsq_update_stage — sets ProspectStage on each recipient via LsqWriter.

Phase 10 commit 2: per-tenant LSQ credentials come from
``ctx.connections.lsq(config.connection_id)``; the resolver builds an
``LsqWriter`` bound to the decrypted config. Existing module-level
``lsq_client`` rate limiter is reused via the writer.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.services.orchestration.integrations.lsq import LsqWriteError
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    connection_id: uuid.UUID = Field(
        ...,
        json_schema_extra={"x-type": "connection_picker", "x-provider": "lsq"},
    )
    target_stage: str  # e.g. "Slot Confirmed"


@register_node(workflow_type="crm", node_type="crm.lsq_update_stage")
class _Handler:
    node_type = "crm.lsq_update_stage"
    config_schema = _Config
    output_edges = ["success", "failed"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.lsq_update_stage requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        writer = await ctx.connections.lsq(config.connection_id)

        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []
        async for rid, _payload in input_cohort:
            idem = ctx.idempotency_key(rid, "lsq_stage", config.target_stage)
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="lsq",
                    action_type="lsq_stage_updated",
                    idempotency_key=idem,
                    payload={"prospect_id": rid, "target_stage": config.target_stage},
                )
            ])
            r = results[0]
            if r.status != "pending":
                (success if r.status == "success" else failed).append(
                    RecipientOutcome(recipient_id=rid)
                )
                continue
            try:
                await writer.update_stage(prospect_id=rid, stage=config.target_stage)
                await ctx.update_action_result(
                    r.action_id, status="success",
                    response={"stage": config.target_stage},
                )
                success.append(RecipientOutcome(recipient_id=rid))
            except LsqWriteError as exc:
                await ctx.update_action_result(r.action_id, status="failed", error=str(exc))
                failed.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "target_stage": config.target_stage,
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )
