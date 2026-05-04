"""BolnaService — POST /call to place an outbound AI voice call.

Per concierge spec §5.4:
  Base URL: https://api.bolna.ai
  POST /call with {agent_id, recipient_phone_number, user_data, retry_config?, scheduled_at?}
  Response: {message, status, execution_id}

Retries are delegated to Bolna's built-in retry_config — we do not schedule
our own retry jobs. This eliminates a class of double-call races.
4xx → BolnaServiceError. 5xx / network → httpx.HTTPError (retry-safe).

Phase 13/D.1: every outbound call now passes through the in-process token
bucket (``_rate_limiter.acquire_bolna``) keyed by ``connection_id``.
Buckets default to wait-acquire with a short timeout; on exhaustion the
service raises :class:`RateLimitedError`, which the dispatch loop's
``attempt_policy`` retries per its config. Connections constructed
without a ``connection_id`` (legacy test fixtures) skip the limiter so
existing unit tests don't have to thread it through.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

import httpx

from app.services.orchestration.integrations._rate_limiter import (
    RateLimitedError as RateLimitedError,  # re-exported for dispatch nodes
    acquire_bolna,
)


class BolnaServiceError(RuntimeError):
    pass


def _make_client(timeout: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


class BolnaService:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
        connection_id: Optional[uuid.UUID] = None,
        default_from_phone: Optional[str] = None,
    ):
        if not base_url or not api_key:
            raise ValueError("BolnaService requires base_url and api_key")
        self._url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout
        # When None, the rate limiter is bypassed — used by legacy unit
        # fixtures that construct the service inline. Production callers
        # always thread the connection id through ConnectionResolver.
        self._connection_id = connection_id
        # Per-connection caller-id default. The dispatch node's
        # ``override_from_phone`` (if non-empty) wins; otherwise
        # ``place_call`` falls back to this. Empty/None means "let Bolna
        # use the agent's per-agent default" — the call will go out from
        # whatever number Plivo has provisioned for the agent.
        self._default_from_phone = (default_from_phone or "").strip() or None

    async def _acquire(self, *bucket_names: str) -> None:
        if self._connection_id is None:
            return
        await acquire_bolna(self._connection_id, *bucket_names)

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
        await self._acquire("bolna:call")
        body: dict[str, Any] = {
            "agent_id": agent_id,
            "recipient_phone_number": recipient_phone,
            "user_data": user_data,
        }
        # Per-call override > connection default > Bolna agent default.
        # The 2026-05-04 prod test surfaced that an empty override at the
        # node level was not falling back to the connection's from_phone,
        # so calls dialed without any caller-id (agent_number=null in
        # Bolna's GET /executions response).
        effective_from_phone = from_phone or self._default_from_phone
        if effective_from_phone:
            body["from_phone_number"] = effective_from_phone
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
        await self._acquire("bolna:agent")
        async with _make_client(self._timeout) as client:
            # Bolna's documented agent-fetch is ``GET /v2/agent/{agent_id}``
            # (singular, v2-prefixed) — see
            # https://www.bolna.ai/docs/api-reference/agent/v2/get. The
            # bare ``/agents/{id}`` legacy path that previous builds used
            # is not served by api.bolna.ai and 404s, which surfaces in
            # the variable-mapping picker as ``Bolna 404: {'detail': 'Not Found'}``.
            resp = await client.get(f"{self._url}/v2/agent/{agent_id}", headers=self._headers)
            if 400 <= resp.status_code < 500:
                try:
                    err = resp.json()
                except Exception:
                    err = {"text": resp.text[:200]}
                raise BolnaServiceError(f"Bolna {resp.status_code}: {err}")
            resp.raise_for_status()
            return resp.json()

    async def get_execution(self, *, execution_id: str) -> dict[str, Any]:
        """Phase 13/E.3 — fetch a single call's terminal state.

        Used by the ``poll-bolna-executions`` job to reconcile any open
        single-call dispatch row whose webhook never landed (or when
        webhooks are disabled at the provider end). Bolna's documented
        endpoint is ``GET /executions/{execution_id}`` — the same payload
        their webhook delivers, so the reconciler can consume both
        without branching.
        """
        if not execution_id:
            raise ValueError("BolnaService.get_execution requires execution_id")
        await self._acquire("bolna:executions")
        async with _make_client(self._timeout) as client:
            resp = await client.get(
                f"{self._url}/executions/{execution_id}", headers=self._headers,
            )
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

        Phase D wires this through the ``bolna:agent`` token bucket so
        burst traffic (e.g. an admin opening multiple builder tabs)
        can't exceed Bolna's 500/min quota.
        """
        await self._acquire("bolna:agent")
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
