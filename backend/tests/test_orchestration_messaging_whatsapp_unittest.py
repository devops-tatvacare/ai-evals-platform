"""Pure unit/contract tests for messaging.send_whatsapp_template + WATI + AiSensy adapters.

No live HTTP. WATI/AiSensy outbound paths exercised via httpx.MockTransport.
Webhook normalization tested against verbatim payload fixtures pulled from
the plan's evidence section (docs/plans/2026-05-18-orchestration-vendor-abstraction/README.md §2.3).
"""
from __future__ import annotations

import json
import uuid

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.services.orchestration.adapters.aisensy import (
    AiSensyAdapter,
    AiSensyServiceError,
)
from app.services.orchestration.adapters.canonical import (
    CanonicalSendRequest,
)
from app.services.orchestration.adapters.wati import (
    WatiAdapter,
    WatiServiceError,
    _extract_button_id,
    _extract_local_message_id,
    _extract_reply_text,
    _extract_reply_type,
    _strip_plus,
    resolve_wati_api_endpoint,
)
from app.services.orchestration.nodes.messaging_send_whatsapp_template import (
    _Config,
)


# ─── _Config strictness ─────────────────────────────────────────────────────


def test_config_minimum_required_fields():
    cid = uuid.uuid4()
    cfg = _Config(connection_id=cid, template_slug="welcome_v1")
    assert cfg.connection_id == cid
    assert cfg.template_slug == "welcome_v1"
    assert cfg.variable_mappings == {}
    assert cfg.webhook_ttl_seconds == 259200  # 3 days


def test_config_rejects_unknown_keys():
    with pytest.raises(ValidationError) as exc_info:
        _Config(
            connection_id=uuid.uuid4(),
            template_slug="welcome_v1",
            unknown_field="should_be_rejected",
        )
    assert any(
        err.get("type") == "extra_forbidden"
        for err in exc_info.value.errors()
    )


def test_config_template_slug_required_non_empty():
    with pytest.raises(ValidationError):
        _Config(connection_id=uuid.uuid4(), template_slug="")


def test_config_webhook_ttl_seconds_min_60():
    with pytest.raises(ValidationError):
        _Config(
            connection_id=uuid.uuid4(),
            template_slug="x",
            webhook_ttl_seconds=30,
        )


# ─── WATI helpers ───────────────────────────────────────────────────────────


def test_resolve_wati_api_endpoint_appends_tenant_when_missing():
    assert (
        resolve_wati_api_endpoint("https://live-mt-server.wati.io", "12345")
        == "https://live-mt-server.wati.io/12345"
    )


def test_resolve_wati_api_endpoint_no_double_append():
    assert (
        resolve_wati_api_endpoint("https://live-mt-server.wati.io/12345", "12345")
        == "https://live-mt-server.wati.io/12345"
    )


def test_strip_plus():
    assert _strip_plus("+919999999999") == "919999999999"
    assert _strip_plus("919999999999") == "919999999999"


def test_extract_local_message_id_v2_top_level():
    assert _extract_local_message_id({"localMessageId": "abc-123"}) == "abc-123"


def test_extract_local_message_id_v1_receivers():
    payload = {"receivers": [{"localMessageId": "v1-xyz", "waId": "91..."}]}
    assert _extract_local_message_id(payload) == "v1-xyz"


def test_extract_local_message_id_missing():
    assert _extract_local_message_id({"unrelated": "data"}) is None


# ─── WATI webhook normalization — verbatim §2.3 fixtures ────────────────────


REPLY_BUTTON_FIXTURE = {
    "eventType": "sentMessageREPLIED_v2",
    "statusString": "Replied",
    "localMessageId": "d38f0c3a-e833-4725-a894-53a2b1dc1af6",
    "id": "640c8fd48b67615f886237b8",
    "whatsappMessageId": "gBEGkXmJQZVJAgkRHwjjZsITS6M",
    "replyContextId": "OLD_OUTBOUND_WA_MSG_ID",
    "waId": "919999999999",
    "buttonReply": {
        "payload": '{"ButtonIndex":0,"CarouselCardIndex":null,"BroadcastLinkId":"676a9b2e57150cedccdb7a17"}',
        "text": "Tell me more",
    },
}


MESSAGE_RECEIVED_TEXT_FIXTURE = {
    "eventType": "messageReceived",
    "localMessageId": "lm-text-1",
    "waId": "919999999999",
    "type": "text",
    "text": "Yes please",
}


MESSAGE_RECEIVED_LIST_FIXTURE = {
    "eventType": "messageReceived",
    "localMessageId": "lm-list-1",
    "waId": "919999999999",
    "listReply": {"id": "row_2", "title": "Tuesday morning"},
}


TEMPLATE_FAILED_FIXTURE = {
    "eventType": "templateMessageFailed",
    "localMessageId": "lm-fail-1",
    "waId": "919999999999",
    "statusString": "Failed",
}


def test_normalize_button_reply():
    ev = WatiAdapter().normalize_webhook(REPLY_BUTTON_FIXTURE)
    assert ev.status == "replied"
    assert ev.contact == "919999999999"
    assert ev.provider_correlation_id == "d38f0c3a-e833-4725-a894-53a2b1dc1af6"
    assert ev.reply_context_id == "OLD_OUTBOUND_WA_MSG_ID"
    assert ev.reply_type == "button"
    assert ev.reply_text == "Tell me more"
    assert ev.button_id == "0"
    assert ev.list_id is None


def test_normalize_text_reply():
    ev = WatiAdapter().normalize_webhook(MESSAGE_RECEIVED_TEXT_FIXTURE)
    assert ev.status == "replied"
    assert ev.reply_type == "text"
    assert ev.reply_text == "Yes please"
    assert ev.button_id is None
    assert ev.list_id is None


def test_normalize_list_reply():
    ev = WatiAdapter().normalize_webhook(MESSAGE_RECEIVED_LIST_FIXTURE)
    assert ev.status == "replied"
    assert ev.reply_type == "list"
    assert ev.list_id == "row_2"
    assert ev.button_id is None


def test_normalize_template_failed():
    ev = WatiAdapter().normalize_webhook(TEMPLATE_FAILED_FIXTURE)
    assert ev.status == "failed"
    assert ev.reply_type is None  # failed is not a reply event
    assert ev.button_id is None


def test_normalize_unknown_event():
    ev = WatiAdapter().normalize_webhook({"eventType": "nonsense"})
    assert ev.status == "unknown"


def test_extract_button_id_handles_corrupt_json():
    # Defensive: a malformed payload string must not raise — adapter falls back.
    assert _extract_button_id({"buttonReply": {"payload": "not-json"}}) is None


def test_extract_reply_text_prefers_text_over_messageBody():
    assert _extract_reply_text({"text": "primary", "messageBody": "secondary"}) == "primary"


def test_extract_reply_type_for_interactive_button():
    assert _extract_reply_type({"interactiveButtonReply": {"buttonId": "b1"}}) == "button"


# ─── WATI send_template — via MockTransport (no live HTTP) ──────────────────


def _connection(channel_numbers=("+919811111111",)):
    return {
        "base_url": "https://live-mt-server.wati.io",
        "wati_tenant_id": "12345",
        "api_token": "test-token",
        "channel_numbers": list(channel_numbers),
        "__provider__": "wati",
    }


@pytest.mark.asyncio
async def test_send_template_happy_path(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        captured["headers"] = dict(request.headers)
        return httpx.Response(
            200, json={"localMessageId": "lm-happy", "whatsappMessageId": "wam-1"},
        )

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.wati._make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )

    adapter = WatiAdapter()
    request = CanonicalSendRequest(
        contact="+919999999999",
        template_slug="welcome_v1",
        variables={"name": "Dhruv", "appointment": "Tuesday 3pm"},
    )
    response = await adapter.send_template(
        connection=_connection(), request=request,
    )

    assert response.provider_correlation_id == "lm-happy"
    assert response.contact == "+919999999999"
    assert "whatsappNumber=919999999999" in captured["url"]
    assert captured["url"].endswith("/api/v2/sendTemplateMessage?whatsappNumber=919999999999")
    assert captured["body"]["template_name"] == "welcome_v1"
    assert captured["body"]["broadcast_name"] == "welcome_v1"
    assert captured["body"]["channel_number"] == "+919811111111"
    assert captured["body"]["parameters"] == [
        {"name": "name", "value": "Dhruv"},
        {"name": "appointment", "value": "Tuesday 3pm"},
    ]
    assert captured["headers"]["authorization"] == "Bearer test-token"


@pytest.mark.asyncio
async def test_send_template_4xx_raises_service_error(monkeypatch):
    transport = httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": "invalid_template"}),
    )
    monkeypatch.setattr(
        "app.services.orchestration.adapters.wati._make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )

    with pytest.raises(WatiServiceError) as exc:
        await WatiAdapter().send_template(
            connection=_connection(),
            request=CanonicalSendRequest(contact="+91999", template_slug="x"),
        )
    assert "400" in str(exc.value)


@pytest.mark.asyncio
async def test_send_template_missing_local_message_id_raises(monkeypatch):
    transport = httpx.MockTransport(
        lambda r: httpx.Response(200, json={"unrelated": "no_id_here"}),
    )
    monkeypatch.setattr(
        "app.services.orchestration.adapters.wati._make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )

    with pytest.raises(WatiServiceError) as exc:
        await WatiAdapter().send_template(
            connection=_connection(),
            request=CanonicalSendRequest(contact="+91999", template_slug="x"),
        )
    assert "localMessageId" in str(exc.value)


@pytest.mark.asyncio
async def test_send_template_missing_connection_fields():
    with pytest.raises(WatiServiceError):
        await WatiAdapter().send_template(
            connection={"base_url": "https://x", "wati_tenant_id": "", "api_token": "t"},
            request=CanonicalSendRequest(contact="+91999", template_slug="x"),
        )


# ─── AiSensy skeleton ───────────────────────────────────────────────────────


def test_aisensy_normalize_webhook_is_not_implemented():
    with pytest.raises(NotImplementedError) as exc:
        AiSensyAdapter().normalize_webhook({"any": "thing"})
    assert "AiSensy" in str(exc.value)
    assert "field mapping is pending" in str(exc.value)


@pytest.mark.asyncio
async def test_aisensy_handle_webhook_returns_503():
    adapter = AiSensyAdapter()
    with pytest.raises(HTTPException) as exc:
        await adapter.handle_webhook(
            db=None,  # type: ignore[arg-type]
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            payload={"any": "inbound"},
        )
    assert exc.value.status_code == 503
    detail = str(exc.value.detail)
    # decodeApiError-compatible: detail is a non-empty string (FE renders via summarizeApiErrorBody)
    assert "Inbound" in detail
    assert "Outbound" in detail
    assert "pending" in detail


@pytest.mark.asyncio
async def test_aisensy_send_template_happy_path(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.aisensy._make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )

    connection = {
        "api_key": "secret-key",
        "base_url": "https://backend.aisensy.com",
        "from_number": "+919811111111",
        "campaign_partner_id": "p123",
        "__provider__": "aisensy",
    }
    request = CanonicalSendRequest(
        contact="919999999999",
        template_slug="onboarding_v2",
        variables={"name": "Dhruv", "slot": "Tuesday"},
    )
    response = await AiSensyAdapter().send_template(
        connection=connection, request=request,
    )

    assert captured["url"] == "https://backend.aisensy.com/campaign/t1/api/v2"
    assert captured["body"]["apiKey"] == "secret-key"
    assert captured["body"]["campaignName"] == "onboarding_v2"
    assert captured["body"]["destination"] == "919999999999"
    assert captured["body"]["templateParams"] == ["Dhruv", "Tuesday"]
    assert response.contact == "919999999999"
    assert response.provider_correlation_id.startswith("aisensy:919999999999:onboarding_v2:")


@pytest.mark.asyncio
async def test_aisensy_send_template_4xx_raises(monkeypatch):
    transport = httpx.MockTransport(
        lambda r: httpx.Response(401, json={"error": "bad_key"}),
    )
    monkeypatch.setattr(
        "app.services.orchestration.adapters.aisensy._make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )

    with pytest.raises(AiSensyServiceError):
        await AiSensyAdapter().send_template(
            connection={"api_key": "k", "base_url": "https://x"},
            request=CanonicalSendRequest(contact="91999", template_slug="x"),
        )


# ─── Adapter registry — boot integration ────────────────────────────────────


def test_messaging_adapters_registered_at_module_import():
    # Both adapter modules self-register on import; confirm both keys are present.
    from app.services.orchestration.adapters import registered_adapters

    keys = dict.fromkeys(registered_adapters())
    assert ("messaging", "wati") in keys
    assert ("messaging", "aisensy") in keys
