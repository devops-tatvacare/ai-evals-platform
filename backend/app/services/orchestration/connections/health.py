"""Read-only test-connection probes per provider — return {ok, detail}, never raise."""
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


async def probe_webhook(config: dict[str, Any]) -> dict[str, Any]:
    base = config.get("base_url", "").rstrip("/")
    header_name = str(config.get("auth_header_name", "")).strip()
    header_value = str(config.get("auth_header_value", "")).strip()
    headers = {header_name: header_value} if header_name and header_value else {}
    if not base:
        return _ok("saved generic webhook auth profile")
    return await _probe_get(base, headers=headers)


_PROBES: dict[str, Any] = {
    "webhook": probe_webhook,
}


async def probe(provider: str, config: dict[str, Any]) -> dict[str, Any]:
    fn = _PROBES.get(provider)
    if fn is None:
        return _fail(f"unknown provider: {provider}")
    return await fn(config)
