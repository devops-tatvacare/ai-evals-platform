"""clinical.emr_write — enqueues a structured note/observation for the EMR.

Renders the note template against recipient payload via simple ``{{var}}``
substitution; downstream EMR sync writes the note to the actual EMR.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    note_type: Literal[
        "progress_note", "observation", "encounter", "care_plan_update"
    ] = "progress_note"
    template: str = Field(..., description="Note body; supports {{var}} from payload.")
    structured_fields: dict[str, Any] = Field(default_factory=dict)


def _render(template: str, payload: dict[str, Any]) -> str:
    out = template
    for k, v in payload.items():
        out = out.replace("{{" + k + "}}", "" if v is None else str(v))
    return out


@register_node(workflow_type="clinical", node_type="clinical.emr_write")
class _Handler:
    node_type = "clinical.emr_write"
    config_schema = _Config
    output_edges = ["success", "failed"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.services.clinical_outbox is None:
            raise RuntimeError("clinical.emr_write requires ClinicalOutboxWriter")

        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []
        async for rid, payload in input_cohort:
            note = _render(config.template, payload)
            idem = ctx.idempotency_key(rid, "emr", config.note_type)
            outbox_payload = {
                "note_type": config.note_type,
                "note": note,
                "structured_fields": dict(config.structured_fields),
            }
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="system",
                    action_type="clinical.emr_write",
                    idempotency_key=idem,
                    # Channel-agnostic recipient handle (migration 0027).
                    # ``rid`` is the patient identifier for clinical channels.
                    payload={"contact": rid, **outbox_payload},
                )
            ])
            r = results[0]
            if r.status != "pending":
                (success if r.status == "success" else failed).append(
                    RecipientOutcome(recipient_id=rid)
                )
                continue
            try:
                outbox_row_id = await ctx.services.clinical_outbox.enqueue(
                    ctx.db,
                    tenant_id=ctx.tenant_id,
                    app_id=ctx.app_id,
                    recipient_id=rid,
                    action_type="clinical.emr_write",
                    idempotency_key=idem,
                    payload=outbox_payload,
                )
                await ctx.update_action_result(
                    r.action_id, status="success",
                    response={
                        "queued": True,
                        "outbox_row_id": str(outbox_row_id) if outbox_row_id else None,
                    },
                    # Outbox row id is the channel-agnostic correlation
                    # handle for clinical actions.
                    provider_correlation_id=str(outbox_row_id) if outbox_row_id else None,
                )
                success.append(RecipientOutcome(recipient_id=rid))
            except Exception as exc:  # pragma: no cover — defensive
                await ctx.update_action_result(
                    r.action_id, status="failed", error=repr(exc)
                )
                failed.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "note_type": config.note_type,
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )
