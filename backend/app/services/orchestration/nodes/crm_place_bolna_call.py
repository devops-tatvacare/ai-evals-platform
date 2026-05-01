"""crm.place_bolna_call — outbound AI voice call via the configured Bolna account.

Phase 11 (Commit 2): the node declares a Phase-11 contract with workflow-visible
``success`` / ``exhausted`` outputs. Per-attempt retries are governed by the
node's ``attempt_policy`` (the helper runs them inline; see
:mod:`attempt_policy` for the backoff caveat). Bolna's own provider-side
``retry_config`` continues to govern *within-call* dial retries.

Phase 10: the Bolna service is resolved per-call from
``ctx.connections.bolna(config.connection_id)``. ``variable_mappings``
overrides the template's ``user_data_map`` and falls back to the template
default when empty.

Action row: ``action_type='bolna_queued'``. The Bolna ``call_id`` (when
returned) is emitted into payload as ``bolna_call_id`` so inbound result
webhooks can correlate back to the parked recipient.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    attempt_policy_json_schema_extra,
    run_with_attempt_policy,
)
from app.services.orchestration.connections.variable_mapping import (
    apply_variable_mappings_dict,
)
from app.services.orchestration.integrations.bolna import BolnaServiceError
from app.services.orchestration.integrations.template_resolver import (
    TemplateNotFound,
    resolve_template,
)
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    connection_id: uuid.UUID = Field(
        ...,
        json_schema_extra={"x-type": "connection_picker", "x-provider": "bolna"},
    )
    template_slug: str
    override_agent_id: Optional[str] = None
    phone_field: str = "phone"  # E.164 with '+'
    variable_mappings: list[dict[str, Any]] = Field(
        default_factory=list,
        json_schema_extra={"x-type": "variable_mapping_list"},
    )
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


def _classify_bolna_error(exc: BaseException) -> Optional[str]:
    if isinstance(exc, BolnaServiceError):
        return "bolna_service_error"
    return None


@register_node(workflow_type="crm", node_type="crm.place_bolna_call")
class _Handler:
    node_type = "crm.place_bolna_call"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.place_bolna_call requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        service = await ctx.connections.bolna(config.connection_id)

        try:
            tmpl = await resolve_template(
                ctx.db, tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                channel="bolna", slug=config.template_slug,
            )
        except TemplateNotFound as exc:
            raise RuntimeError(f"crm.place_bolna_call: {exc}") from exc

        template_user_map = tmpl.payload_schema.get("user_data_map", []) or []
        agent_id = config.override_agent_id or tmpl.payload_schema["agent_id"]
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        on_exhausted = config.attempt_policy.on_exhausted_output_id

        async for rid, payload in input_cohort:
            phone = payload.get(config.phone_field)
            if not phone:
                exhausted.append(RecipientOutcome(recipient_id=rid))
                continue

            user_data = apply_variable_mappings_dict(
                config.variable_mappings,
                payload,
                template_fallback=template_user_map,
            )
            idem = ctx.idempotency_key(rid, "bolna", config.template_slug)
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="bolna",
                    action_type="bolna_queued",
                    idempotency_key=idem,
                    payload={
                        "agent_id": agent_id,
                        "recipient_phone": phone,
                        "user_data": user_data,
                        "retry_config": tmpl.payload_schema.get("retry_config"),
                    },
                )
            ])
            r = results[0]
            if r.status != "pending":
                if r.status == "success":
                    success.append(RecipientOutcome(recipient_id=rid))
                else:
                    exhausted.append(RecipientOutcome(recipient_id=rid))
                continue

            async def _attempt(
                _n: int,
                _phone: str = phone,
                _user_data: dict = user_data,
            ) -> dict[str, Any]:
                del _n
                return await service.place_call(
                    agent_id=agent_id,
                    recipient_phone=_phone,
                    user_data=_user_data,
                    retry_config=tmpl.payload_schema.get("retry_config"),
                )

            outcome = await run_with_attempt_policy(
                policy=config.attempt_policy,
                call=_attempt,
                classify_error=_classify_bolna_error,
            )
            if outcome.status == "success":
                resp = outcome.payload or {}
                await ctx.update_action_result(
                    r.action_id, status="success",
                    response={**resp, "attempts": outcome.attempts},
                )
                payload_delta: dict[str, Any] = {}
                call_id = _extract_bolna_call_id(resp)
                if call_id is not None:
                    payload_delta["bolna_call_id"] = call_id
                success.append(RecipientOutcome(recipient_id=rid, payload_delta=payload_delta))
            else:
                await ctx.update_action_result(
                    r.action_id, status="failed",
                    error=f"exhausted after {outcome.attempts} attempts: {outcome.last_error}",
                )
                exhausted.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, on_exhausted: exhausted},
            summary={
                "success_count": len(success),
                "exhausted_count": len(exhausted),
                "template_slug": config.template_slug,
            },
        )


def _extract_bolna_call_id(resp: dict[str, Any]) -> Optional[str]:
    for key in ("call_id", "id", "bolna_call_id"):
        v = resp.get(key)
        if v:
            return str(v)
    return None
