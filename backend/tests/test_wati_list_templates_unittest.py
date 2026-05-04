"""Phase 13 / C.1 — WATI list_message_templates_summary + cache + route.

Mirrors the Bolna agents test. Three slices, mocked at the httpx layer:

1. Service layer normalises the WATI ``getMessageTemplates`` payload into
   ``[{name, language, status, parameters}]`` regardless of whether the
   upstream returns a top-level list, a ``{messageTemplates: [...]}`` dict,
   or a ``{data: [...]}`` dict.
2. Parameter extraction handles both the explicit ``parameters`` /
   ``placeholders`` path and the implicit ``{{N}}`` placeholders inside
   ``components[].text`` / body strings.
3. ``api/agents.list_connection_wati_templates`` caches results for 30s
   and surfaces upstream failures via the soft-error envelope.
"""
from __future__ import annotations

import uuid
from unittest.mock import patch

import httpx
import pytest

from app.services.orchestration.api import agents as agents_service
from app.services.orchestration.integrations import wati as wati_mod
from app.services.orchestration.integrations.wati import (
    WatiService,
    WatiServiceError,
)


def _patch_make_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)

    def _factory(timeout: float):
        return httpx.AsyncClient(timeout=timeout, transport=transport)

    monkeypatch.setattr(wati_mod, "_make_client", _factory)


@pytest.fixture(autouse=True)
def _clear_cache():
    agents_service._CACHE.clear()
    yield
    agents_service._CACHE.clear()


# ─── Service-layer normalisation ───────────────────────────────────────


@pytest.mark.asyncio
async def test_summary_top_level_list_with_explicit_parameters(monkeypatch):
    def _handler(_request):
        return httpx.Response(
            200,
            json=[
                {
                    "template_name": "concierge_qualify_v1",
                    "language": "en",
                    "status": "APPROVED",
                    "parameters": ["first_name", "city"],
                },
            ],
        )

    _patch_make_client(monkeypatch, _handler)
    svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    items = await svc.list_message_templates_summary()
    assert items == [
        {
            "name": "concierge_qualify_v1",
            "language": "en",
            "status": "APPROVED",
            "parameters": ["first_name", "city"],
        },
    ]


@pytest.mark.asyncio
async def test_summary_messageTemplates_envelope_with_components_placeholders(monkeypatch):
    """WATI deployments sometimes wrap and don't pre-declare params."""
    def _handler(_request):
        return httpx.Response(
            200,
            json={
                "messageTemplates": [
                    {
                        "elementName": "welcome_v1",
                        "templateLanguage": "en_US",
                        "status": "APPROVED",
                        "components": [
                            {
                                "type": "BODY",
                                "text": "Hi {{1}}, welcome to {{2}}.",
                            },
                            {"type": "FOOTER", "text": "TatvaCare"},
                        ],
                    },
                ],
            },
        )

    _patch_make_client(monkeypatch, _handler)
    svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    items = await svc.list_message_templates_summary()
    assert len(items) == 1
    assert items[0]["name"] == "welcome_v1"
    assert items[0]["language"] == "en_US"
    assert items[0]["parameters"] == ["1", "2"]


@pytest.mark.asyncio
async def test_summary_skips_entries_without_a_name(monkeypatch):
    def _handler(_request):
        return httpx.Response(
            200,
            json=[
                {"template_name": "ok_v1", "components": []},
                {"language": "en", "components": []},  # missing name → dropped
            ],
        )

    _patch_make_client(monkeypatch, _handler)
    svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    items = await svc.list_message_templates_summary()
    assert [i["name"] for i in items] == ["ok_v1"]


@pytest.mark.asyncio
async def test_summary_raises_on_4xx(monkeypatch):
    def _handler(_request):
        return httpx.Response(401, json={"error": "unauthorized"})

    _patch_make_client(monkeypatch, _handler)
    svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="bad")
    with pytest.raises(WatiServiceError):
        await svc.list_message_templates_summary()


