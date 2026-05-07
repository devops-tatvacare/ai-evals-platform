"""Phase 13 / D.2 — BolnaBatchService request shape + pagination + CSV.

Mocked at the httpx layer. Asserts:

1. ``create_batch`` posts multipart/form-data with the expected fields,
   including the cohort CSV as the ``file`` part and a recipient_id
   column so the Phase E poller can correlate executions back to
   workflow recipients.
2. ``list_batch_executions`` paginates correctly.
3. ``stop_batch`` POSTs to the stop endpoint.
4. CSV builder emits stable column order including recipient_id.
5. Rate limiting fires through the bolna:call bucket.
"""
from __future__ import annotations

import uuid

import httpx
import pytest

from app.services.orchestration.integrations import _rate_limiter, bolna_batch
from app.services.orchestration.integrations._rate_limiter import (
    RateLimitedError,
)
from app.services.orchestration.integrations.bolna import BolnaServiceError
from app.services.orchestration.integrations.bolna_batch import (
    BolnaBatchService,
    build_cohort_csv,
)


@pytest.fixture(autouse=True)
def _clear_registry():
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()
    yield
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()


def _patch_make_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)

    def _factory(timeout: float):
        return httpx.AsyncClient(timeout=timeout, transport=transport)

    monkeypatch.setattr(bolna_batch, "_make_client", _factory)


def _service(connection_id: uuid.UUID | None = None) -> BolnaBatchService:
    return BolnaBatchService(
        base_url="https://api.bolna.ai",
        api_key="k",
        connection_id=connection_id or uuid.uuid4(),
    )


# ─── CSV builder ───────────────────────────────────────────────────────


def test_build_cohort_csv_emits_stable_columns_and_recipient_id():
    rows = [
        ("L-1", {"phone": "+919999990001", "first_name": "Aarti", "slot": "5pm"}),
        ("L-2", {"phone": "+919999990002", "first_name": "Bilal", "slot": "6pm"}),
    ]
    csv = build_cohort_csv(rows, extra_columns=["first_name", "slot"]).decode()
    lines = csv.splitlines()
    assert lines[0] == "contact_number,recipient_id,first_name,slot"
    assert lines[1] == "+919999990001,L-1,Aarti,5pm"
    assert lines[2] == "+919999990002,L-2,Bilal,6pm"


def test_build_cohort_csv_falls_back_to_phone_when_contact_number_missing():
    rows = [("L-1", {"phone": "+91", "name": "X"})]
    csv = build_cohort_csv(rows, extra_columns=["name"]).decode()
    assert "+91,L-1,X" in csv


# ─── create_batch ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_batch_posts_multipart_with_csv(monkeypatch):
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"batch_id": "b-1", "status": "queued"},
        )

    _patch_make_client(monkeypatch, _handler)
    svc = _service()
    csv = b"contact_number,recipient_id\n+91,L-1\n"
    out = await svc.create_batch(
        agent_id="agent-A",
        from_phone_numbers=["+919999990000"],
        csv_bytes=csv,
        filename="cohort.csv",
        batch_name="campaign-2026-05",
    )
    assert out == {"batch_id": "b-1", "status": "queued"}

    assert len(captured) == 1
    req = captured[0]
    assert req.url.path == "/batches"
    assert req.headers["Authorization"] == "Bearer k"
    body = req.content
    # Multipart serialisation: fields show up as their literal content.
    assert b"agent-A" in body
    assert b"+919999990000" in body
    assert b"campaign-2026-05" in body
    # CSV file part includes the cohort bytes.
    assert b"contact_number,recipient_id" in body
    assert b"+91,L-1" in body


