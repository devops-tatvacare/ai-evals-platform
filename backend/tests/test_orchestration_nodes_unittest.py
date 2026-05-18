"""Per-handler tests for all 10 shared node types.

One test file per design spec to keep CI iteration fast — bundling here
avoids 10 collection passes; each test is independent and uses the
db_session fixture from conftest.py.

Imports the nodes package once at module load so @register_node fires.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text

import app.services.orchestration.nodes  # noqa: F401 — register all 10 handlers

from app.models.orchestration import (
    WorkflowConsentRecord,
    WorkflowRunNodeStep,
    WorkflowRunRecipientAction,
    WorkflowRunRecipientState,
)
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.node_context import NodeContext, ServiceRegistry


def _make_node_step(db_session, *, run, version, workflow, tenant_id, app_id, node_id, node_type) -> uuid.UUID:
    step_id = uuid.uuid4()
    db_session.add(WorkflowRunNodeStep(
        id=step_id, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_id=node_id, node_type=node_type,
        status="running", started_at=datetime.now(timezone.utc),
    ))
    return step_id


def _make_ctx(db_session, *, run, version, workflow, tenant_id, app_id, node_id, step_id) -> NodeContext:
    return NodeContext(
        db=db_session, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=step_id, current_node_id=node_id,
        services=ServiceRegistry(), job_id=None,
    )


# ─── source.event_trigger ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_event_trigger_seeds_named_recipients(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.source_event_trigger import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="src1", node_type="source.event_trigger")
    run.params = {"event_payload": {
        "recipients": [
            {"recipient_id": "evt-1", "payload": {"trigger": "wati.reply"}},
            {"recipient_id": "evt-2", "payload": {"trigger": "wati.reply"}},
        ]
    }}
    await db_session.flush()

    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="src1", step_id=step_id)
    cfg = _Config(next_node_id="n_target")
    result = await _Handler().execute(CohortStream([]), cfg, ctx)
    assert result.summary["cohort_size"] == 2

    rows = await db_session.execute(
        select(WorkflowRunRecipientState.recipient_id)
        .where(WorkflowRunRecipientState.run_id == run.id)
        .order_by(WorkflowRunRecipientState.recipient_id)
    )
    assert [r[0] for r in rows.all()] == ["evt-1", "evt-2"]


# ─── filter.eligibility ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_eligibility_filters_passed_skipped(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.filter_eligibility import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="elig", node_type="filter.eligibility")
    await db_session.flush()

    cfg = _Config(predicate={"field": "mqlScore", "op": "gte", "value": 4})
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="elig", step_id=step_id)
    cohort = CohortStream([
        ("r-pass-1", {"mqlScore": 5}),
        ("r-pass-2", {"mqlScore": 4}),
        ("r-skip-1", {"mqlScore": 2}),
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    passed = sorted(o.recipient_id for o in result.by_output_id["passed"])
    skipped = [o.recipient_id for o in result.by_output_id["skipped"]]
    assert passed == ["r-pass-1", "r-pass-2"]
    assert skipped == ["r-skip-1"]


# ─── filter.consent_gate ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_consent_gate_blocks_opted_out(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.filter_consent_gate import _Handler, _Config

    db_session.add(WorkflowConsentRecord(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        recipient_id="r-B", channel="wa", status="opted_out", source="wa_reply_stop",
    ))
    db_session.add(WorkflowConsentRecord(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        recipient_id="r-A", channel="wa", status="opted_in", source="lsq_field",
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="cg", node_type="filter.consent_gate")
    await db_session.flush()

    cfg = _Config(channel="wa", require_explicit_optin=False)
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="cg", step_id=step_id)
    cohort = CohortStream([("r-A", {}), ("r-B", {}), ("r-C-unknown", {})])
    result = await _Handler().execute(cohort, cfg, ctx)
    allowed = sorted(o.recipient_id for o in result.by_output_id["allowed"])
    blocked = sorted(o.recipient_id for o in result.by_output_id["blocked"])
    assert allowed == ["r-A", "r-C-unknown"]
    assert blocked == ["r-B"]


@pytest.mark.asyncio
async def test_consent_gate_strict_mode_blocks_unknown(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.filter_consent_gate import _Handler, _Config

    db_session.add(WorkflowConsentRecord(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        recipient_id="r-X", channel="wa", status="opted_in", source="lsq_field",
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="cg2", node_type="filter.consent_gate")
    await db_session.flush()

    cfg = _Config(channel="wa", require_explicit_optin=True)
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="cg2", step_id=step_id)
    cohort = CohortStream([("r-X", {}), ("r-Y-no-record", {})])
    result = await _Handler().execute(cohort, cfg, ctx)
    allowed = [o.recipient_id for o in result.by_output_id["allowed"]]
    blocked = [o.recipient_id for o in result.by_output_id["blocked"]]
    assert allowed == ["r-X"]
    assert blocked == ["r-Y-no-record"]


# ─── logic.conditional ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conditional_routes_true_false(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.logic_conditional import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="cond", node_type="logic.conditional")
    await db_session.flush()

    # Predicate contract is strict: missing fields raise PredicateError so the
    # author is forced to write 'exists'/'missing' branches explicitly. Use an
    # OR with 'missing' to opt in to "default-to-false on absence".
    cfg = _Config(
        predicate={
            "or": [
                {"field": "replied", "op": "eq", "value": True},
            ],
        }
    )
    # The strict contract drives the routing semantics; a plain eq with a
    # missing field is a hard error and tested in the predicate-contract unit
    # tests, not here.
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="cond", step_id=step_id)
    cohort = CohortStream([
        ("r-yes", {"replied": True}),
        ("r-no", {"replied": False}),
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    yes = [o.recipient_id for o in result.by_output_id["true"]]
    no = sorted(o.recipient_id for o in result.by_output_id["false"])
    assert yes == ["r-yes"]
    assert no == ["r-no"]


# ─── logic.split ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_split_by_field_value(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.logic_split import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sp", node_type="logic.split")
    await db_session.flush()

    cfg = _Config(
        mode="by_field",
        field="tier",
        branches=[
            {"label": "high", "match": "high"},
            {"label": "mid", "match": "mid"},
            {"label": "low", "match": "low"},
        ],
        default_branch="low",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sp", step_id=step_id)
    cohort = CohortStream([
        ("r-h", {"tier": "high"}),
        ("r-m", {"tier": "mid"}),
        ("r-l", {"tier": "low"}),
        ("r-x", {"tier": "unknown"}),  # falls to default
    ])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert [o.recipient_id for o in result.by_output_id["high"]] == ["r-h"]
    assert [o.recipient_id for o in result.by_output_id["mid"]] == ["r-m"]
    assert sorted(o.recipient_id for o in result.by_output_id["low"]) == ["r-l", "r-x"]


@pytest.mark.asyncio
async def test_split_by_random_proportions(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.logic_split import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="sp2", node_type="logic.split")
    await db_session.flush()

    cfg = _Config(
        mode="random",
        branches=[
            {"label": "control", "weight": 50},
            {"label": "treatment", "weight": 50},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="sp2", step_id=step_id)
    cohort = CohortStream([(f"r-{i}", {}) for i in range(1000)])
    result = await _Handler().execute(cohort, cfg, ctx)
    control = len(result.by_output_id["control"])
    treatment = len(result.by_output_id["treatment"])
    assert control + treatment == 1000
    assert 400 < control < 600


# ─── logic.wait ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_wait_suspends_recipients_with_wakeup(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.logic_wait import _Handler, _Config

    for rid in ["r-w1", "r-w2"]:
        db_session.add(WorkflowRunRecipientState(
            id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
            workflow_id=workflow.id, workflow_version_id=version.id,
            run_id=run.id, recipient_id=rid, current_node_id="wait",
            status="running", payload={},
        ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wait", node_type="logic.wait")
    await db_session.flush()

    cfg = _Config(duration_hours=4)
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wait", step_id=step_id)
    cohort = CohortStream([("r-w1", {}), ("r-w2", {})])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert result.suspended is True
    assert result.by_output_id == {}

    rows = await db_session.execute(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id.in_(["r-w1", "r-w2"]),
        )
    )
    states = list(rows.scalars().all())
    for s in states:
        assert s.status == "waiting"
        assert s.wakeup_at is not None
        delta = s.wakeup_at - datetime.now(timezone.utc)
        assert timedelta(hours=3, minutes=55) < delta < timedelta(hours=4, minutes=5)


# ─── logic.merge ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_dedupe(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.logic_merge import _Handler, _Config

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="m", node_type="logic.merge")
    await db_session.flush()
    cfg = _Config(dedupe=True)
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="m", step_id=step_id)
    cohort = CohortStream([("a", {}), ("b", {}), ("a", {})])
    result = await _Handler().execute(cohort, cfg, ctx)
    out = sorted(o.recipient_id for o in result.by_output_id["default"])
    assert out == ["a", "b"]


# ─── core.webhook_out ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_webhook_out_posts_per_recipient(db_session, seed_full_run, monkeypatch):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes import core_webhook_out as wh_mod
    from app.services.orchestration.nodes.core_webhook_out import _Handler, _Config

    captured: dict[str, Any] = {"requests": []}

    def _handler_fn(request: httpx.Request) -> httpx.Response:
        captured["requests"].append(request)
        return httpx.Response(200, json={"ok": True, "echo": True})

    transport = httpx.MockTransport(_handler_fn)

    def _make_client_mock(timeout_seconds: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, timeout=timeout_seconds)

    monkeypatch.setattr(wh_mod, "_make_client", _make_client_mock)

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wh", node_type="core.webhook_out")
    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r1", current_node_id="wh",
        status="running", payload={"firstName": "Aarti"},
    ))
    await db_session.flush()

    cfg = _Config(
        url="https://example.com/hook",
        method="POST",
        body={
            "recipient": {"$payload": "recipient_id"},
            "name": {"$payload": "firstName"},
        },
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="wh", step_id=step_id)
    cohort = CohortStream([("r1", {"firstName": "Aarti"})])
    result = await _Handler().execute(cohort, cfg, ctx)

    assert len(captured["requests"]) == 1
    body = captured["requests"][0].content.decode()
    assert "Aarti" in body
    assert "r1" in body

    success = [o.recipient_id for o in result.by_output_id["success"]]
    assert success == ["r1"]

    rows = await db_session.execute(
        select(WorkflowRunRecipientAction.action_type, WorkflowRunRecipientAction.status)
        .where(WorkflowRunRecipientAction.run_id == run.id)
    )
    actions = list(rows.all())
    assert actions == [("webhook_out_posted", "success")]


@pytest.mark.asyncio
async def test_webhook_out_resolves_relative_url_and_auth_from_connection(
    db_session, seed_full_run, monkeypatch,
):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.models.provider_connection import ProviderConnection
    from app.services.orchestration.connections import crypto
    from app.services.orchestration.connections.resolver import ConnectionResolver
    from app.services.orchestration.nodes import core_webhook_out as wh_mod
    from app.services.orchestration.nodes.core_webhook_out import _Handler, _Config

    captured: dict[str, Any] = {"requests": []}

    def _handler_fn(request: httpx.Request) -> httpx.Response:
        captured["requests"].append(request)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(
        wh_mod,
        "_make_client",
        lambda timeout_seconds: httpx.AsyncClient(
            transport=httpx.MockTransport(_handler_fn),
            timeout=timeout_seconds,
        ),
    )

    connection_id = uuid.uuid4()
    db_session.add(ProviderConnection(
        id=connection_id,
        tenant_id=tenant_id,
        app_id=app_id,
        provider="webhook",
        name=f"webhook-{connection_id.hex[:8]}",
        config_encrypted=crypto.encrypt({
            "base_url": "https://hooks.example.com",
            "auth_header_name": "Authorization",
            "auth_header_value": "Bearer secret-42",
        }),
        webhook_token=None,
        active=True,
        created_by=run.triggered_by_user_id,
    ))
    await db_session.flush()

    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="wh", node_type="core.webhook_out")
    await db_session.flush()

    cfg = _Config(
        connection_id=connection_id,
        url="/hook",
        method="POST",
        body={"recipient": {"$payload": "recipient_id"}},
    )
    resolver = ConnectionResolver(db_session, tenant_id=tenant_id, app_id=app_id)
    ctx = NodeContext(
        db=db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        run_id=run.id,
        node_step_id=step_id,
        current_node_id="wh",
        services=ServiceRegistry(),
        job_id=None,
        connections=resolver,
    )
    cohort = CohortStream([("r1", {"firstName": "Aarti"})])
    result = await _Handler().execute(cohort, cfg, ctx)

    assert [o.recipient_id for o in result.by_output_id["success"]] == ["r1"]
    assert str(captured["requests"][0].url) == "https://hooks.example.com/hook"
    assert captured["requests"][0].headers["Authorization"] == "Bearer secret-42"


# ─── sink.complete ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sink_marks_completed(db_session, seed_full_run):
    run, version, workflow, _, tenant_id, app_id = seed_full_run
    from app.services.orchestration.nodes.sink_complete import _Handler, _Config

    db_session.add(WorkflowRunRecipientState(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, recipient_id="r-end", current_node_id="end",
        status="running", payload={},
    ))
    step_id = _make_node_step(db_session, run=run, version=version, workflow=workflow,
                              tenant_id=tenant_id, app_id=app_id,
                              node_id="end", node_type="sink.complete")
    await db_session.flush()

    cfg = _Config(reason="ok")
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, node_id="end", step_id=step_id)
    cohort = CohortStream([("r-end", {})])
    result = await _Handler().execute(cohort, cfg, ctx)
    assert result.by_output_id == {}

    state = await db_session.execute(
        select(WorkflowRunRecipientState).where(
            WorkflowRunRecipientState.run_id == run.id,
            WorkflowRunRecipientState.recipient_id == "r-end",
        )
    )
    s = state.scalar_one()
    assert s.status == "completed"
    assert s.completed_at is not None
