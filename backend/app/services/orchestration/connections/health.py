"""Read-only "test connection" probes per provider.

Each probe returns ``{ok: bool, detail: str}`` and never raises. Phase 10
commit 1 ships minimal probes that exercise auth + base-url shape; richer
introspection (Bolna agent variables, WATI templates, LSQ lead schema) lands
with the frontend connections page in commit 3.

The probes use ``httpx`` directly with bounded timeouts. Mock via
``_make_client`` from the relevant integration module where one already
exists; otherwise the probe constructs its own short-timeout client.
"""
from __future__ import annotations

from typing import Any

import httpx


_TIMEOUT_SECONDS = 10.0


def _ok(detail: str) -> dict[str, Any]:
    return {"ok": True, "detail": detail}


def _fail(detail: str) -> dict[str, Any]:
    return {"ok": False, "detail": detail}


async def _probe_get(url: str, *, headers: dict[str, str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=headers)
        if 200 <= resp.status_code < 400:
            return _ok(f"HTTP {resp.status_code}")
        return _fail(f"HTTP {resp.status_code}: {resp.text[:160]}")
    except httpx.HTTPError as exc:
        return _fail(f"network error: {exc!r}")


async def probe_bolna(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    if not base or not api_key:
        return _fail("missing base_url or api_key")
    return await _probe_get(
        f"{base}/agents",
        headers={"Authorization": f"Bearer {api_key}"},
    )


async def probe_wati(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("base_url", "").rstrip("/")
    tid = config.get("wati_tenant_id", "")
    token = config.get("api_token", "")
    if not base or not tid or not token:
        return _fail("missing base_url, wati_tenant_id, or api_token")
    return await _probe_get(
        f"{base}/{tid}/api/v2/contacts?limit=1",
        headers={"Authorization": f"Bearer {token}"},
    )


async def probe_aisensy(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    if not base or not api_key:
        return _fail("missing base_url or api_key")
    return await _probe_get(
        f"{base}/v1/health",
        headers={"X-API-Key": api_key},
    )


async def probe_lsq(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("region_host", "").rstrip("/")
    access = config.get("access_key", "")
    secret = config.get("secret_key", "")
    if not base or not access or not secret:
        return _fail("missing region_host, access_key, or secret_key")
    return await _probe_get(
        f"{base}/v2/Authentication.svc/UserKey.Get?accessKey={access}&secretKey={secret}",
        headers={},
    )


async def probe_msg91(config: dict[str, Any]) -> dict[str, Any]:
    auth_key = config.get("auth_key", "")
    if not auth_key:
        return _fail("missing auth_key")
    return await _probe_get(
        "https://api.msg91.com/api/v5/flow/list",
        headers={"authkey": auth_key},
    )


async def probe_webhook(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("base_url", "").rstrip("/")
    header_name = str(config.get("auth_header_name", "")).strip()
    header_value = str(config.get("auth_header_value", "")).strip()
    headers = {header_name: header_value} if header_name and header_value else {}
    if not base:
        return _ok("saved generic webhook auth profile")
    return await _probe_get(base, headers=headers)


_PROBES: dict[str, Any] = {
    "bolna": probe_bolna,
    "wati": probe_wati,
    "aisensy": probe_aisensy,
    "lsq": probe_lsq,
    "msg91": probe_msg91,
    "webhook": probe_webhook,
}


async def probe(provider: str, config: dict[str, Any]) -> dict[str, Any]:
    fn = _PROBES.get(provider)
    if fn is None:
        return _fail(f"unknown provider: {provider}")
    return await fn(config)