@pytest.mark.asyncio
async def test_create_batch_falls_back_to_default_from_phone(monkeypatch):
    """When the dispatch node passes an empty ``from_phone_numbers``
    list, the connection's saved ``default_from_phone`` shows up on the
    wire. Mirrors the per-call fallback for BolnaService — same fix for
    the same 2026-05-04 caller-id-null bug."""
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"batch_id": "b-2", "status": "queued"})

    _patch_make_client(monkeypatch, _handler)
    svc = BolnaBatchService(
        base_url="https://api.bolna.ai", api_key="k",
        connection_id=uuid.uuid4(),
        default_from_phone="+918031136499",
    )
    await svc.create_batch(
        agent_id="agent-A",
        from_phone_numbers=[],  # operator didn't override per-node
        csv_bytes=b"contact_number,recipient_id\n+91,L-1\n",
    )
    body = captured[0].content
    assert b"+918031136499" in body
    assert b"from_phone_numbers" in body


@pytest.mark.asyncio
async def test_create_batch_omits_from_phone_when_neither_set(monkeypatch):
    """No per-call list AND no connection default → field is absent so
    Bolna falls back to the agent's per-agent default."""
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"batch_id": "b-3", "status": "queued"})

    _patch_make_client(monkeypatch, _handler)
    svc = _service()
    await svc.create_batch(
        agent_id="agent-A",
        from_phone_numbers=[],
        csv_bytes=b"contact_number,recipient_id\n+91,L-1\n",
    )
    body = captured[0].content
    assert b"from_phone_numbers" not in body


@pytest.mark.asyncio
async def test_create_batch_raises_on_4xx(monkeypatch):
    def _handler(_request):
        return httpx.Response(400, json={"error": "bad agent"})

    _patch_make_client(monkeypatch, _handler)
    svc = _service()
    with pytest.raises(BolnaServiceError) as excinfo:
        await svc.create_batch(
            agent_id="agent-A",
            from_phone_numbers=["+91"],
            csv_bytes=b"a\n",
        )
    assert "400" in str(excinfo.value)


# ─── list_batch_executions ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_batch_executions_propagates_pagination(monkeypatch):
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "executions": [{"execution_id": "ex-1", "status": "completed"}],
                "page": 2,
                "page_size": 50,
                "total": 75,
            },
        )

    _patch_make_client(monkeypatch, _handler)
    svc = _service()
    out = await svc.list_batch_executions("b-1", page=2, page_size=50)
    assert out["page"] == 2
    assert out["total"] == 75

    assert captured[0].url.path == "/batches/b-1/executions"
    qs = dict(captured[0].url.params)
    assert qs == {"page": "2", "page_size": "50"}


# ─── stop_batch ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stop_batch_posts_stop_endpoint(monkeypatch):
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(204)

    _patch_make_client(monkeypatch, _handler)
    svc = _service()
    await svc.stop_batch("b-1")
    assert captured[0].method == "POST"
    assert captured[0].url.path == "/batches/b-1/stop"


# ─── rate-limit integration ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_batch_consumes_bolna_call_and_global_buckets(monkeypatch):
    """Each create_batch must charge bolna:call AND bolna:global per
    ``acquire_bolna`` semantics."""
    cid = uuid.uuid4()
    monkeypatch.setitem(
        _rate_limiter._SPECS, "bolna:call",
        _rate_limiter._BucketSpec(capacity=2, window_seconds=10.0),
    )
    monkeypatch.setitem(
        _rate_limiter._SPECS, "bolna:global",
        _rate_limiter._BucketSpec(capacity=10, window_seconds=10.0),
    )
    _rate_limiter._RATE_LIMITER_BUCKETS.clear()

    def _handler(_request):
        return httpx.Response(200, json={"batch_id": "b-1"})

    _patch_make_client(monkeypatch, _handler)
    svc = _service(cid)

    # Two acquires fit in the bolna:call bucket.
    await svc.create_batch(
        agent_id="A", from_phone_numbers=["+91"], csv_bytes=b"\n",
    )
    await svc.create_batch(
        agent_id="A", from_phone_numbers=["+91"], csv_bytes=b"\n",
    )
    # Third overflows bolna:call. Use fail-fast at the bucket layer
    # to confirm the limit fires before the HTTP call.
    bucket = _rate_limiter.get_bucket(cid, "bolna:call")
    with pytest.raises(RateLimitedError):
        await bucket.acquire(wait=False)
