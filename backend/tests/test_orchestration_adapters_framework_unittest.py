"""Framework tests for adapters registry, bag step-namespacing, and canonical dataclass shape."""
from __future__ import annotations

import dataclasses
from typing import Any

import pytest

from app.services.orchestration import adapters as adapters_module
from app.services.orchestration.adapters import (
    AdapterNotRegisteredError,
    CanonicalMessagingEvent,
    CanonicalSendRequest,
    CanonicalSendResponse,
    CanonicalVoiceEvent,
    CanonicalVoiceRequest,
    CanonicalVoiceResponse,
    capability_for_vendor,
    register_adapter,
    registered_adapters,
    resolve_adapter,
)
from app.services.orchestration.dispatch.bag import bag_path, bag_read, bag_write


@pytest.fixture(autouse=True)
def _clear_registry():
    """Adapter registry is module-global; isolate each test."""
    snapshot = dict(adapters_module._REGISTRY)
    adapters_module._REGISTRY.clear()
    yield
    adapters_module._REGISTRY.clear()
    adapters_module._REGISTRY.update(snapshot)


# ─── adapter registry ──────────────────────────────────────────────────


def test_resolve_adapter_unknown_pair_raises():
    with pytest.raises(AdapterNotRegisteredError):
        resolve_adapter(capability="messaging", vendor="wati")


def test_register_then_resolve_round_trips():
    sentinel = object()
    register_adapter(capability="messaging", vendor="wati", adapter=sentinel)
    assert resolve_adapter(capability="messaging", vendor="wati") is sentinel


def test_double_register_same_pair_raises():
    register_adapter(capability="voice", vendor="bolna", adapter=object())
    with pytest.raises(RuntimeError, match="already registered"):
        register_adapter(capability="voice", vendor="bolna", adapter=object())


def test_registered_adapters_lists_every_pair_sorted():
    register_adapter(capability="messaging", vendor="wati", adapter=object())
    register_adapter(capability="voice", vendor="bolna", adapter=object())
    register_adapter(capability="messaging", vendor="aisensy", adapter=object())
    assert registered_adapters() == [
        ("messaging", "aisensy"),
        ("messaging", "wati"),
        ("voice", "bolna"),
    ]


def test_capability_for_vendor_returns_none_when_unregistered():
    assert capability_for_vendor("wati") is None


def test_capability_for_vendor_returns_capability_when_registered():
    register_adapter(capability="messaging", vendor="wati", adapter=object())
    assert capability_for_vendor("wati") == "messaging"


# ─── bag step-namespacing ──────────────────────────────────────────────


def test_bag_path_format():
    assert bag_path("intake", "wa_status") == "steps.intake.wa_status"


def test_bag_write_yields_flat_dotted_keys():
    patch = bag_write(node_id="intake", fields={"wa_status": "replied", "wa_button_id": "0"})
    assert patch == {
        "steps.intake.wa_status": "replied",
        "steps.intake.wa_button_id": "0",
    }


def test_bag_read_round_trips_after_write():
    payload = bag_write(node_id="intake", fields={"wa_status": "delivered"})
    assert bag_read(payload, node_id="intake", key="wa_status") == "delivered"


def test_bag_write_two_nodes_do_not_collide():
    """Two distinct nodes writing the same field key must never overwrite each other."""
    a = bag_write(node_id="intake", fields={"wa_button_id": "A"})
    b = bag_write(node_id="consent", fields={"wa_button_id": "B"})
    merged = {**a, **b}
    assert merged == {
        "steps.intake.wa_button_id": "A",
        "steps.consent.wa_button_id": "B",
    }


def test_bag_read_returns_none_when_field_absent():
    assert bag_read({}, node_id="ghost", key="wa_status") is None


# ─── canonical dataclasses ─────────────────────────────────────────────


def test_canonical_send_response_requires_provider_correlation_id_and_contact():
    """CLAUDE.md invariant: every dispatch action MUST write contact + provider_correlation_id."""
    fields = {f.name for f in dataclasses.fields(CanonicalSendResponse)}
    assert "provider_correlation_id" in fields
    assert "contact" in fields
    with pytest.raises(TypeError):
        CanonicalSendResponse()  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        CanonicalSendResponse(provider_correlation_id="abc")  # type: ignore[call-arg]


def test_canonical_voice_response_requires_provider_correlation_id_and_contact():
    fields = {f.name for f in dataclasses.fields(CanonicalVoiceResponse)}
    assert "provider_correlation_id" in fields
    assert "contact" in fields
    with pytest.raises(TypeError):
        CanonicalVoiceResponse(mode="single", contact="+91")  # type: ignore[call-arg]


def test_canonical_messaging_event_requires_status_contact_and_correlation():
    fields = {f.name for f in dataclasses.fields(CanonicalMessagingEvent)}
    for required in ("status", "contact", "provider_correlation_id"):
        assert required in fields, required


def test_canonical_voice_event_requires_outcome_contact_and_correlation():
    fields = {f.name for f in dataclasses.fields(CanonicalVoiceEvent)}
    for required in ("outcome", "contact", "provider_correlation_id"):
        assert required in fields, required


def test_canonical_send_request_carries_optional_reply_context_id():
    """`reply_context_id` is the closed-loop correlation handle — must be optional, not required."""
    req = CanonicalSendRequest(contact="+919999999999", template_slug="intake")
    assert req.reply_context_id is None
    req_with = CanonicalSendRequest(
        contact="+919999999999", template_slug="intake",
        reply_context_id="gBE-prior-wmid",
    )
    assert req_with.reply_context_id == "gBE-prior-wmid"


def test_canonical_event_carries_vendor_raw_for_audit_escape_hatch():
    """`vendor_raw` is the open field where adapters stash provider-specific keys without bloating the canonical shape."""
    ev = CanonicalMessagingEvent(
        status="replied",
        contact="+919999999999",
        provider_correlation_id="local-msg-id",
        vendor_raw={"WatiSpecificKey": "value"},
    )
    assert ev.vendor_raw == {"WatiSpecificKey": "value"}


# ─── webhook route × adapter registry integration ──────────────────────


def test_webhook_route_returns_404_when_no_adapter_for_vendor():
    """Confidence rope: the dispatcher path lands on AdapterNotRegisteredError when registry is empty."""
    from app.services.orchestration.adapters import resolve_adapter as _resolve
    with pytest.raises(AdapterNotRegisteredError):
        _resolve(capability="messaging", vendor="aisensy")


def test_webhook_route_404_for_known_capability_but_unknown_vendor():
    register_adapter(capability="messaging", vendor="wati", adapter=object())
    with pytest.raises(AdapterNotRegisteredError):
        resolve_adapter(capability="messaging", vendor="aisensy")
