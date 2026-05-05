"""Per-handler tests for the 5 CRM action nodes (Phase 10 commit 2).

Each handler now resolves its provider service from
``ctx.connections.<provider>(connection_id)``. Tests inject a
``_FakeResolver`` whose method returns a pre-built BolnaService /
WatiService / LsqWriter / decrypted-config dict. Existing
``ctx.services.*`` reads have been removed from the handlers.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select

import app.services.orchestration.nodes  # noqa: F401 — registers handlers

from app.models.orchestration import (
    WorkflowActionTemplate,
    WorkflowRunNodeStep,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.integrations.bolna import BolnaService
from app.services.orchestration.integrations.lsq import LsqWriter
from app.services.orchestration.integrations.wati import WatiService
from app.services.orchestration.node_context import NodeContext, ServiceRegistry


class _FakeResolver:
    """In-memory stand-in for ``ConnectionResolver`` — returns whatever was
    seeded for each provider. Multi-provider helpers (``get_config``) read
    a separate config dict slot."""

    def __init__(
        self, *,
        bolna=None, bolna_batch=None, wati=None, lsq=None,
        sms_config: dict | None = None,
    ) -> None:
        self._bolna = bolna
        self._bolna_batch = bolna_batch
        self._wati = wati
        self._lsq = lsq
        self._sms_config = sms_config or {}

    async def bolna(self, _connection_id):
        if self._bolna is None:
            raise AssertionError("test did not seed a Bolna service")
        return self._bolna

    async def bolna_batch(self, _connection_id):
        if self._bolna_batch is None:
            raise AssertionError("test did not seed a BolnaBatchService")
        return self._bolna_batch

    async def wati(self, _connection_id):
        if self._wati is None:
            raise AssertionError("test did not seed a WATI service")
        return self._wati

    async def lsq(self, _connection_id):
        if self._lsq is None:
            raise AssertionError("test did not seed an LSQ writer")
        return self._lsq

    async def get_config(self, _connection_id, *, expected_provider=None):
        if not self._sms_config:
            raise AssertionError("test did not seed an SMS connection config")
        return self._sms_config


def _make_node_step(db_session, *, run, version, workflow, tenant_id, app_id, node_id, node_type) -> uuid.UUID:
    step_id = uuid.uuid4()
    db_session.add(WorkflowRunNodeStep(
        id=step_id, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_id=node_id, node_type=node_type,
        status="running", started_at=datetime.now(timezone.utc),
    ))
    return step_id


def _make_ctx(
    db_session, *, run, version, workflow, tenant_id, app_id, node_id, step_id,
    connections=None,
) -> NodeContext:
    return NodeContext(
        db=db_session, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=step_id, current_node_id=node_id,
        services=ServiceRegistry(), job_id=None,
        connections=connections,
    )


def _patch_module_make_client(monkeypatch, mod, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        mod, "_make_client",
        lambda *a, **kw: httpx.AsyncClient(
            transport=transport,
            timeout=kw.get("timeout", 30.0) if kw else 30.0,
        ),
    )


# ─── crm.send_wati ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crm_send_wati_per_recipient_with_node_mappings(
    db_session, seed_full_run, monkeypatch,
):
    """Node-level variable_mappings drive WATI parameters end-to-end.
    template_name / broadcast_name / channel_number are UI-supplied per
    Phase 13 keystone #1; template payload_schema carries no provider
    identifiers."""
    from app.services.orchestration.integrations import wati as wati_mod
    from app.services.orchestration.nodes.crm_send_wati import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"welcome-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="Welcome",
        payload_schema={},
    ))
    for rid, fname in [("L-1", "Aarti"), ("L-2", "Bilal")]:
        db_session.add(WorkflowRunRecipientState(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            workflow_id=workflow.id, workflow_version_id=version.id,
            run_id=run.id, recipient_id=rid, current_node_id="wati",
            status="running",
            payload={"first_name": fname, "city": "Mumbai", "whatsapp_number": "919999990001"},
        ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wati", node_type="crm.send_wati")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"localMessageId": "lm-A", "whatsappMessageId": "wm-A"})

    _patch_module_make_client(monkeypatch, wati_mod, _handler)

    wati_svc = WatiService(
        base_url="https://live-mt-server.wati.io",
        wati_tenant_id="12345", api_token="t",
    )
    resolver = _FakeResolver(wati=wati_svc)

    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="whatsapp_number",
        template_name="welcome_v1",
        broadcast_name="concierge_welcome",
        channel_number="+919999990000",
        variable_mappings=[
            {"agent_variable": "patient_name", "source_kind": "payload",
             "payload_field": "first_name"},
            {"agent_variable": "city", "source_kind": "payload",
             "payload_field": "city"},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wati",
                    step_id=step_id, connections=resolver)
    cohort = CohortStream([
        ("L-1", {"first_name": "Aarti", "city": "Mumbai", "whatsapp_number": "919999990001"}),
        ("L-2", {"first_name": "Bilal", "city": "Mumbai", "whatsapp_number": "919999990002"}),
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert sorted(o.recipient_id for o in result.by_output_id["success"]) == ["L-1", "L-2"]
    assert result.by_output_id["exhausted"] == []
    assert len(captured) == 2

    actions = await db_session.execute(
        select(
            WorkflowRunRecipientAction.action_type,
            WorkflowRunRecipientAction.status,
            WorkflowRunRecipientAction.payload,
        )
        .where(WorkflowRunRecipientAction.run_id == run.id)
    )
    rows = list(actions.all())
    assert len(rows) == 2
    for atype, st, payload in rows:
        assert atype == "wa_dispatched"
        assert st == "success"
        names = [p["name"] for p in payload["parameters"]]
        assert names == ["patient_name", "city"]


@pytest.mark.asyncio
async def test_crm_send_wati_static_mappings_passthrough(
    db_session, seed_full_run, monkeypatch,
):
    """Static rows render verbatim into the WATI parameters list."""
    from app.services.orchestration.integrations import wati as wati_mod
    from app.services.orchestration.nodes.crm_send_wati import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"static-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="Static",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wati", node_type="crm.send_wati")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"localMessageId": "lm-B"})

    _patch_module_make_client(monkeypatch, wati_mod, _handler)
    wati_svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    resolver = _FakeResolver(wati=wati_svc)

    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="whatsapp_number",
        template_name="static_v1",
        broadcast_name="concierge",
        channel_number="+919999990000",
        variable_mappings=[
            {"agent_variable": "patient_name", "source_kind": "static",
             "static_value": "STATIC-NAME"},
            {"agent_variable": "campaign_id", "source_kind": "static",
             "static_value": "fall-2026"},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wati",
                    step_id=step_id, connections=resolver)
    cohort = CohortStream([
        ("L-1", {"first_name": "Aarti", "whatsapp_number": "919999990001"}),
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["L-1"]
    assert len(captured) == 1
    body = captured[0].content.decode()
    assert "STATIC-NAME" in body
    assert "fall-2026" in body
    assert "Aarti" not in body


@pytest.mark.asyncio
async def test_crm_send_wati_missing_phone_field(db_session, seed_full_run):
    from app.services.orchestration.nodes.crm_send_wati import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"t2-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="t2",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wati", node_type="crm.send_wati")
    await db_session.flush()
    wati_svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    resolver = _FakeResolver(wati=wati_svc)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="whatsapp_number",
        template_name="t2", broadcast_name="b", channel_number="+919999990000",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wati",
                    step_id=step_id, connections=resolver)
    with pytest.raises(RuntimeError, match="missing required contact field 'whatsapp_number'"):
        await _Handler().execute(CohortStream([("L-x", {})]), cfg, ctx)


@pytest.mark.asyncio
async def test_crm_send_wati_failure_emits_failed_edge(
    db_session, seed_full_run, monkeypatch,
):
    from app.services.orchestration.integrations import wati as wati_mod
    from app.services.orchestration.nodes.crm_send_wati import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"t-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="t1",
        payload_schema={},
    ))
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="L-bad", current_node_id="wati",
        status="running", payload={"whatsapp_number": "0"},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wati", node_type="crm.send_wati")
    await db_session.flush()

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"info": "bad number"})

    _patch_module_make_client(monkeypatch, wati_mod, _handler)
    wati_svc = WatiService(base_url="https://w", wati_tenant_id="1", api_token="t")
    resolver = _FakeResolver(wati=wati_svc)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="whatsapp_number",
        template_name="t1", broadcast_name="b", channel_number="+919999990000",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wati",
                    step_id=step_id, connections=resolver)
    result = await _Handler().execute(
        CohortStream([("L-bad", {"whatsapp_number": "0"})]), cfg, ctx,
    )
    assert [o.recipient_id for o in result.by_output_id["exhausted"]] == ["L-bad"]
    assert result.by_output_id["success"] == []


@pytest.mark.asyncio
async def test_crm_send_wati_blank_template_name_raises(db_session, seed_full_run):
    """Phase 13/C.2 — template_name / channel_number / broadcast_name are
    UI-supplied; runtime fails fast when any are blank."""
    from app.services.orchestration.nodes.crm_send_wati import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"unset-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="wati", slug=slug, name="Unset",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wati", node_type="crm.send_wati")
    await db_session.flush()

    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug,
        # template_name/channel_number/broadcast_name intentionally left blank.
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wati",
                    step_id=step_id, connections=_FakeResolver(wati=None))
    cohort = CohortStream([("L-1", {"whatsapp_number": "919999990001"})])
    with pytest.raises(RuntimeError, match="template_name is required"):
        await _Handler().execute(cohort, cfg, ctx)


# ─── crm.place_bolna_call ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crm_place_bolna_call_with_node_mappings(
    db_session, seed_full_run, monkeypatch,
):
    """Node-level variable_mappings drive Bolna user_data end-to-end.
    The template carries only retry_config; agent_id is UI-supplied per
    Phase 13 keystone #1."""
    from app.services.orchestration.integrations import bolna as bolna_mod
    from app.services.orchestration.nodes.crm_place_bolna_call import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"confirm-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="bolna", slug=slug, name="Slot Confirmation",
        payload_schema={
            "retry_config": {
                "enabled": True, "max_retries": 2,
                "retry_on_statuses": ["no-answer", "busy"],
                "retry_intervals_minutes": [5, 15],
            },
        },
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="bn", node_type="crm.place_bolna_call")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"message": "queued", "status": "queued", "execution_id": "ex-100"})

    _patch_module_make_client(monkeypatch, bolna_mod, _handler)
    bolna_svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    resolver = _FakeResolver(bolna=bolna_svc)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="phone",
        agent_id="agent-confirm-1",
        variable_mappings=[
            {"agent_variable": "first_name", "source_kind": "payload",
             "payload_field": "first_name"},
            {"agent_variable": "slot", "source_kind": "payload",
             "payload_field": "slot"},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="bn",
                    step_id=step_id, connections=resolver)
    cohort = CohortStream([
        ("L-1", {"phone": "+919999990001", "first_name": "Aarti", "slot": "5pm"}),
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["L-1"]
    assert result.by_output_id["success"][0].payload_delta["last_outcome"] == "bolna_queued"
    assert "last_event_at" in result.by_output_id["success"][0].payload_delta
    assert len(captured) == 1
    body = captured[0].content.decode()
    assert "Aarti" in body and "5pm" in body
    assert "agent-confirm-1" in body


@pytest.mark.asyncio
async def test_crm_place_bolna_call_remapping_payload_field(
    db_session, seed_full_run, monkeypatch,
):
    """Node mapping reads from a non-default payload field — proves the
    resolver projects exactly what's declared on the node."""
    from app.services.orchestration.integrations import bolna as bolna_mod
    from app.services.orchestration.nodes.crm_place_bolna_call import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"remap-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="bolna", slug=slug, name="O",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="bn", node_type="crm.place_bolna_call")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"execution_id": "ex-1"})

    _patch_module_make_client(monkeypatch, bolna_mod, _handler)
    bolna_svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    resolver = _FakeResolver(bolna=bolna_svc)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, phone_field="phone",
        agent_id="ag-1",
        variable_mappings=[
            {"agent_variable": "first_name", "source_kind": "payload",
             "payload_field": "fn"},
            {"agent_variable": "campaign", "source_kind": "static",
             "static_value": "demo-2026"},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="bn",
                    step_id=step_id, connections=resolver)
    result = await _Handler().execute(
        CohortStream([("L-1", {"phone": "+91", "fn": "Bilal", "first_name": "Aarti"})]),
        cfg, ctx,
    )
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["L-1"]
    assert result.by_output_id["success"][0].payload_delta["last_outcome"] == "bolna_queued"
    assert "last_event_at" in result.by_output_id["success"][0].payload_delta
    body = captured[0].content.decode()
    # Node mapping reads payload['fn'] (declared on the node), so user_data.first_name = 'Bilal'.
    # payload['first_name']='Aarti' is unused because no node row points at it.
    assert "Bilal" in body
    assert "demo-2026" in body
    assert "Aarti" not in body


@pytest.mark.asyncio
async def test_crm_place_bolna_call_blank_agent_id_raises(
    db_session, seed_full_run,
):
    """Phase 13/B.2 — agent_id is UI-supplied; runtime fails fast when blank.

    The publish-gate validator catches this earlier in the lifecycle, but a
    direct API submitter or a stale draft can still reach the handler.
    The handler must reject rather than fall back to any template-side
    value.
    """
    from app.services.orchestration.nodes.crm_place_bolna_call import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"agentless-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="bolna", slug=slug, name="Agentless",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="bn", node_type="crm.place_bolna_call")
    await db_session.flush()

    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug,
        # agent_id intentionally left at the default "".
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="bn",
                    step_id=step_id, connections=_FakeResolver(bolna=None))
    cohort = CohortStream([("L-1", {"phone": "+91"})])
    with pytest.raises(RuntimeError, match="agent_id is required"):
        await _Handler().execute(cohort, cfg, ctx)


@pytest.mark.asyncio
async def test_crm_place_bolna_call_missing_phone_field_raises(
    db_session, seed_full_run,
):
    from app.services.orchestration.nodes.crm_place_bolna_call import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"nophone-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="bolna", slug=slug, name="No Phone",
        payload_schema={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="bn", node_type="crm.place_bolna_call")
    await db_session.flush()

    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug,
        agent_id="agent-confirm-1",
        phone_field="phone",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="bn",
                    step_id=step_id,
                    connections=_FakeResolver(bolna=BolnaService(base_url="https://api.bolna.ai", api_key="k")))
    with pytest.raises(RuntimeError, match="missing required contact field 'phone'"):
        await _Handler().execute(CohortStream([("L-1", {})]), cfg, ctx)


# ─── crm.send_sms ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crm_send_sms_via_msg91(db_session, seed_full_run, monkeypatch):
    from app.services.orchestration.nodes import crm_send_sms as sms_mod
    from app.services.orchestration.nodes.crm_send_sms import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"otp-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="sms", slug=slug, name="OTP",
        payload_schema={"body": "Hi {{first_name}}, code: {{code}}"},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sms", node_type="crm.send_sms")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(202, json={"messageId": "g1"})

    _patch_module_make_client(monkeypatch, sms_mod, _handler)
    resolver = _FakeResolver(sms_config={
        "__provider__": "msg91",
        "auth_key": "K", "flow_id": "F1", "sender_id": "TATVAS",
    })
    cfg = _Config(connection_id=uuid.uuid4(), template_slug=slug, phone_field="phone")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sms",
                    step_id=step_id, connections=resolver)
    cohort = CohortStream([("L1", {"phone": "+919999990001", "first_name": "Aarti", "code": "123"})])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["L1"]
    assert len(captured) == 1
    sent_body = captured[0].content.decode()
    assert "Aarti" in sent_body
    assert "123" in sent_body
    # Outbound URL is MSG91's flow API.
    assert "msg91" in str(captured[0].url)
    assert captured[0].headers.get("authkey") == "K"


