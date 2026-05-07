"""core.webhook_out — POST/PUT structured JSON to an external URL per recipient.

Phase 11: ``body_template: str`` is replaced by a structured ``body`` (Phase 11
§6.6). Leaves are JSON literals or ``{"$payload": "field"}`` references. The
node renders the body via :mod:`request_body_contract.resolve` and dispatches
the HTTP call once per recipient under the configured ``attempt_policy``.

An optional ``connection_id`` points at a reusable ``webhook`` provider
connection. That connection can contribute a base URL and one reusable auth
header so operators do not have to inline credentials into node config.

Workflow-visible outputs collapse to ``success`` / ``exhausted``. Per-attempt
HTTP retries live inside the node (see :mod:`attempt_policy`); the graph never
sees per-attempt failures.

The HTTP client is constructed via ``_make_client()`` so tests can monkey-patch
in an ``httpx.MockTransport`` without bringing in a respx dependency.
"""
from __future__ import annotations

import uuid
from typing import Any, Literal, Optional
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import BaseModel, Field

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.attempt_policy import (
    AttemptPolicy,
    attempt_policy_json_schema_extra,
    run_with_attempt_policy,
)
from app.services.orchestration.request_body_contract import resolve as _resolve_body
from app.services.orchestration.node_protocol import (
    ActionDispatch,
    NodeResult,
    RecipientOutcome,
)
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    connection_id: Optional[uuid.UUID] = Field(
        default=None,
        json_schema_extra={"x-type": "connection_picker", "x-provider": "webhook"},
    )
    url: str
    method: Literal["POST", "PUT"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any = Field(
        default_factory=dict,
        json_schema_extra={"x-type": "structured_request_body"},
    )
    timeout_seconds: float = 10.0
    attempt_policy: AttemptPolicy = Field(
        default_factory=AttemptPolicy,
        json_schema_extra=attempt_policy_json_schema_extra(),
    )


def _make_client(timeout_seconds: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout_seconds)


def _is_absolute_url(url: str) -> bool:
    parsed = urlparse(url)
    return bool(parsed.scheme and parsed.netloc)


async def _resolve_target_and_headers(config: _Config, ctx) -> tuple[str, dict[str, str]]:
    target_url = config.url
    headers = dict(config.headers)
    if config.connection_id is None:
        if not _is_absolute_url(target_url):
            raise RuntimeError(
                "core.webhook_out.url must be absolute when no webhook connection is selected"
            )
        return target_url, headers

    if ctx.connections is None:
        raise RuntimeError(
            "core.webhook_out with connection_id requires ctx.connections — "
            "wire ConnectionResolver in run_handler"
        )

    connection = await ctx.connections.webhook(config.connection_id)
    base_url = str(connection.get("base_url", "")).strip()
    header_name = str(connection.get("auth_header_name", "")).strip()
    header_value = str(connection.get("auth_header_value", "")).strip()

    if not _is_absolute_url(target_url):
        if not base_url:
            raise RuntimeError(
                "core.webhook_out relative url requires the selected webhook connection "
                "to define base_url"
            )
        target_url = urljoin(f"{base_url.rstrip('/')}/", target_url.lstrip("/"))

    if header_name and header_value:
        headers = {header_name: header_value, **headers}
    return target_url, headers


def _classify_http_error(exc: BaseException) -> Optional[str]:
    """Map raised exceptions to ``retry_on`` tokens.

    ``http_5xx`` covers 500–599 responses. ``timeout`` covers connect /
    read / pool timeouts. ``transport`` covers other ``httpx.HTTPError``
    subclasses (DNS, TLS, etc.). Anything else returns ``None`` →
    non-retryable.
    """
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, _RetryableStatus):
        return "http_5xx"
    if isinstance(exc, httpx.HTTPError):
        return "transport"
    return None


class _RetryableStatus(Exception):
    """Internal signal that an HTTP response status warrants retry."""


@register_node(workflow_type="*", node_type="core.webhook_out")
class _Handler:
    node_type = "core.webhook_out"
    config_schema = _Config
    output_edges = ["success", "exhausted"]
    category = "action"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        success: list[RecipientOutcome] = []
        exhausted: list[RecipientOutcome] = []
        on_exhausted = config.attempt_policy.on_exhausted_output_id
        target_url, request_headers = await _resolve_target_and_headers(config, ctx)

        async with _make_client(config.timeout_seconds) as client:
            async for rid, payload in input_cohort:
                # ``recipient_id`` is exposed under the same key for parity with
                # the legacy ``{{recipient_id}}`` template substitution.
                resolver_payload = {**payload, "recipient_id": rid}
                rendered = _resolve_body(config.body, resolver_payload)
                idem = ctx.idempotency_key(rid, "webhook_out")
                results = await ctx.dispatch_actions([
                    ActionDispatch(
                        recipient_id=rid, channel="webhook",
                        action_type="webhook_out_posted",
                        idempotency_key=idem,
                        payload={
                            "url": target_url,
                            "method": config.method,
                            "body": rendered,
                        },
                    )
                ])
                action_id = results[0].action_id
                if results[0].status != "pending":
                    if results[0].status == "success":
                        success.append(RecipientOutcome(recipient_id=rid))
                    else:
                        exhausted.append(RecipientOutcome(recipient_id=rid))
                    continue

                async def _attempt(attempt: int, _rendered: Any = rendered) -> dict[str, Any]:
                    del attempt  # surfaced via outcome.attempts; the call itself is stateless
                    resp = await client.request(
                        config.method,
                        target_url,
                        json=_rendered,
                        headers=request_headers,
                    )
                    if 500 <= resp.status_code < 600:
                        raise _RetryableStatus(f"HTTP {resp.status_code}: {resp.text[:200]}")
                    if not (200 <= resp.status_code < 300):
                        # 4xx — not retryable; surface as non-retryable failure.
                        raise httpx.HTTPStatusError(
                            f"HTTP {resp.status_code}: {resp.text[:200]}",
                            request=resp.request,
                            response=resp,
                        )
                    return {"status_code": resp.status_code, "body": resp.text[:4000]}

                outcome = await run_with_attempt_policy(
                    policy=config.attempt_policy,
                    call=_attempt,
                    classify_error=_classify_http_error,
                )

                if outcome.status == "success":
                    await ctx.update_action_result(
                        action_id, status="success",
                        response={**(outcome.payload or {}), "attempts": outcome.attempts},
                    )
                    success.append(RecipientOutcome(recipient_id=rid))
                else:
                    await ctx.update_action_result(
                        action_id, status="failed",
                        error=f"exhausted after {outcome.attempts} attempts: {outcome.last_error}",
                    )
                    exhausted.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"success": success, on_exhausted: exhausted},
            summary={
                "success_count": len(success),
                "exhausted_count": len(exhausted),
            },
        )


__all__ = ["_Config", "_Handler", "_make_client", "_RetryableStatus"]
