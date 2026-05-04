"""crm.place_bolna_call — outbound AI voice call via the configured Bolna account.

Workflow-visible outputs: ``success`` / ``exhausted``. Per-attempt retries are
governed by the node's ``attempt_policy`` (the helper runs them inline; see
:mod:`attempt_policy` for the backoff caveat). Bolna's own provider-side
``retry_config`` continues to govern *within-call* dial retries.

The Bolna service is resolved per-call from
``ctx.connections.bolna(config.connection_id)``. ``variable_mappings`` is the
sole source of Bolna ``user_data`` — there is no template-side fallback.

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
    # Bolna agent UUID — UI-supplied per Phase 13 keystone #1. Required at
    # publish time (publish-gate validator); drafts may persist with the
    # default empty string while authors complete the form.
    agent_id: str = Field(
        "",
        title="Bolna Agent",
        description="Pick the live Bolna agent placed on the call.",
        json_schema_extra={"x-type": "bolna_agent_picker"},
    )
    # Optional outbound caller-id override. UI-supplied (no template-side
    # fallback per Phase 13 keystone #3). Empty string → fall back to the
    # connection's ``from_phone`` config; empty connection field → fall back
    # to Bolna's per-agent default at the upstream.
    from_phone: str = Field(
        "",
        title="Caller ID Override",
        description=(
            "Optional E.164 caller-id override. Leave blank to use the "
            "connection default or Bolna's per-agent default."
        ),
    )
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
        if not config.agent_id:
            # Defensive: the publish-gate validator should have caught this
            # before runtime, but seeded drafts and direct API submitters
            # can still reach here. Per Phase 13 keystone #1/#3, no fallback.
            raise RuntimeError(
                "crm.place_bolna_call: agent_id is required (Phase 13 — supply via the agent picker)."
            )
        service = await ctx.connections.bolna(config.connection_id)

        try:
            tmpl = await resolve_template(
                ctx.db, tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                channel="bolna", slug=config.template_slug,
            )
        except TemplateNotFound as exc:
            raise RuntimeError(f"crm.place_bolna_call: {exc}") from exc

        agent_id = config.agent_id
        from_phone = config.from_phone or None
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
                    from_phone=from_phone,
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
