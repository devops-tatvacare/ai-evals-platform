"""MessagingAdapter for AiSensy — outbound send only; inbound returns 503 until field mapping ships."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Mapping

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestration.adapters.canonical import (
    CancelDispatchOutcome,
    CancelDispatchResult,
    CanonicalMessagingEvent,
    CanonicalSendRequest,
    CanonicalSendResponse,
)

_log = logging.getLogger(__name__)

_AISENSY_INBOUND_NOT_HANDLED = (
    "Inbound events from this WhatsApp provider aren't handled yet. "
    "Outbound template sends still work; inbound mapping is pending."
)


class AiSensyServiceError(RuntimeError):
    """4xx from AiSensy — non-retryable, surfaced verbatim on the action row."""


def _make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """Hook for tests — monkeypatch to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


class AiSensyAdapter:
    capability = "messaging"
    vendor = "aisensy"

    async def send_template(
        self, *, connection: dict[str, Any], request: CanonicalSendRequest,
    ) -> CanonicalSendResponse:
        api_key = connection.get("api_key") or ""
        base_url = (connection.get("base_url") or "").rstrip("/")
        from_number = connection.get("from_number") or ""
        if not (api_key and base_url):
            raise AiSensyServiceError(
                "AiSensy connection missing api_key / base_url"
            )

        url = f"{base_url}/campaign/t1/api/v2"
        body: dict[str, Any] = {
            "apiKey": api_key,
            "campaignName": request.template_slug,
            "destination": request.contact,
            "userName": from_number,
            "source": "ai-evals-platform",
            "templateParams": list(request.variables.values()),
        }
        async with _make_client() as client:
            resp = await client.post(url, json=body)
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = {"text": resp.text[:200]}
                raise AiSensyServiceError(f"AiSensy {resp.status_code}: {err_body}")
            resp.raise_for_status()
            raw = resp.json() if resp.content else {}

        # AiSensy's public response shape carries no documented messageId; synthesize
        # a deterministic correlation handle so the action row has a non-null
        # provider_correlation_id. The handle has no upstream meaning — inbound
        # webhooks land in the 503 path until the field mapping is filled in.
        synthetic_id = f"aisensy:{request.contact}:{request.template_slug}:{int(time.time() * 1000)}"
        return CanonicalSendResponse(
            provider_correlation_id=synthetic_id,
            contact=request.contact,
            raw=raw,
        )

    def normalize_webhook(self, raw: dict[str, Any]) -> CanonicalMessagingEvent:
        raise NotImplementedError(
            "AiSensy webhook field mapping is pending. "
            "See docs/plans/2026-05-18-orchestration-vendor-abstraction/README.md §4 + §8."
        )

    def verify_signature(self, raw: bytes, headers: Mapping[str, str]) -> bool:  # noqa: ARG002
        # AiSensy signature scheme undocumented in public references; the per-connection
        # URL token gates the route until field mapping is verified.
        return True

    async def handle_webhook(
        self,
        db: AsyncSession,  # noqa: ARG002
        *,
        tenant_id: uuid.UUID,  # noqa: ARG002
        app_id: str,  # noqa: ARG002
        payload: dict[str, Any],  # noqa: ARG002
    ) -> None:
        _log.warning(
            "aisensy.webhook.skeleton_refusal — inbound rejected with 503 until field mapping ships",
        )
        raise HTTPException(
            status_code=503,
            detail=_AISENSY_INBOUND_NOT_HANDLED,
        )

    async def cancel_dispatch(
        self, *, connection: dict[str, Any], action: Any,  # noqa: ARG002
    ) -> CancelDispatchResult:
        # AiSensy exposes no public recall API; once submitted to Meta the
        # template message is unrecallable.
        return CancelDispatchResult(
            outcome=CancelDispatchOutcome.noop_unsupported,
            provider_message="aisensy: no recall api",
        )

    async def cancel_run_actions(
        self, *, connection: dict[str, Any], actions: list[Any],
    ) -> list[CancelDispatchResult]:
        return [
            await self.cancel_dispatch(connection=connection, action=a)
            for a in actions
        ]


from app.services.orchestration.adapters import register_adapter  # noqa: E402

register_adapter(capability="messaging", vendor="aisensy", adapter=AiSensyAdapter())


__all__ = ["AiSensyAdapter", "AiSensyServiceError"]
