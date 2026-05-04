"""WatiService — POST WATI templated messages.

Per WATI's current docs, the workspace exposes an "API Endpoint URL" plus
Bearer token. Some existing connections still save only the host and rely on
``wati_tenant_id`` to build the tenant-scoped endpoint. We normalize both
shapes to one per-tenant API root before calling v2 endpoints.

Tests monkeypatch _make_client to inject httpx.MockTransport (no respx dep).
4xx → WatiServiceError (non-retryable). 5xx / network → httpx.HTTPError (retry-safe).
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx


class WatiServiceError(RuntimeError):
    """Raised on 4xx — non-retryable client error from WATI."""


_TEMPLATE_PAGE_SIZE = 100
_MAX_TEMPLATE_PAGES = 20


def _make_client(timeout: float) -> httpx.AsyncClient:
    """Hook for tests: monkeypatch this to inject httpx.MockTransport."""
    return httpx.AsyncClient(timeout=timeout)


def resolve_wati_api_endpoint(base_url: str, wati_tenant_id: str) -> str:
    """Return the tenant-scoped WATI API endpoint without double-appending.

    WATI's UI now exposes a tenant-scoped "API Endpoint URL", but older saved
    connections in this codebase may still carry only the host. Accept both so
    existing connections keep working while new entries can paste the endpoint
    directly from WATI.
    """
    base = base_url.strip().rstrip("/")
    tenant = wati_tenant_id.strip().strip("/")
    parts = urlsplit(base)
    segments = [segment for segment in parts.path.split("/") if segment]
    if not segments or segments[-1] != tenant:
        segments.append(tenant)
    path = "/" + "/".join(segments)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


class WatiService:
    def __init__(self, *, base_url: str, wati_tenant_id: str, api_token: str, timeout: float = 30.0):
        if not base_url or not wati_tenant_id or not api_token:
            raise ValueError("WatiService requires base_url, wati_tenant_id, api_token")
        self._url = resolve_wati_api_endpoint(base_url, wati_tenant_id)
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

    async def get_message_templates(
        self,
        *,
        name: str | None = None,
        page_size: int | None = None,
        page_number: int | None = None,
    ) -> dict[str, Any] | list[Any]:
        url = f"{self._url}/api/v2/getMessageTemplates"
        params: dict[str, Any] = {}
        if name:
            params["name"] = name
        if page_size is not None:
            params["pageSize"] = page_size
        if page_number is not None:
            params["pageNumber"] = page_number
        async with _make_client(self._timeout) as client:
            resp = await client.get(url, headers=self._headers, params=params or None)
            if 400 <= resp.status_code < 500:
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = {"text": resp.text[:200]}
                raise WatiServiceError(f"WATI {resp.status_code}: {err_body}")
            resp.raise_for_status()
            return resp.json()

    async def list_message_templates_summary(self) -> list[dict[str, Any]]:
        """Phase 13/C.1 — fetch templates and normalise into the
        ``[{name, language, status, parameters}]`` shape the frontend
        picker consumes.

        WATI's payload varies between deployments — sometimes a list at
        the top, sometimes a dict with ``messageTemplates``/``templates``/
        ``data``/``result``. Parameter placeholders inside body components
        are extracted as the canonical ordered list of ``{{N}}`` numbered
        slots so the variable-mapping editor can drive off them.
        """
        out_by_name: dict[str, dict[str, Any]] = {}
        for page_number in range(1, _MAX_TEMPLATE_PAGES + 1):
            payload = await self.get_message_templates(
                page_size=_TEMPLATE_PAGE_SIZE,
                page_number=page_number,
            )
            candidates = _extract_template_candidates(payload)
            if not candidates:
                break
            _merge_candidates(out_by_name, candidates)
            if len(candidates) < _TEMPLATE_PAGE_SIZE:
                break

        return sorted(out_by_name.values(), key=lambda item: item["name"].lower())


def _extract_template_candidates(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if isinstance(payload, list):
        candidates = [item for item in payload if isinstance(item, dict)]
    elif isinstance(payload, dict):
        for key in ("messageTemplates", "templates", "data", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                candidates = [item for item in value if isinstance(item, dict)]
                break
    return candidates


def _merge_candidates(
    out_by_name: dict[str, dict[str, Any]],
    candidates: list[dict[str, Any]],
) -> None:
    for candidate in candidates:
        normalized = _normalize_template_candidate(candidate)
        if normalized is None:
            continue
        existing = out_by_name.get(normalized["name"])
        if existing is None:
            out_by_name[normalized["name"]] = normalized
            continue
        if not existing["language"] and normalized["language"]:
            existing["language"] = normalized["language"]
        if existing["status"] != "APPROVED" and normalized["status"] == "APPROVED":
            existing["status"] = normalized["status"]
        if _parameter_quality(normalized["parameters"]) > _parameter_quality(existing["parameters"]):
            existing["parameters"] = normalized["parameters"]


def _parameter_quality(parameters: list[str]) -> tuple[int, int]:
    if not parameters:
        return (0, 0)
    has_named_params = any(not param.isdigit() for param in parameters)
    return (2 if has_named_params else 1, len(parameters))


def _normalize_template_candidate(candidate: dict[str, Any]) -> dict[str, Any] | None:
    name = (
        candidate.get("template_name")
        or candidate.get("templateName")
        or candidate.get("elementName")
        or candidate.get("name")
        or ""
    )
    if not name:
        return None
    language = candidate.get("language") or candidate.get("templateLanguage") or ""
    if isinstance(language, dict):
        language = (
            language.get("value")
            or language.get("key")
            or language.get("text")
            or ""
        )
    return {
        "name": str(name),
        "language": str(language or ""),
        "status": str(
            candidate.get("status")
            or candidate.get("templateStatus")
            or ""
        ),
        "parameters": _extract_template_parameters(candidate),
    }


def _extract_template_parameters(candidate: dict[str, Any]) -> list[str]:
    """Return the ordered list of template placeholder names.

    Strategy:
      1. If the template carries a ``parameters`` / ``placeholders`` /
         ``variables`` list, take it verbatim. WATI templates that
         pre-declare names (e.g. ``["first_name", "city"]``) take this
         path.
      2. Otherwise scan ``components[].text`` (and a few legacy keys
         that surface the body string) for ``{{N}}`` placeholders and
         return them as ordered ``["1", "2", ...]`` strings, so the
         downstream variable-mapping editor at least knows the slot
         count.
    """
    for key in ("parameters", "placeholders", "variables", "customParams"):
        value = candidate.get(key)
        if isinstance(value, list) and value:
            names: list[str] = []
            for item in value:
                if isinstance(item, str):
                    names.append(item)
                elif isinstance(item, dict):
                    name = (
                        item.get("name")
                        or item.get("paramName")
                        or item.get("key")
                        or item.get("id")
                    )
                    if isinstance(name, str) and name:
                        names.append(name)
            if names:
                return names

    body_strings: list[str] = []
    components = candidate.get("components")
    if isinstance(components, list):
        for component in components:
            if isinstance(component, dict):
                text = component.get("text") or component.get("body")
                if isinstance(text, str):
                    body_strings.append(text)
    for legacy in ("body", "text", "message"):
        v = candidate.get(legacy)
        if isinstance(v, str):
            body_strings.append(v)

    import re
    found: list[str] = []
    seen: set[str] = set()
    for text in body_strings:
        for match in re.finditer(r"\{\{\s*([^}\s]+)\s*\}\}", text):
            slot = match.group(1).strip()
            if slot and slot not in seen:
                found.append(slot)
                seen.add(slot)
    return found