@pytest.mark.asyncio
async def test_crm_send_sms_via_aisensy(db_session, seed_full_run, monkeypatch):
    from app.services.orchestration.nodes import crm_send_sms as sms_mod
    from app.services.orchestration.nodes.crm_send_sms import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"alert-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="sms", slug=slug, name="Alert",
        payload_schema={"body": "Reminder for {{first_name}}"},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sms", node_type="crm.send_sms")
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"ok": True})

    _patch_module_make_client(monkeypatch, sms_mod, _handler)
    resolver = _FakeResolver(sms_config={
        "__provider__": "aisensy",
        "api_key": "AK", "base_url": "https://aisensy.example.com",
        "campaign_partner_id": "p1", "from_number": "+919999998888",
    })
    cfg = _Config(connection_id=uuid.uuid4(), template_slug=slug, phone_field="phone")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sms",
                    step_id=step_id, connections=resolver)
    cohort = CohortStream([("L1", {"phone": "+919999990001", "first_name": "Aarti"})])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["L1"]
    body = captured[0].content.decode()
    assert "Aarti" in body
    assert captured[0].headers.get("Authorization") == "Bearer AK"
    assert "aisensy.example.com" in str(captured[0].url)


@pytest.mark.asyncio
async def test_crm_send_sms_unsupported_provider_raises(
    db_session, seed_full_run,
):
    from app.services.orchestration.nodes.crm_send_sms import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sms", node_type="crm.send_sms")
    await db_session.flush()
    resolver = _FakeResolver(sms_config={"__provider__": "wati", "api_key": "x"})
    cfg = _Config(connection_id=uuid.uuid4(), template_slug="x", phone_field="phone")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sms",
                    step_id=step_id, connections=resolver)
    with pytest.raises(RuntimeError, match="not an SMS provider"):
        await _Handler().execute(CohortStream([("L1", {})]), cfg, ctx)


@pytest.mark.asyncio
async def test_crm_send_sms_missing_phone_field_raises(
    db_session, seed_full_run,
):
    from app.services.orchestration.nodes.crm_send_sms import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"sms-nophone-{uuid.uuid4().hex[:8]}"
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="sms", slug=slug, name="SMS No Phone",
        payload_schema={"body": "Hi"},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sms", node_type="crm.send_sms")
    await db_session.flush()
    resolver = _FakeResolver(sms_config={
        "__provider__": "msg91",
        "auth_key": "K", "flow_id": "F1", "sender_id": "TATVAS",
    })
    cfg = _Config(connection_id=uuid.uuid4(), template_slug=slug, phone_field="phone")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sms",
                    step_id=step_id, connections=resolver)
    with pytest.raises(RuntimeError, match="missing required contact field 'phone'"):
        await _Handler().execute(CohortStream([("L1", {})]), cfg, ctx)


# ─── crm.lsq_update_stage ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crm_lsq_update_stage(db_session, seed_full_run, monkeypatch):
    from app.services import lsq_client as lsq_client_mod
    from app.services.orchestration.integrations import lsq as lsq_mod
    from app.services.orchestration.nodes.crm_lsq_update_stage import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="P-99", current_node_id="ls",
        status="running", payload={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="ls", node_type="crm.lsq_update_stage")
    await db_session.flush()

    monkeypatch.setattr(lsq_client_mod, "LSQ_BASE_URL", "https://api-in22.leadsquared.com/v2")
    monkeypatch.setattr(
        lsq_client_mod, "_auth_params",
        lambda: {"accessKey": "ak-fallback", "secretKey": "sk-fallback"},
    )

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"Status": "Success"})

    _patch_module_make_client(monkeypatch, lsq_mod, _handler)
    writer = LsqWriter.with_config({
        "access_key": "ak-tenant", "secret_key": "sk-tenant",
        "region_host": "https://api-in21.leadsquared.com/v2",
    })
    resolver = _FakeResolver(lsq=writer)
    cfg = _Config(connection_id=uuid.uuid4(), target_stage="Slot Confirmed")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="ls",
                    step_id=step_id, connections=resolver)
    result = await _Handler().execute(CohortStream([("P-99", {})]), cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["P-99"]
    assert len(captured) == 1
    url = str(captured[0].url)
    assert "Lead.Update" in url
    # Per-tenant credentials override module-level fallback.
    assert "accessKey=ak-tenant" in url
    assert "in21" in url


# ─── crm.lsq_log_activity ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crm_lsq_log_activity_with_template_note(
    db_session, seed_full_run, monkeypatch,
):
    from app.services import lsq_client as lsq_client_mod
    from app.services.orchestration.integrations import lsq as lsq_mod
    from app.services.orchestration.nodes.crm_lsq_log_activity import _Config, _Handler

    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="P-77", current_node_id="la",
        status="running", payload={"slot_time": "5pm"},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="la", node_type="crm.lsq_log_activity")
    await db_session.flush()

    monkeypatch.setattr(lsq_client_mod, "LSQ_BASE_URL", "https://api-in22.leadsquared.com/v2")
    monkeypatch.setattr(
        lsq_client_mod, "_auth_params",
        lambda: {"accessKey": "ak-fallback", "secretKey": "sk-fallback"},
    )

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"Status": "Success"})

    _patch_module_make_client(monkeypatch, lsq_mod, _handler)
    writer = LsqWriter.with_config({
        "access_key": "ak-tenant", "secret_key": "sk-tenant",
        "region_host": "https://api-in21.leadsquared.com/v2",
    })
    resolver = _FakeResolver(lsq=writer)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        activity_event_code=212, note="Confirmed at {{slot_time}}", fields=[],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="la",
                    step_id=step_id, connections=resolver)
    result = await _Handler().execute(CohortStream([("P-77", {"slot_time": "5pm"})]), cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["success"]] == ["P-77"]
    body = captured[0].content.decode()
    assert "Confirmed at 5pm" in body
    assert "212" in body
    assert "accessKey=ak-tenant" in str(captured[0].url)
