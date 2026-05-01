"""WatiService — thin async wrapper over WATI v2 REST API.

Per concierge spec §5.3: tenant ID is part of base URL path. Bearer auth.
4xx → WatiServiceError (non-retryable). 5xx / network → httpx.HTTPError (retry-safe).
"""
from __future__ import annotations

import httpx
import pytest

from app.services.orchestration.integrations import wati as wati_mod
from app.services.orchestration.integrations.wati import WatiService, WatiServiceError


def _patch_transport(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        wati_mod, "_make_client",
        lambda timeout: httpx.AsyncClient(transport=transport, timeout=timeout),
    )


@pytest.mark.asyncio
async def test_send_template_happy_path(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json={
            "result": True, "info": "Success",
            "localMessageId": "lm-abc", "whatsappMessageId": "wm-xyz",
        })

    _patch_transport(monkeypatch, _handler)
    svc = WatiService(
        base_url="https://live-mt-server.wati.io",
        wati_tenant_id="12345", api_token="t",
    )
    out = await svc.send_template(
        whatsapp_number="919999999999",
        template_name="welcome_v1",
        broadcast_name="bcast-1",
        parameters=[{"name": "patient_name", "value": "Aarti"}],
    )
    assert out["localMessageId"] == "lm-abc"
    assert out["whatsappMessageId"] == "wm-xyz"
    assert "12345/api/v2/sendTemplateMessage" in captured["url"]
    assert "whatsappNumber=919999999999" in captured["url"]
    assert "welcome_v1" in captured["body"]
    assert "Aarti" in captured["body"]
    assert captured["auth"] == "Bearer t"


@pytest.mark.asyncio
async def test_4xx_raises_service_error(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"result": False, "info": "Invalid template"})

    _patch_transport(monkeypatch, _handler)
    svc = WatiService(base_url="https://live-mt-server.wati.io", wati_tenant_id="12345", api_token="t")
    with pytest.raises(WatiServiceError) as exc:
        await svc.send_template(
            whatsapp_number="919999999999", template_name="bad",
            broadcast_name="x", parameters=[],
        )
    assert "Invalid template" in str(exc.value)


@pytest.mark.asyncio
async def test_5xx_propagates_for_retry(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={})

    _patch_transport(monkeypatch, _handler)
    svc = WatiService(base_url="https://live-mt-server.wati.io", wati_tenant_id="12345", api_token="t")
    with pytest.raises(httpx.HTTPError):
        await svc.send_template(
            whatsapp_number="919999999999", template_name="x",
            broadcast_name="x", parameters=[],
        )


@pytest.mark.asyncio
async def test_get_message_templates_happy_path(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(
            200,
            json={"templates": [{"template_name": "welcome_v1", "parameters": [{"name": "first_name"}]}]},
        )

    _patch_transport(monkeypatch, _handler)
    svc = WatiService(
        base_url="https://live-mt-server.wati.io",
        wati_tenant_id="12345",
        api_token="t",
    )
    out = await svc.get_message_templates()
    assert out["templates"][0]["template_name"] == "welcome_v1"
    assert "12345/api/v2/getMessageTemplates" in captured["url"]
    assert captured["auth"] == "Bearer t"


def test_constructor_validates_required_fields():
    with pytest.raises(ValueError):
        WatiService(base_url="", wati_tenant_id="x", api_token="y")
    with pytest.raises(ValueError):
        WatiService(base_url="x", wati_tenant_id="", api_token="y")
    with pytest.raises(ValueError):
        WatiService(base_url="x", wati_tenant_id="y", api_token="")
