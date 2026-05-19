"""voice.place_call — capability-named outbound voice node; vendor comes from the bound connection."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.adapters import (
    AdapterNotRegisteredError,
    CanonicalVoiceRequest,
    resolve_adapter,
)
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
        description="Voice connection to place the call through.",
        json_schema_extra={
            "x-type": "connection_picker",
            "x-providers": ["bolna"],
        },
    )
    agent_id: str = Field(
        ...,
        min_length=1,
        description="Voice agent that will handle the conversation.",
    )
    variable_mappings: dict[str, str] = Field(
        default_factory=dict,
        description="Values passed to the agent as call variables, by name.",
    )
    from_phone: Optional[str] = Field(
        default=None,
        description="Optional caller-id override. Falls back to the connection default, then the agent default.",
    )
    webhook_ttl_seconds: int = Field(
        default=259200,
        ge=60,
        description="Ignore voice callbacks arriving after this many seconds. Defaults to 3 days.",
    )
    mode: Literal["auto", "single", "batch"] = Field(
        default="auto",
        description="Dispatch mode. 'auto' lets the adapter pick based on cohort size; override only if you need to force one path.",
    )



@register_node(workflow_type="*", node_type="voice.place_call")
class _Handler:
    node_type = "voice.place_call"
    config_schema = _Config
    output_edges = ["success", "failed"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "voice.place_call requires ctx.connections — "
                "wire ConnectionResolver in run_handler"
            )
        connection = await ctx.connections.get_config(config.connection_id)
        vendor = connection.get("__provider__", "")
        try:
            adapter = resolve_adapter(capability="voice", vendor=vendor)
        except AdapterNotRegisteredError as exc:
            raise RuntimeError(
                f"no voice adapter registered for provider {vendor!r}; "
                f"connection {config.connection_id} cannot dispatch"
            ) from exc

        cohort: list[tuple[str, dict[str, Any]]] = []
        async for rid, payload in input_cohort:
            try:
                await assert_recipient_in_manifest(
                    ctx.db, run_id=ctx.run_id, recipient_id=rid,
                )
            except RecipientNotInManifestError:
                await ctx.set_recipient_state(rid, status="skipped")
                continue
            cohort.append((rid, payload))

        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []
        ttl_deadline = datetime.now(timezone.utc) + timedelta(
            seconds=config.webhook_ttl_seconds
        )

        def _build_request(rid: str, payload: dict[str, Any]) -> tuple[str, CanonicalVoiceRequest, str]:
            contact = str(payload.get("contact") or payload.get("phone") or rid)
            variables = {
                name: _render(value, payload)
                for name, value in config.variable_mappings.items()
            }
            variables.setdefault("recipient_id", rid)
            request = CanonicalVoiceRequest(
                contact=contact,
                agent_id=config.agent_id,
                variables=variables,
                from_phone=config.from_phone,
            )
            idem = ctx.idempotency_key(rid, "voice_call", config.agent_id)
            return contact, request, idem

        threshold = getattr(adapter, "batch_threshold", None)
        adapter_supports_batch = hasattr(adapter, "place_call_batch")
        if config.mode == "batch":
            if not adapter_supports_batch:
                raise RuntimeError(
                    f"voice adapter {vendor!r} does not support batch mode; "
                    "remove the explicit mode='batch' override or pick a different vendor"
                )
            use_batch = True
        elif config.mode == "single":
            use_batch = False
        else:  # 'auto' — defer to the adapter's threshold
            use_batch = (
                threshold is not None
                and len(cohort) >= threshold
                and adapter_supports_batch
            )

        if use_batch:
            return await self._dispatch_batch(
                ctx=ctx, adapter=adapter, connection=connection, config=config,
                cohort=cohort, build_request=_build_request, ttl_deadline=ttl_deadline,
            )

        for rid, payload in cohort:
            contact, request, idem = _build_request(rid, payload)
            dispatch = await ctx.dispatch_actions([
                ActionDispatch(
                    recipient_id=rid,
                    channel="voice",
                    action_type="voice_queued",
                    idempotency_key=idem,
                    payload={
                        "contact": contact,
                        "agent_id": config.agent_id,
                        "mode": "single",
                    },
                )
            ])
            action_id = dispatch[0].action_id
            if dispatch[0].status != "pending":
                bucket = success if dispatch[0].status == "success" else failed
                bucket.append(RecipientOutcome(recipient_id=rid))
                continue

            try:
                response = await adapter.place_call(
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
                    "mode": response.mode,
                },
                provider_correlation_id=response.provider_correlation_id,
                provider_status="queued",
            )
            await ctx.stamp_webhook_ttl(rid, deadline=ttl_deadline)
            success.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "mode": "single",
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )

    async def _dispatch_batch(
        self,
        *,
        ctx,
        adapter,
        connection: dict[str, Any],
        config: _Config,
        cohort: list[tuple[str, dict[str, Any]]],
        build_request,
        ttl_deadline: datetime,
    ) -> NodeResult:
        success: list[RecipientOutcome] = []
        failed: list[RecipientOutcome] = []

        prepared = [build_request(rid, payload) for rid, payload in cohort]
        dispatches = [
            ActionDispatch(
                recipient_id=rid,
                channel="voice",
                action_type="voice_queued",
                idempotency_key=idem,
                payload={
                    "contact": contact,
                    "agent_id": config.agent_id,
                    "mode": "batch",
                },
            )
            for (rid, _payload), (contact, _req, idem) in zip(cohort, prepared)
        ]
        results = await ctx.dispatch_actions(dispatches)
        by_recipient = {r.recipient_id: r for r in results}

        pending: list[tuple[str, CanonicalVoiceRequest, str]] = []
        for (rid, _payload), (contact, request, _idem) in zip(cohort, prepared):
            r = by_recipient[rid]
            if r.status == "pending":
                pending.append((rid, request, r.action_id))
            elif r.status == "success":
                success.append(RecipientOutcome(recipient_id=rid))
            else:
                failed.append(RecipientOutcome(recipient_id=rid))

        if not pending:
            return NodeResult(
                by_output_id={"success": success, "failed": failed},
                summary={
                    "mode": "batch",
                    "success_count": len(success),
                    "failed_count": len(failed),
                    "skipped_already_dispatched": True,
                },
            )

        pending_rids = [rid for rid, _req, _aid in pending]
        pending_requests = [req for _rid, req, _aid in pending]

        try:
            responses = await adapter.place_call_batch(
                connection=connection,
                requests=pending_requests,
                recipient_ids=pending_rids,
            )
        except Exception as exc:  # noqa: BLE001 — batch upload failed atomically
            for rid, _req, action_id in pending:
                await ctx.update_action_result(
                    action_id, status="failed", error=str(exc),
                )
                failed.append(RecipientOutcome(recipient_id=rid))
            return NodeResult(
                by_output_id={"success": success, "failed": failed},
                summary={
                    "mode": "batch",
                    "success_count": len(success),
                    "failed_count": len(failed),
                    "batch_upload_failed": True,
                },
            )

        for (rid, _req, action_id), response in zip(pending, responses):
            await ctx.update_action_result(
                action_id,
                status="success",
                response={
                    "raw": response.raw,
                    "provider_correlation_id": response.provider_correlation_id,
                    "mode": response.mode,
                },
                provider_correlation_id=response.provider_correlation_id,
                provider_status="queued",
            )
            await ctx.stamp_webhook_ttl(rid, deadline=ttl_deadline)
            success.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, "failed": failed},
            summary={
                "mode": "batch",
                "success_count": len(success),
                "failed_count": len(failed),
            },
        )


__all__ = ["_Config", "_Handler"]
