"""messaging.send_whatsapp_template — capability-named WhatsApp dispatch node.

Vendor is selected by the bound ProviderConnection (wati / aisensy). All
vendor-specific HTTP shaping lives in the MessagingAdapter resolved at
execute-time via ``resolve_adapter(capability='messaging', vendor=...)``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.adapters import (
    AdapterNotRegisteredError,
    CanonicalSendRequest,
    resolve_adapter,
)
from app.services.orchestration.comm_cap.enforcement import enforce_comm_cap_or_skip
from app.services.orchestration.errors import RecipientNotInManifestError
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.nodes._template import render as _render
from app.services.orchestration.recipient_manifest import assert_recipient_in_manifest


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    connection_id: uuid.UUID = Field(
        ...,
        description="WhatsApp connection to send through.",
        json_schema_extra={
            "x-type": "connection_picker",
            "x-providers": ["wati", "aisensy"],
        },
    )
    template_slug: str = Field(
        ...,
        min_length=1,
        description="Approved template name registered with your WhatsApp provider.",
    )
    variable_mappings: dict[str, str] = Field(
        default_factory=dict,
        description="Values bound to the template's placeholders, by name.",
    )
    webhook_ttl_seconds: int = Field(
        default=259200,
        ge=60,
        description="Ignore replies arriving after this many seconds. Defaults to 3 days.",
    )


@register_node(workflow_type="*", node_type="messaging.send_whatsapp_template")
class _Handler:
    node_type = "messaging.send_whatsapp_template"
    config_schema = _Config
    output_edges = ["success", "failed"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "messaging.send_whatsapp_template requires ctx.connections — "
                "wire ConnectionResolver in run_handler"
            )
        connection = await ctx.connections.get_config(config.connection_id)
        vendor = connection.get("__provider__", "")
        try:
            adapter = resolve_adapter(capability="messaging", vendor=vendor)
        except AdapterNotRegisteredError as exc:
            raise RuntimeError(
                f"no messaging adapter registered for provider {vendor!r}; "
                f"connection {config.connection_id} cannot dispatch"
            ) from exc

        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []
        ttl_deadline = datetime.now(timezone.utc) + timedelta(
            seconds=config.webhook_ttl_seconds
        )

        async for rid, payload in input_cohort:
            try:
                recipient_row = await assert_recipient_in_manifest(
                    ctx.db, run_id=ctx.run_id, recipient_id=rid,
                )
            except RecipientNotInManifestError:
                await ctx.set_recipient_state(rid, status="skipped")
                continue
            cap_result = await enforce_comm_cap_or_skip(
                ctx.db, recipient=recipient_row, stage="cap_runtime",
            )
            if not cap_result.proceed:
                continue
            contact = str(payload.get("contact") or rid)
            request = CanonicalSendRequest(
                contact=contact,
                template_slug=config.template_slug,
                variables={
                    name: _render(value, payload)
                    for name, value in config.variable_mappings.items()
                },
            )
            idem = ctx.idempotency_key(rid, "whatsapp_template", config.template_slug)
            dispatch = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="whatsapp",
                    action_type="wa_dispatched",
                    idempotency_key=idem,
                    payload={"contact": contact, "template_slug": config.template_slug},
                )
            ])
            action_id = dispatch[0].action_id
            if dispatch[0].status != "pending":
                bucket = success if dispatch[0].status == "success" else failed
                bucket.append(RecipientOutcome(recipient_id=rid))
                continue

            try:
                response = await adapter.send_template(
                    connection=connection, request=request,
                )
            except Exception as exc:  # noqa: BLE001 — vendor error surfaced verbatim
                await ctx.update_action_result(
                    action_id, status="failed", error=str(exc),
                )
                failed.append(RecipientOutcome(recipient_id=rid))
                continue

            await ctx.update_action_result(
                action_id,
                status="success",
                response={
                    "raw": response.raw,
                    "provider_correlation_id": response.provider_correlation_id,
                },
                provider_correlation_id=response.provider_correlation_id,
            )
            await ctx.stamp_webhook_ttl(rid, deadline=ttl_deadline)
            success.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )


__all__ = ["_Config", "_Handler"]
