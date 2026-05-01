"""BolnaService — POST /call to place an outbound AI voice call.

Per concierge spec §5.4:
  Base URL: https://api.bolna.ai
  POST /call with {agent_id, recipient_phone_number, user_data, retry_config?, scheduled_at?}
  Response: {message, status, execution_id}

Retries are delegated to Bolna's built-in retry_config — we do not schedule
our own retry jobs. This eliminates a class of double-call races.
4xx → BolnaServiceError. 5xx / network → httpx.HTTPError (retry-safe).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import httpx


class BolnaServiceError(RuntimeError):
    pass


def _make_client(timeout: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


class BolnaService:
    def __init__(self, *, base_url: str, api_key: str, timeout: float = 30.0):
        if not base_url or not api_key:
            raise ValueError("BolnaService requires base_url and api_key")
        self._url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    async def place_call(
        self,
        *,
        agent_id: str,
        recipient_phone: str,
        user_data: dict[str, Any],
        from_phone: Optional[str] = None,
        retry_config: Optional[dict[str, Any]] = None,
        scheduled_at: Optional[datetime] = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "agent_id": agent_id,
            "recipient_phone_number": recipient_phone,
            "user_data": user_data,
        }
        if from_phone:
            body["from_phone_number"] = from_phone
        if retry_config:
            body["retry_config"] = retry_config
        if scheduled_at:
            body["scheduled_at"] = scheduled_at.isoformat()

        async with _make_client(self._timeout) as client:
            resp = await client.post(f"{self._url}/call", json=body, headers=self._headers)
            if 400 <= resp.status_code < 500:
                try:
                    err = resp.json()
                except Exception:
                    err = {"text": resp.text[:200]}
                raise BolnaServiceError(f"Bolna {resp.status_code}: {err}")
            resp.raise_for_status()
            return resp.json()

    async def get_agent(self, *, agent_id: str) -> dict[str, Any]:
        if not agent_id:
            raise ValueError("BolnaService.get_agent requires agent_id")
        async with _make_client(self._timeout) as client:
            resp = await client.get(f"{self._url}/agents/{agent_id}", headers=self._headers)
            if 400 <= resp.status_code < 500:
                try:
                    err = resp.json()
                except Exception:
                    err = {"text": resp.text[:200]}
                raise BolnaServiceError(f"Bolna {resp.status_code}: {err}")
            resp.raise_for_status()
            return resp.json()