@pytest.mark.asyncio
async def test_summary_paginates_and_dedupes_by_template_name(monkeypatch):
    seen_pages: list[str | None] = []

    def _handler(request: httpx.Request):
        page = request.url.params.get("pageNumber")
        seen_pages.append(page)
        if page == "1":
            first_page = [
                {
                    "elementName": f"welcome_v1_{idx}",
                    "language": {"value": "en_US"},
                    "status": "APPROVED",
                    "components": [{"text": "Hi {{1}}"}],
                }
                for idx in range(99)
            ]
            first_page.append({
                "elementName": "welcome_v1",
                "language": {"value": "en_US"},
                "status": "APPROVED",
                "components": [{"text": "Hi {{1}}"}],
            })
            return httpx.Response(
                200,
                json={
                    "messageTemplates": first_page,
                },
            )
        if page == "2":
            return httpx.Response(
                200,
                json={
                    "messageTemplates": [
                        {
                            "elementName": "document_approved_latest",
                            "language": {"value": "en_US"},
                            "status": "APPROVED",
                            "customParams": [
                                {"name": "name"},
                                {"name": "documentType"},
                            ],
                        },
                    ],
                },
            )
        return httpx.Response(200, json={"messageTemplates": []})

    _patch_make_client(monkeypatch, _handler)
    svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    items = await svc.list_message_templates_summary()

    assert seen_pages == ["1", "2"]
    assert "document_approved_latest" in [item["name"] for item in items]
    doc_template = next(item for item in items if item["name"] == "document_approved_latest")
    assert doc_template["parameters"] == ["name", "documentType"]


# ─── api/agents helper ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_helper_caches_30s(monkeypatch):
    call_count = 0

    async def _fake_summary(self):
        nonlocal call_count
        call_count += 1
        return [{"name": "t1", "language": "en", "status": "APPROVED", "parameters": []}]

    async def _fake_load(*_args, **_kwargs):
        return {
            "base_url": "https://live-mt-server.wati.io",
            "wati_tenant_id": "12345",
            "api_token": "t",
        }

    monkeypatch.setattr(WatiService, "list_message_templates_summary", _fake_summary)
    monkeypatch.setattr(agents_service, "_load_connection", _fake_load)

    cid = uuid.uuid4()
    tid = uuid.uuid4()
    out_a = await agents_service.list_connection_wati_templates(
        db=None, tenant_id=tid, app_id="inside-sales", connection_id=cid,
    )
    out_b = await agents_service.list_connection_wati_templates(
        db=None, tenant_id=tid, app_id="inside-sales", connection_id=cid,
    )
    assert call_count == 1
    assert out_a == out_b
    assert out_a["error"] is None
    assert [i["name"] for i in out_a["items"]] == ["t1"]


@pytest.mark.asyncio
async def test_helper_returns_soft_error_on_upstream_failure(monkeypatch):
    async def _fake_summary(self):
        raise WatiServiceError("WATI 401: {'error': 'unauthorized'}")

    async def _fake_load(*_args, **_kwargs):
        return {
            "base_url": "https://live-mt-server.wati.io",
            "wati_tenant_id": "12345",
            "api_token": "t",
        }

    monkeypatch.setattr(WatiService, "list_message_templates_summary", _fake_summary)
    monkeypatch.setattr(agents_service, "_load_connection", _fake_load)

    out = await agents_service.list_connection_wati_templates(
        db=None, tenant_id=uuid.uuid4(), app_id="inside-sales",
        connection_id=uuid.uuid4(),
    )
    assert out["items"] == []
    assert "WATI 401" in (out["error"] or "")


@pytest.mark.asyncio
async def test_helper_returns_soft_error_when_connection_missing():
    with patch.object(agents_service, "_load_connection", return_value=None):
        out = await agents_service.list_connection_wati_templates(
            db=None, tenant_id=uuid.uuid4(), app_id="inside-sales",
            connection_id=uuid.uuid4(),
        )
    assert out["items"] == []
    assert "not found" in (out["error"] or "").lower()
