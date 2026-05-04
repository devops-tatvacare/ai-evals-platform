"""crm.send_sms — provider-backed SMS dispatch (msg91 / aisensy).

Phase 11 (Commit 2): the node declares a Phase-11 contract with workflow-visible
``success`` / ``exhausted`` outputs. Per-recipient retries run inline under
the configured ``attempt_policy``.

Phase 10 ground rules: provider + credentials come from
``ctx.connections.get_config(config.connection_id)``; the provider on the
connection row decides the dispatch shape (``msg91`` or ``aisensy``).

Body templating uses ``{{var}}`` substitution against the recipient
payload. Tests monkeypatch ``_make_client`` to inject ``httpx.MockTransport``.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    attempt_policy_json_schema_extra,
    run_with_attempt_policy,
)
from app.services.orchestration.connections.resolver import (
    ConnectionProviderMismatch,
)
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


_SUPPORTED_SMS_PROVIDERS = ("msg91", "aisensy")


class _Config(BaseModel):
    connection_id: uuid.UUID = Field(
        ...,
        json_schema_extra={
            "x-type": "connection_picker",
            "x-providers": list(_SUPPORTED_SMS_PROVIDERS),
        },
    )
    template_slug: str = Field(
        ...,
        title="Action Template",
        description=(
            "Internal platform action template used for SMS body rendering, "
            "tracking, and idempotency. Stored as a slug behind this picker."
        ),
        json_schema_extra={"x-type": "action_template_picker", "x-channel": "sms"},
    )
    phone_field: str = "phone"
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


def _render(template: str, vars_: dict[str, Any]) -> str:
    out = template
    for k, v in vars_.items():
        out = out.replace("{{" + k + "}}", str(v) if v is not None else "")
    return out


def _make_client(timeout: float = 15.0) -> httpx.AsyncClient:
    """Hook for tests."""
    return httpx.AsyncClient(timeout=timeout)


def _build_msg91_request(
    config: dict[str, Any], *, phone: str, body: str,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Returns (url, headers, json_body) for an MSG91 flow-API send."""
    auth_key = config.get("auth_key") or ""
    flow_id = config.get("flow_id") or ""
    sender_id = config.get("sender_id") or ""
    if not auth_key or not flow_id:
        raise RuntimeError("crm.send_sms (msg91): connection missing auth_key/flow_id")
    url = "https://control.msg91.com/api/v5/flow/"
    headers = {"authkey": auth_key, "Content-Type": "application/json"}
    payload: dict[str, Any] = {
        "flow_id": flow_id,
        "sender": sender_id,
        "recipients": [{"mobiles": phone, "body": body}],
    }
    return url, headers, payload


def _build_aisensy_request(
    config: dict[str, Any], *, phone: str, body: str,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Returns (url, headers, json_body) for an AiSensy SMS send."""
    api_key = config.get("api_key") or ""
    base_url = (config.get("base_url") or "").rstrip("/")
    partner_id = config.get("campaign_partner_id") or ""
    sender = config.get("from_number") or ""
    if not api_key or not base_url:
        raise RuntimeError(
            "crm.send_sms (aisensy): connection missing api_key/base_url"
        )
    url = f"{base_url}/v1/{partner_id}/sms/send" if partner_id else f"{base_url}/v1/sms/send"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload: dict[str, Any] = {
        "from": sender,
        "to": phone,
        "body": body,
    }
    return url, headers, payload


class _SmsRetryableStatus(Exception):
    """Internal signal that a 5xx HTTP response warrants retry."""


def _classify_sms_error(exc: BaseException) -> Optional[str]:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, _SmsRetryableStatus):
        return "http_5xx"
    if isinstance(exc, httpx.HTTPError):
        return "transport"
    return None


@register_node(workflow_type="crm", node_type="crm.send_sms")
class _Handler:
    node_type = "crm.send_sms"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        if ctx.connections is None:
            raise RuntimeError(
                "crm.send_sms requires ctx.connections — wire ConnectionResolver in run_handler"
            )
        try:
            conn_config = await ctx.connections.get_config(config.connection_id)
        except ConnectionProviderMismatch as exc:  # pragma: no cover — get_config without expected_provider can't raise this
            raise RuntimeError(f"crm.send_sms: {exc}") from exc

        provider = conn_config.get("__provider__", "")
        if provider not in _SUPPORTED_SMS_PROVIDERS:
            raise RuntimeError(
                f"crm.send_sms: connection provider={provider!r} is not an SMS provider; "
                f"expected one of {_SUPPORTED_SMS_PROVIDERS}"
            )

        try:
            tmpl = await resolve_template(
                ctx.db, tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                channel="sms", slug=config.template_slug,
            )
        except TemplateNotFound as exc:
            raise RuntimeError(f"crm.send_sms: {exc}") from exc

        body_template = tmpl.payload_schema.get("body", "")
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        on_exhausted = config.attempt_policy.on_exhausted_output_id

        async with _make_client() as client:
            async for rid, payload in input_cohort:
                phone = payload.get(config.phone_field)
                if not phone:
                    exhausted.append(RecipientOutcome(recipient_id=rid))
                    continue
                msg = _render(body_template, payload)
                idem = ctx.idempotency_key(rid, "sms", config.template_slug)
                results = await ctx.dispatch_actions([
                    ActionDispatch(
                        recipient_id=rid,
                        channel="sms",
                        action_type="sms_dispatched",
                        idempotency_key=idem,
                        payload={
                            # Channel-agnostic recipient handle (migration 0027).
                            "contact": phone,
                            "phone": phone,
                            "body": msg,
                            "provider": provider,
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
                    _msg: str = msg,
                ) -> dict[str, Any]:
                    del _n
                    if provider == "msg91":
                        url, headers, json_body = _build_msg91_request(
                            conn_config, phone=_phone, body=_msg,
                        )
                    else:  # aisensy
                        url, headers, json_body = _build_aisensy_request(
                            conn_config, phone=_phone, body=_msg,
                        )
                    resp = await client.post(url, headers=headers, json=json_body)
                    if 500 <= resp.status_code < 600:
                        raise _SmsRetryableStatus(
                            f"HTTP {resp.status_code}: {resp.text[:200]}"
                        )
                    if not (200 <= resp.status_code < 300):
                        raise httpx.HTTPStatusError(
                            f"HTTP {resp.status_code}: {resp.text[:200]}",
                            request=resp.request,
                            response=resp,
                        )
                    return {"status_code": resp.status_code}

                outcome = await run_with_attempt_policy(
                    policy=config.attempt_policy,
                    call=_attempt,
                    classify_error=_classify_sms_error,
                )
                if outcome.status == "success":
                    resp_body = outcome.payload or {}
                    await ctx.update_action_result(
                        r.action_id, status="success",
                        response={**resp_body, "attempts": outcome.attempts},
                    )
                    success.append(RecipientOutcome(recipient_id=rid))
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
                "provider": provider,
            },
        )
