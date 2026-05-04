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

    async def list_agents(self) -> list[dict[str, Any]]:
        """Phase 13/B.1 — fetch every agent visible to the API key.

        Maps Bolna's documented ``GET /v2/agent/all`` payload (per
        https://www.bolna.ai/docs/list-agents) into a frontend-friendly
        ``[{id, name, status, type}]`` shape so the agent picker doesn't
        have to know about the upstream field names.

        Note: the in-process token bucket arrives with Phase D; until then
        the caller (api/agents.py) caches responses for 30s, which
        comfortably stays under Bolna's 500/min /v2/agent bucket for any
        realistic UI traffic.
        """
        async with _make_client(self._timeout) as client:
            resp = await client.get(f"{self._url}/v2/agent/all", headers=self._headers)
            if 400 <= resp.status_code < 500:
                try:
                    err = resp.json()
                except Exception:
                    err = {"text": resp.text[:200]}
                raise BolnaServiceError(f"Bolna {resp.status_code}: {err}")
            resp.raise_for_status()
            payload = resp.json()
        # Bolna returns a list at the top level; defensively also handle
        # ``{agents: [...]}`` in case the API gains a wrapper later.
        if isinstance(payload, dict) and "agents" in payload:
            payload = payload["agents"]
        if not isinstance(payload, list):
            raise BolnaServiceError(
                f"Bolna /v2/agent/all returned unexpected shape: {type(payload).__name__}"
            )
        out: list[dict[str, Any]] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            out.append({
                "id": str(raw.get("id") or raw.get("agent_id") or ""),
                "name": str(raw.get("agent_name") or raw.get("name") or ""),
                "status": str(raw.get("agent_status") or raw.get("status") or ""),
                "type": str(raw.get("agent_type") or raw.get("type") or ""),
            })
        return out
