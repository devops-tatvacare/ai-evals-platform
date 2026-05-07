"""LSQ writer for orchestration outcomes.

Per concierge spec §5.6 invariant: REUSES the existing LSQ auth params,
base URL, and rate limiter from backend/app/services/lsq_client.py.
Does not introduce a parallel auth or rate-limit layer.

Sets postUpdatedLead=false to prevent self-triggering feedback loops on
inbound LSQ webhooks.

The existing lsq_client API is:
  LSQ_BASE_URL          (module-level)
  _auth_params()        (module-level — returns {accessKey, secretKey})
  _rate_limited_request(client, method, url, **kwargs) — does the request
                        with global pacing + bounded retries

Tests monkeypatch lsq._make_client to inject httpx.MockTransport, and
monkeypatch lsq_client._auth_params + lsq_client.LSQ_BASE_URL for predictability.
"""
from __future__ import annotations

from typing import Any, Optional

import httpx

from app.services import lsq_client as _lsq_client


class LsqWriteError(RuntimeError):
    pass


def _make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


def _base_url() -> str:
    return _lsq_client.LSQ_BASE_URL.rstrip("/")


def _auth_params() -> dict[str, str]:
    return _lsq_client._auth_params()


class LsqWriter:
    """Async POSTs to LSQ Lead.Update and ProspectActivity.Create.

    Two construction modes:

    * ``LsqWriter()`` — no args. Reads URL + auth from the module-level
      ``lsq_client`` globals (legacy path, used by historical inside-sales
      flows + the orchestration env-bootstrapped default).
    * ``LsqWriter.with_config({...})`` — Phase 10 commit 2. The decrypted
      provider-connection config (``access_key``, ``secret_key``,
      ``region_host``) overrides the module globals so per-tenant
      orchestration runs use their own credentials. The shared rate
      limiter in ``lsq_client._rate_limited_request`` is reused — there
      is one global pacer regardless of how many tenants dispatch
      concurrently.
    """

    def __init__(
        self,
        *,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        region_host: Optional[str] = None,
    ) -> None:
        self._access_key = access_key
        self._secret_key = secret_key
        self._region_host = region_host

    @classmethod
    def with_config(cls, config: dict[str, Any]) -> "LsqWriter":
        """Build a writer from a decrypted provider_connections config dict."""
        return cls(
            access_key=config.get("access_key"),
            secret_key=config.get("secret_key"),
            region_host=config.get("region_host"),
        )

    def _resolved_base_url(self) -> str:
        if self._region_host:
            return self._region_host.rstrip("/")
        return _base_url()

    def _resolved_auth_params(self) -> dict[str, str]:
        if self._access_key and self._secret_key:
            return {"accessKey": self._access_key, "secretKey": self._secret_key}
        return _auth_params()

    async def update_stage(
        self, *, prospect_id: str, stage: str,
    ) -> dict[str, Any]:
        """Returns LSQ's parsed response body. ``Status`` and
        ``Message`` are always present; the dispatch handler stamps
        ``provider_correlation_id`` from the prospect_id (LSQ doesn't
        emit a separate update id) and may surface ``Status`` for
        observability."""
        url = f"{self._resolved_base_url()}/LeadManagement.svc/Lead.Update"
        params = {
            **self._resolved_auth_params(),
            "leadId": prospect_id,
            "postUpdatedLead": "false",
        }
        body = [{"Attribute": "ProspectStage", "Value": stage}]
        async with _make_client() as client:
            try:
                resp = await _lsq_client._rate_limited_request(
                    client, "POST", url, params=params, json=body,
                )
            except _lsq_client.LsqRequestError as exc:
                raise LsqWriteError(
                    f"LSQ Lead.Update failed (status={exc.status_code}): {exc}"
                ) from exc
        try:
            return resp.json() if hasattr(resp, "json") else {}
        except Exception:  # noqa: BLE001 — defensive; LSQ sometimes returns 204/empty
            return {}

    async def log_activity(
        self,
        *,
        prospect_id: str,
        activity_event: int,
        note: str,
        fields: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """Returns LSQ's parsed response body — typically
        ``{ProspectActivityId, Status, Message}``. Dispatch handler
        captures ``ProspectActivityId`` as ``provider_correlation_id``
        so reporting / re-fetch can target the activity row directly."""
        url = f"{self._resolved_base_url()}/ProspectActivity.svc/Create"
        params = self._resolved_auth_params()
        body = {
            "RelatedProspectId": prospect_id,
            "ActivityEvent": activity_event,
            "ActivityNote": note,
            "Fields": fields or [],
        }
        async with _make_client() as client:
            try:
                resp = await _lsq_client._rate_limited_request(
                    client, "POST", url, params=params, json=body,
                )
            except _lsq_client.LsqRequestError as exc:
                raise LsqWriteError(
                    f"LSQ ProspectActivity.Create failed (status={exc.status_code}): {exc}"
                ) from exc
        try:
            return resp.json() if hasattr(resp, "json") else {}
        except Exception:  # noqa: BLE001 — defensive; LSQ sometimes returns 204/empty
            return {}
