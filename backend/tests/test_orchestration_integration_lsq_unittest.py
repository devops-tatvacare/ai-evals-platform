"""LsqWriter — POSTs Lead.Update + ProspectActivity.Create.

Reuses _auth_params() + LSQ_BASE_URL + _rate_limited_request from the existing
lsq_client per concierge spec §5.6. Sets postUpdatedLead=false to prevent
feedback loops.
"""
from __future__ import annotations

import httpx
import pytest

from app.services import lsq_client as lsq_client_mod
from app.services.orchestration.integrations import lsq as lsq_mod
from app.services.orchestration.integrations.lsq import LsqWriter, LsqWriteError


def _patch_lsq(monkeypatch, handler):
    monkeypatch.setattr(lsq_client_mod, "LSQ_BASE_URL", "https://api-in22.leadsquared.com/v2")
    monkeypatch.setattr(lsq_client_mod, "_auth_params", lambda: {"accessKey": "ak", "secretKey": "sk"})
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        lsq_mod, "_make_client",
        lambda timeout=30.0: httpx.AsyncClient(transport=transport, timeout=timeout),
    )


@pytest.mark.asyncio
async def test_update_stage_sends_post_with_correct_payload(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"Status": "Success"})

    _patch_lsq(monkeypatch, _handler)
    writer = LsqWriter()
    await writer.update_stage(prospect_id="P-1", stage="Slot Confirmed")

    assert "Lead.Update" in captured["url"]
    assert "leadId=P-1" in captured["url"]
    assert "postUpdatedLead=false" in captured["url"]
    assert "accessKey=ak" in captured["url"]
    assert "secretKey=sk" in captured["url"]
    assert "ProspectStage" in captured["body"]
    assert "Slot Confirmed" in captured["body"]


@pytest.mark.asyncio
async def test_log_activity_includes_event_code_and_note(monkeypatch):
    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content.decode()
        return httpx.Response(200, json={"Status": "Success"})

    _patch_lsq(monkeypatch, _handler)
    writer = LsqWriter()
    await writer.log_activity(prospect_id="P-9", activity_event=212, note="AI Concierge Completed")

    assert "ProspectActivity.svc/Create" in captured["url"]
    assert '"ActivityEvent": 212' in captured["body"] or '"ActivityEvent":212' in captured["body"]
    assert "AI Concierge Completed" in captured["body"]
    assert '"RelatedProspectId":' in captured["body"] and "P-9" in captured["body"]


@pytest.mark.asyncio
async def test_4xx_raises_lsq_write_error(monkeypatch):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "bad"})

    _patch_lsq(monkeypatch, _handler)
    writer = LsqWriter()
    with pytest.raises(LsqWriteError):
        await writer.update_stage(prospect_id="P-1", stage="X")
