"""crm.send_wati — WhatsApp template dispatch via the configured WATI account.

Phase 11 (Commit 2): the node now declares a Phase-11 contract:

  - workflow-visible outputs collapse to ``success`` / ``exhausted``
    (Phase 11 §6.6) — per-attempt retry stays inside the node via
    :func:`attempt_policy.run_with_attempt_policy`.
  - ``attempt_policy`` is part of the user-facing config; tenants can
    raise ``max_attempts`` without authoring a graph retry loop.

Phase 10 ground rules remain:

  - the WATI service is resolved per-call from
    ``ctx.connections.wati(config.connection_id)`` rather than read off
    ``ctx.services.wati``.
  - ``variable_mappings`` overrides the template's default
    ``parameter_map``; an empty list falls back to the template defaults
    so older seed JSON keeps working.

Persists one ``workflow_run_recipient_actions`` row per recipient with
``action_type='wa_dispatched'``. Idempotency key is deterministic from
``(workflow_version_id, node_id, recipient_id, "wati", template_slug)``.
The WATI ``localMessageId`` (when returned) is emitted into payload as
``wati_local_message_id`` so inbound WATI webhooks can correlate the
message to the parked recipient.
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
    apply_variable_mappings_list,
)
from app.services.orchestration.integrations.template_resolver import (
    TemplateNotFound,
    resolve_template,
)
from app.services.orchestration.integrations.wati import WatiServiceError
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    connection_id: uuid.UUID = Field(
        ...,
        json_schema_extra={"x-type": "connection_picker", "x-provider": "wati"},
    )
    template_slug: str
    phone_field: str = "whatsapp_number"  # E.164 digits, no '+'
    variable_mappings: list[dict[str, Any]] = Field(
        default_factory=list,
        json_schema_extra={"x-type": "variable_mapping_list"},
    )
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


def _classify_wati_error(exc: BaseException) -> Optional[str]:
    """All WATI service failures are retryable transport errors by default."""
    if isinstance(exc, WatiServiceError):
        return "wati_service_error"
    return None


@register_node(workflow_type="crm", node_type="crm.send_wati")
class _Handler:
    node_type = "crm.send_wati"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.send_wati requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        service = await ctx.connections.wati(config.connection_id)

        try:
            template = await resolve_template(
                ctx.db, tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                channel="wati", slug=config.template_slug,
            )
        except TemplateNotFound as exc:
            raise RuntimeError(f"crm.send_wati: {exc}") from exc

        template_param_map = template.payload_schema.get("parameter_map", []) or []
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        on_exhausted = config.attempt_policy.on_exhausted_output_id

        async for rid, payload in input_cohort:
            wa_number = payload.get(config.phone_field)
            if not wa_number:
                exhausted.append(RecipientOutcome(recipient_id=rid))
                continue

            params_built = apply_variable_mappings_list(
                config.variable_mappings,
                payload,
                template_fallback=template_param_map,
            )

            idem = ctx.idempotency_key(rid, "wati", config.template_slug)
            results = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="wati",
                    action_type="wa_dispatched",
                    idempotency_key=idem,
                    payload={
                        "template_name": template.payload_schema["template_name"],
                        "broadcast_name": template.payload_schema.get("broadcast_name", "concierge"),
                        "parameters": params_built,
                        "whatsapp_number": wa_number,
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

            async def _attempt(_n: int, _wa: str = wa_number, _params: list = params_built) -> dict[str, Any]:
                del _n
                return await service.send_template(
                    whatsapp_number=_wa,
                    template_name=template.payload_schema["template_name"],
                    broadcast_name=template.payload_schema.get("broadcast_name", "concierge"),
                    parameters=_params,
                )

            outcome = await run_with_attempt_policy(
                policy=config.attempt_policy,
                call=_attempt,
                classify_error=_classify_wati_error,
            )
            if outcome.status == "success":
                resp = outcome.payload or {}
                await ctx.update_action_result(
                    r.action_id, status="success",
                    response={**resp, "attempts": outcome.attempts},
                )
                # Surface the provider correlation id so inbound webhooks can
                # match this dispatch to the recipient (Phase 11 §6.6).
                payload_delta: dict[str, Any] = {}
                wati_id = _extract_wati_message_id(resp)
                if wati_id is not None:
                    payload_delta["wati_local_message_id"] = wati_id
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


def _extract_wati_message_id(resp: dict[str, Any]) -> Optional[str]:
    """Pull the WATI ``localMessageId`` (or fallbacks) out of a send response."""
    for key in ("localMessageId", "messageId", "id", "wati_local_message_id"):
        v = resp.get(key)
        if v:
            return str(v)
    nested = resp.get("messageContact")
    if isinstance(nested, dict):
        for key in ("localMessageId", "messageId"):
            v = nested.get(key)
            if v:
                return str(v)
    return None
