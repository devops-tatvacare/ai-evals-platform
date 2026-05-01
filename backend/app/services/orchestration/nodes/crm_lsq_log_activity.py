"""crm.lsq_log_activity — POSTs ProspectActivity.Create per recipient via LsqWriter.

Phase 10 commit 2: per-tenant LSQ credentials come from
``ctx.connections.lsq(config.connection_id)``.
"""
from __future__ import annotations

import uuid
from typing import Any

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
    activity_event_code: int  # e.g. 212 — configured per LSQ tenant
    note: str                 # supports {{var}} substitution against payload
    fields: list[dict[str, Any]] = Field(default_factory=list)


def _render(template: str, vars_: dict[str, Any]) -> str:
    out = template
    for k, v in vars_.items():
        out = out.replace("{{" + k + "}}", str(v) if v is not None else "")
    return out


@register_node(workflow_type="crm", node_type="crm.lsq_log_activity")
class _Handler:
    node_type = "crm.lsq_log_activity"
    config_schema = _Config
    output_edges = ["success", "failed"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.lsq_log_activity requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        writer = await ctx.connections.lsq(config.connection_id)

        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []
        async for rid, payload in input_cohort:
            note = _render(config.note, payload)
            idem = ctx.idempotency_key(
                rid, "lsq_activity", str(config.activity_event_code)
            )
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="lsq",
                    action_type="lsq_activity_logged",
                    idempotency_key=idem,
                    payload={
                        "prospect_id": rid,
                        "activity_event": config.activity_event_code,
                        "note": note,
                        "fields": config.fields,
                    },
                )
            ])
            r = results[0]
            if r.status != "pending":
                (success if r.status == "success" else failed).append(
                    RecipientOutcome(recipient_id=rid)
                )
                continue
            try:
                await writer.log_activity(
                    prospect_id=rid,
                    activity_event=config.activity_event_code,
                    note=note,
                    fields=config.fields,
                )
                await ctx.update_action_result(
                    r.action_id, status="success", response={"note": note},
                )
                success.append(RecipientOutcome(recipient_id=rid))
            except LsqWriteError as exc:
                await ctx.update_action_result(r.action_id, status="failed", error=str(exc))
                failed.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "activity_event": config.activity_event_code,
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )
