"""WatiService — POST WATI templated messages.

Per concierge spec §5.3:
  Base URL has tenant ID in path: https://live-mt-server.wati.io/{tenantId}
  Auth: Authorization: Bearer <token>
  Send: POST /api/v2/sendTemplateMessage?whatsappNumber=<E164-no-plus>
  Response: {localMessageId, whatsappMessageId, ...}

Tests monkeypatch _make_client to inject httpx.MockTransport (no respx dep).
4xx → WatiServiceError (non-retryable). 5xx / network → httpx.HTTPError (retry-safe).
"""
from __future__ import annotations

from typing import Any

import httpx


class WatiServiceError(RuntimeError):
    """Raised on 4xx — non-retryable client error from WATI."""


def _make_client(timeout: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


class WatiService:
    def __init__(self, *, base_url: str, wati_tenant_id: str, api_token: str, timeout: float = 30.0):
        if not base_url or not wati_tenant_id or not api_token:
            raise ValueError("WatiService requires base_url, wati_tenant_id, api_token")
        self._url = f"{base_url.rstrip('/')}/{wati_tenant_id}"
        self._headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    async def send_template(
        self,
        *,
        whatsapp_number: str,
        template_name: str,
        broadcast_name: str,
        parameters: list[dict[str, str]],
        channel_number: str | None = None,
    ) -> dict[str, Any]:
        url = f"{self._url}/api/v2/sendTemplateMessage"
        body: dict[str, Any] = {
            "template_name": template_name,
            "broadcast_name": broadcast_name,
            "parameters": parameters,
        }
        if channel_number:
            body["channel_number"] = channel_number

        async with _make_client(self._timeout) as client:
            resp = await client.post(
                url,
                params={"whatsappNumber": whatsapp_number},
                json=body,
                headers=self._headers,
            )
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = {"text": resp.text[:200]}
                raise WatiServiceError(f"WATI {resp.status_code}: {err_body}")
            resp.raise_for_status()  # 5xx → httpx.HTTPStatusError (retry-safe)
            return resp.json()

    async def get_message_templates(self) -> dict[str, Any] | list[Any]:
        url = f"{self._url}/api/v2/getMessageTemplates"
        async with _make_client(self._timeout) as client:
            resp = await client.get(url, headers=self._headers)
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = {"text": resp.text[:200]}
                raise WatiServiceError(f"WATI {resp.status_code}: {err_body}")
            resp.raise_for_status()
            return resp.json()
