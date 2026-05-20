"""Pure unit/contract tests for voice.place_call + BolnaAdapter.

No live HTTP. Bolna outbound paths exercised via httpx.MockTransport.
Webhook normalization tested against verbatim payload fixtures matching
the field set documented at https://www.bolna.ai/docs.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from pydantic import ValidationError

from app.services.orchestration.adapters import (
    registered_adapters,
    resolve_adapter,
)
from app.services.orchestration.adapters.bolna import (
    BolnaAdapter,
    BolnaServiceError,
    _build_batch_csv,
    _extract_capture,
    _normalize_cost_scalar,
    _resolve_from_phone,
    classify_outcome,
    is_terminal,
)
from app.services.orchestration.adapters.canonical import (
    CanonicalVoiceRequest,
)
from app.services.orchestration.nodes.voice_place_call import _Config


# ─── _Config strictness ─────────────────────────────────────────────────────


def test_config_minimum_required_fields():
    cid = uuid.uuid4()
    cfg = _Config(connection_id=cid, agent_id="agent_xyz")
    assert cfg.connection_id == cid
    assert cfg.agent_id == "agent_xyz"
    assert cfg.variable_mappings == {}
    assert cfg.from_phone is None
    assert cfg.webhook_ttl_seconds == 259200


def test_config_rejects_unknown_keys():
    with pytest.raises(ValidationError) as exc_info:
        _Config(
            connection_id=uuid.uuid4(),
            agent_id="agent_xyz",
            unknown_field="boom",
        )
    assert any(
        err.get("type") == "extra_forbidden"
        for err in exc_info.value.errors()
    )


def test_config_agent_id_required_non_empty():
    with pytest.raises(ValidationError):
        _Config(connection_id=uuid.uuid4(), agent_id="")


def test_config_webhook_ttl_seconds_min_60():
    with pytest.raises(ValidationError):
        _Config(
            connection_id=uuid.uuid4(),
            agent_id="a",
            webhook_ttl_seconds=30,
        )


def test_config_accepts_from_phone():
    cfg = _Config(
        connection_id=uuid.uuid4(),
        agent_id="a",
        from_phone="+919999999999",
    )
    assert cfg.from_phone == "+919999999999"


def test_config_mode_defaults_to_auto():
    cfg = _Config(connection_id=uuid.uuid4(), agent_id="a")
    assert cfg.mode == "auto"


@pytest.mark.parametrize("mode", ["auto", "single", "batch"])
def test_config_mode_accepts_valid_values(mode):
    cfg = _Config(connection_id=uuid.uuid4(), agent_id="a", mode=mode)
    assert cfg.mode == mode


def test_config_mode_rejects_unknown_values():
    with pytest.raises(ValidationError):
        _Config(connection_id=uuid.uuid4(), agent_id="a", mode="parallel")


# ─── classify_outcome (lifted, pure function) ───────────────────────────────


@pytest.mark.parametrize("status,reason,expected", [
    ("completed", None, "bolna_answered"),
    ("answered", None, "bolna_answered"),
    ("success", None, "bolna_answered"),
    ("completed", "user-hangup", "bolna_answered"),
    # RNR family
    ("completed", "no-answer", "bolna_rnr"),
    ("no-answer", None, "bolna_rnr"),
    ("rnr", None, "bolna_rnr"),
    ("busy", None, "bolna_rnr"),
    ("completed", "rnr", "bolna_rnr"),
    # Failure family
    ("failed", None, "bolna_failed"),
    ("error", None, "bolna_failed"),
    ("balance-low", None, "bolna_failed"),
    ("canceled", None, "bolna_failed"),
    (None, None, "bolna_failed"),
])
def test_classify_outcome(status, reason, expected):
    assert classify_outcome(status, reason) == expected


@pytest.mark.parametrize("status,expected", [
    ("completed", True), ("answered", True), ("failed", True),
    ("no-answer", True), ("rnr", True), ("busy", True),
    ("queued", False), ("in-progress", False), ("ringing", False),
    (None, False), ("", False),
])
def test_is_terminal(status, expected):
    assert is_terminal(status) is expected


# ─── from_phone three-tier fallback ─────────────────────────────────────────


def test_from_phone_per_call_override_wins():
    assert _resolve_from_phone(
        override="+911111111111", connection_default="+922222222222",
    ) == "+911111111111"


def test_from_phone_connection_default_used_when_override_empty():
    assert _resolve_from_phone(
        override="", connection_default="+922222222222",
    ) == "+922222222222"


def test_from_phone_connection_default_used_when_override_whitespace():
    assert _resolve_from_phone(
        override="   ", connection_default="+922222222222",
    ) == "+922222222222"


def test_from_phone_delegates_to_agent_default_when_both_empty():
    assert _resolve_from_phone(override="", connection_default="") is None
    assert _resolve_from_phone(override=None, connection_default=None) is None
    assert _resolve_from_phone(override="  ", connection_default="  ") is None


def test_from_phone_override_none_falls_to_connection():
    assert _resolve_from_phone(
        override=None, connection_default="+922222222222",
    ) == "+922222222222"


# ─── Cost normalization (subunits → major units) ───────────────────────────


def test_normalize_cost_scalar_subunit_conversion():
    # Bolna: 27.04 displayed dashboard value 0.2704
    assert _normalize_cost_scalar(27.04) == 0.2704
    assert _normalize_cost_scalar("27.04") == 0.2704
    assert _normalize_cost_scalar(0) == 0.0
    assert _normalize_cost_scalar(None) is None
    assert _normalize_cost_scalar(True) is True  # bool passthrough


# ─── _extract_capture against verbatim Bolna webhook fixture ───────────────


_BOLNA_COMPLETED_FIXTURE = {
    "execution_id": "exec_abc123",
    "status": "completed",
    "status_reason": "user-hangup",
    "recipient_phone_number": "+919999999999",
    "duration": 42,
    "transcript": "Agent: Hi. User: Hello.",
    "recording_url": "https://bolna.s3/abc.mp3",
    "total_cost": 27.04,
    "user_data": {"recipient_id": "rid-1", "lead_name": "Aman"},
}

_BOLNA_NOANSWER_FIXTURE = {
    "execution_id": "exec_def456",
    "status": "no-answer",
    "status_reason": "no-answer",
    "recipient_phone_number": "+919999999999",
    "duration": 0,
    "user_data": {"recipient_id": "rid-2"},
}

_BOLNA_FAILED_FIXTURE = {
    "execution_id": "exec_ghi789",
    "status": "failed",
    "status_reason": "balance-low",
    "recipient_phone_number": "+919999999999",
    "user_data": {"recipient_id": "rid-3"},
}


def test_extract_capture_pulls_top_level_fields():
    out = _extract_capture(_BOLNA_COMPLETED_FIXTURE)
    assert out["transcript"] == "Agent: Hi. User: Hello."
    assert out["recording_url"] == "https://bolna.s3/abc.mp3"
    assert out["duration_sec"] == 42
    assert out["total_cost"] == 0.2704
    assert out["hangup_reason"] == "user-hangup"


def test_extract_capture_handles_telephony_data_nesting():
    raw = {
        "execution_id": "exec_x",
        "status": "completed",
        "telephony_data": {
            "duration_seconds": 17,
            "recording_url": "https://bolna.s3/tele.mp3",
        },
    }
    out = _extract_capture(raw)
    assert out["duration_sec"] == 17
    assert out["recording_url"] == "https://bolna.s3/tele.mp3"


# ─── normalize_webhook ──────────────────────────────────────────────────────


def test_normalize_webhook_completed_event():
    adapter = BolnaAdapter()
    ev = adapter.normalize_webhook(_BOLNA_COMPLETED_FIXTURE)
    assert ev.outcome == "answered"
    assert ev.contact == "+919999999999"
    assert ev.provider_correlation_id == "exec_abc123"
    assert ev.duration_sec == 42
    assert ev.transcript == "Agent: Hi. User: Hello."
    assert ev.recording_url == "https://bolna.s3/abc.mp3"
    assert ev.vendor_raw == _BOLNA_COMPLETED_FIXTURE


def test_normalize_webhook_noanswer_event():
    adapter = BolnaAdapter()
    ev = adapter.normalize_webhook(_BOLNA_NOANSWER_FIXTURE)
    assert ev.outcome == "no_answer"
    assert ev.provider_correlation_id == "exec_def456"
    assert ev.duration_sec == 0


def test_normalize_webhook_failed_event():
    adapter = BolnaAdapter()
    ev = adapter.normalize_webhook(_BOLNA_FAILED_FIXTURE)
    assert ev.outcome == "failed"
    assert ev.provider_correlation_id == "exec_ghi789"


def test_normalize_webhook_falls_to_batch_id_when_no_execution_id():
    raw = {
        "batch_id": "batch_xyz",
        "status": "completed",
        "recipient_phone_number": "+919999999999",
    }
    ev = BolnaAdapter().normalize_webhook(raw)
    assert ev.provider_correlation_id == "batch_xyz"


# ─── place_call via httpx.MockTransport ─────────────────────────────────────


def _client_with_transport(transport: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=transport, timeout=10.0)


@pytest.mark.asyncio
async def test_place_call_single_happy_path(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        import json as _json
        captured["body"] = _json.loads(request.content.decode())
        return httpx.Response(200, json={
            "message": "queued", "status": "queued",
            "execution_id": "exec_abc123",
        })

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    resp = await adapter.place_call(
        connection={"api_key": "k", "base_url": "https://api.bolna.ai", "from_phone": "+91999"},
        request=CanonicalVoiceRequest(
            contact="+919999999999",
            agent_id="agent_xyz",
            variables={"lead_name": "Aman", "recipient_id": "rid-1"},
            from_phone=None,
        ),
    )
    assert resp.provider_correlation_id == "exec_abc123"
    assert resp.contact == "+919999999999"
    assert resp.mode == "single"
    assert captured["url"] == "https://api.bolna.ai/call"
    assert captured["headers"]["authorization"] == "Bearer k"
    assert captured["body"]["agent_id"] == "agent_xyz"
    assert captured["body"]["recipient_phone_number"] == "+919999999999"
    # Connection from_phone used (override empty)
    assert captured["body"]["from_phone_number"] == "+91999"
    assert captured["body"]["user_data"]["lead_name"] == "Aman"
    assert captured["body"]["user_data"]["recipient_id"] == "rid-1"


@pytest.mark.asyncio
async def test_place_call_per_call_from_phone_overrides_connection(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["body"] = _json.loads(request.content.decode())
        return httpx.Response(200, json={"execution_id": "exec_x"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    await adapter.place_call(
        connection={"api_key": "k", "from_phone": "+91999"},
        request=CanonicalVoiceRequest(
            contact="+91888",
            agent_id="a",
            variables={},
            from_phone="+91777",
        ),
    )
    assert captured["body"]["from_phone_number"] == "+91777"


@pytest.mark.asyncio
async def test_place_call_no_from_phone_anywhere_omits_field(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["body"] = _json.loads(request.content.decode())
        return httpx.Response(200, json={"execution_id": "exec_x"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    await adapter.place_call(
        connection={"api_key": "k"},
        request=CanonicalVoiceRequest(
            contact="+91888", agent_id="a", variables={}, from_phone=None,
        ),
    )
    assert "from_phone_number" not in captured["body"]


@pytest.mark.asyncio
async def test_place_call_4xx_raises_bolna_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"detail": "bad agent"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    with pytest.raises(BolnaServiceError, match="Bolna 400"):
        await adapter.place_call(
            connection={"api_key": "k"},
            request=CanonicalVoiceRequest(
                contact="+91", agent_id="a", variables={}, from_phone=None,
            ),
        )


@pytest.mark.asyncio
async def test_place_call_missing_execution_id_raises(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": "queued"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    with pytest.raises(BolnaServiceError, match="missing execution_id"):
        await adapter.place_call(
            connection={"api_key": "k"},
            request=CanonicalVoiceRequest(
                contact="+91", agent_id="a", variables={}, from_phone=None,
            ),
        )


# ─── place_call_batch ───────────────────────────────────────────────────────


def test_build_batch_csv_columns_stable():
    reqs = [
        CanonicalVoiceRequest(
            contact="+9111", agent_id="a", variables={"name": "A", "city": "Mumbai"},
        ),
        CanonicalVoiceRequest(
            contact="+9112", agent_id="a", variables={"name": "B", "city": "Pune"},
        ),
    ]
    csv_bytes = _build_batch_csv(requests=reqs, recipient_ids=["r1", "r2"])
    text = csv_bytes.decode()
    lines = text.strip().split("\r\n") if "\r\n" in text else text.strip().split("\n")
    header = lines[0].split(",")
    assert "contact_number" in header
    assert "recipient_id" in header
    assert "city" in header
    assert "name" in header
    # Verify cohort rows
    assert any("+9111" in line and "r1" in line for line in lines[1:])
    assert any("+9112" in line and "r2" in line for line in lines[1:])


@pytest.mark.asyncio
async def test_place_call_batch_happy_path(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        captured["content"] = request.content
        return httpx.Response(200, json={"batch_id": "batch_xyz", "message": "queued"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=30.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    reqs = [
        CanonicalVoiceRequest(
            contact=f"+9111111111{i}", agent_id="agent_xyz",
            variables={"recipient_id": f"r{i}"},
        )
        for i in range(10)
    ]
    rids = [f"r{i}" for i in range(10)]

    responses = await adapter.place_call_batch(
        connection={"api_key": "k", "base_url": "https://api.bolna.ai", "from_phone": "+91999"},
        requests=reqs,
        recipient_ids=rids,
    )

    assert len(responses) == 10
    assert all(r.provider_correlation_id == "batch_xyz" for r in responses)
    assert all(r.mode == "batch" for r in responses)
    assert captured["url"] == "https://api.bolna.ai/batches"
    # Multipart upload — content includes both form fields and CSV
    body = captured["content"].decode(errors="ignore")
    assert "agent_id" in body
    assert "agent_xyz" in body
    assert "+91999" in body  # from_phone passed through


@pytest.mark.asyncio
async def test_place_call_batch_empty_returns_empty():
    adapter = BolnaAdapter()
    out = await adapter.place_call_batch(
        connection={"api_key": "k"}, requests=[], recipient_ids=[],
    )
    assert out == []


@pytest.mark.asyncio
async def test_place_call_batch_4xx_raises(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "bad csv"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.services.orchestration.adapters.bolna._make_client",
        lambda timeout=60.0: _client_with_transport(transport),
    )

    adapter = BolnaAdapter()
    with pytest.raises(BolnaServiceError, match="Bolna 422"):
        await adapter.place_call_batch(
            connection={"api_key": "k"},
            requests=[CanonicalVoiceRequest(contact="+91", agent_id="a", variables={})],
            recipient_ids=["r1"],
        )


@pytest.mark.asyncio
async def test_place_call_batch_mismatched_lengths_raises():
    adapter = BolnaAdapter()
    with pytest.raises(BolnaServiceError, match="length mismatch"):
        await adapter.place_call_batch(
            connection={"api_key": "k"},
            requests=[CanonicalVoiceRequest(contact="+91", agent_id="a", variables={})],
            recipient_ids=["r1", "r2"],
        )


# ─── Registry integration ──────────────────────────────────────────────────


def test_bolna_adapter_registered():
    # Importing the module above triggers register_adapter().
    assert ("voice", "bolna") in registered_adapters()
    adapter = resolve_adapter(capability="voice", vendor="bolna")
    assert adapter.capability == "voice"
    assert adapter.vendor == "bolna"
    assert adapter.batch_threshold == 10
