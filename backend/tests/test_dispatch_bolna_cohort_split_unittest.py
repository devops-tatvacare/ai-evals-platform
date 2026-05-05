"""Phase 13 / D.3 — crm.place_bolna_call cohort split (single vs batch).

Cohort below ``BATCH_THRESHOLD`` walks per-recipient ``POST /call`` (the
existing flow). Cohort at or above the threshold serialises to a single
``POST /batches`` upload — each recipient still gets one
``workflow_run_recipient_actions`` row, but the row's ``response`` carries
``mode='batch'`` plus the ``batch_id`` so the Phase E poller can
reconcile per-execution status afterwards.
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
)
from app.services.orchestration.cohort_stream import CohortStream
from app.services.orchestration.integrations import bolna as bolna_mod
from app.services.orchestration.integrations import bolna_batch as bolna_batch_mod
from app.services.orchestration.integrations.bolna import (
    BolnaService,
    BolnaServiceError,
)
from app.services.orchestration.integrations.bolna_batch import BolnaBatchService
from app.services.orchestration.node_context import NodeContext, ServiceRegistry
from app.services.orchestration.nodes.crm_place_bolna_call import (
    BATCH_THRESHOLD,
    _Config,
    _Handler,
)


class _FakeResolver:
    def __init__(self, *, bolna=None, bolna_batch=None) -> None:
        self._bolna = bolna
        self._bolna_batch = bolna_batch

    async def bolna(self, _cid):
        return self._bolna

    async def bolna_batch(self, _cid):
        return self._bolna_batch


def _make_step(db_session, *, run, version, workflow, tenant_id, app_id) -> uuid.UUID:
    step_id = uuid.uuid4()
    db_session.add(WorkflowRunNodeStep(
        id=step_id, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_id="bn", node_type="crm.place_bolna_call",
        status="running", started_at=datetime.now(timezone.utc),
    ))
    return step_id


def _make_ctx(db_session, *, run, version, workflow, tenant_id, app_id, step_id, connections):
    return NodeContext(
        db=db_session, tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=step_id, current_node_id="bn",
        services=ServiceRegistry(), connections=connections, job_id=None,
        outgoing_targets={"success": ["next"], "exhausted": ["end"]},
    )


def _patch_make_client(monkeypatch, module, handler):
    transport = httpx.MockTransport(handler)

    def _factory(timeout: float):
        return httpx.AsyncClient(timeout=timeout, transport=transport)

    monkeypatch.setattr(module, "_make_client", _factory)


def _seed_template(db_session, slug):
    db_session.add(WorkflowActionTemplate(
        id=uuid.uuid4(), tenant_id=None, app_id=None,
        channel="bolna", slug=slug, name="Confirm",
        payload_schema={
            "retry_config": {"enabled": True, "max_retries": 1,
                             "retry_on_statuses": ["no-answer"],
                             "retry_intervals_minutes": [1]},
        },
    ))


# ─── Cohort below threshold → sequential POST /call ────────────────────


@pytest.mark.asyncio
async def test_cohort_below_threshold_uses_sequential_call(
    db_session, seed_full_run, monkeypatch,
):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"single-{uuid.uuid4().hex[:8]}"
    _seed_template(db_session, slug)
    step_id = _make_step(db_session, run=run, version=version, workflow=workflow,
                         tenant_id=tenant_id, app_id=app_id)
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"execution_id": f"ex-{len(captured)}"})

    _patch_make_client(monkeypatch, bolna_mod, _handler)
    bolna_svc = BolnaService(base_url="https://api.bolna.ai", api_key="k")
    resolver = _FakeResolver(bolna=bolna_svc)

    cohort = CohortStream([
        (f"L-{i}", {"phone": f"+9199999900{i:02d}"}) for i in range(BATCH_THRESHOLD - 1)
    ])
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, agent_id="ag-1", phone_field="phone",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, step_id=step_id,
                    connections=resolver)
    result = await _Handler().execute(cohort, cfg, ctx)

    # Every recipient was called once, none batched.
    assert len(captured) == BATCH_THRESHOLD - 1
    for req in captured:
        assert req.url.path == "/call"
    assert result.summary["mode"] == "single"
    assert len(result.by_output_id["success"]) == BATCH_THRESHOLD - 1
    assert all(
        outcome.payload_delta.get("last_outcome") == "bolna_queued"
        and "last_event_at" in outcome.payload_delta
        for outcome in result.by_output_id["success"]
    )


# ─── Cohort at/above threshold → single POST /batches ──────────────────


@pytest.mark.asyncio
async def test_cohort_at_threshold_uses_batch_upload(
    db_session, seed_full_run, monkeypatch,
):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"batch-{uuid.uuid4().hex[:8]}"
    _seed_template(db_session, slug)
    step_id = _make_step(db_session, run=run, version=version, workflow=workflow,
                         tenant_id=tenant_id, app_id=app_id)
    await db_session.flush()

    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"batch_id": "b-100", "status": "queued"},
        )

    # Patch the BATCH module's _make_client (single-call path is unused).
    _patch_make_client(monkeypatch, bolna_batch_mod, _handler)

    batch_svc = BolnaBatchService(
        base_url="https://api.bolna.ai", api_key="k", connection_id=uuid.uuid4(),
    )
    resolver = _FakeResolver(bolna=None, bolna_batch=batch_svc)

    cohort_size = BATCH_THRESHOLD + 5
    cohort = CohortStream([
        (f"L-{i}", {"phone": f"+91999990{i:04d}", "first_name": f"R{i}"})
        for i in range(cohort_size)
    ])
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, agent_id="ag-1", phone_field="phone",
        variable_mappings=[
            {"agent_variable": "first_name", "source_kind": "payload",
             "payload_field": "first_name"},
        ],
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, step_id=step_id,
                    connections=resolver)
    result = await _Handler().execute(cohort, cfg, ctx)

    # Exactly one upstream HTTP call, regardless of cohort size.
    assert len(captured) == 1
    assert captured[0].url.path == "/batches"
    body = captured[0].content
    # CSV file part includes the recipient_id column so the Phase E
    # poller can correlate each Bolna execution back to a workflow row.
    assert b"recipient_id" in body
    assert b"L-0" in body and b"L-14" in body  # cohort_size = 15

    # All recipients flow to success; per-execution outcome arrives via
    # the poller in Phase E.
    assert len(result.by_output_id["success"]) == cohort_size
    assert result.summary == {
        "mode": "batch",
        "batch_id": "b-100",
        "success_count": cohort_size,
        "exhausted_count": 0,
        "template_slug": slug,
    }
    assert all(
        outcome.payload_delta.get("last_outcome") == "bolna_queued"
        and "last_event_at" in outcome.payload_delta
        for outcome in result.by_output_id["success"]
    )

    # One action row per recipient with mode=batch.
    rows = (await db_session.execute(
        select(
            WorkflowRunRecipientAction.recipient_id,
            WorkflowRunRecipientAction.status,
            WorkflowRunRecipientAction.response,
        ).where(WorkflowRunRecipientAction.run_id == run.id)
    )).all()
    assert len(rows) == cohort_size
    for _rid, status, resp in rows:
        assert status == "success"
        assert resp["mode"] == "batch"
        assert resp["batch_id"] == "b-100"


# ─── Batch path: upstream error → all recipients exhausted ─────────────


@pytest.mark.asyncio
async def test_batch_upstream_error_exhausts_cohort(
    db_session, seed_full_run, monkeypatch,
):
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"batchfail-{uuid.uuid4().hex[:8]}"
    _seed_template(db_session, slug)
    step_id = _make_step(db_session, run=run, version=version, workflow=workflow,
                         tenant_id=tenant_id, app_id=app_id)
    await db_session.flush()

    def _handler(_request):
        return httpx.Response(400, json={"error": "agent unknown"})

    _patch_make_client(monkeypatch, bolna_batch_mod, _handler)
    batch_svc = BolnaBatchService(
        base_url="https://api.bolna.ai", api_key="k", connection_id=uuid.uuid4(),
    )
    resolver = _FakeResolver(bolna=None, bolna_batch=batch_svc)

    cohort_size = BATCH_THRESHOLD + 1
    cohort = CohortStream([
        (f"L-{i}", {"phone": f"+9199999000{i:02d}"}) for i in range(cohort_size)
    ])
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, agent_id="ag-1", phone_field="phone",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, step_id=step_id,
                    connections=resolver)
    result = await _Handler().execute(cohort, cfg, ctx)
    assert result.by_output_id["success"] == []
    assert len(result.by_output_id["exhausted"]) == cohort_size
    assert "batch_error" in result.summary


# ─── Batch path: phone-less recipients short-circuit to exhausted ──────


@pytest.mark.asyncio
async def test_batch_fails_fast_on_recipient_without_phone(
    db_session, seed_full_run, monkeypatch,
):
    """A cohort with even one phone-less recipient must raise at the
    contact-presence check — not silently drop the row.

    Pre-2026-05-05 behavior was "skip silently and dispatch the rest";
    that lost leads to silent data drops at scale. The shared
    ``_dispatch_contract.assert_contact_field_present`` helper now
    raises ``RuntimeError`` so missing contact fields surface in the
    run's failure reason instead of disappearing into the void.
    Operators fix the cohort source (CRM phone column) and re-run."""
    run, version, workflow, _step, tenant_id, app_id = seed_full_run
    slug = f"skip-{uuid.uuid4().hex[:8]}"
    _seed_template(db_session, slug)
    step_id = _make_step(db_session, run=run, version=version, workflow=workflow,
                         tenant_id=tenant_id, app_id=app_id)
    await db_session.flush()

    def _handler(_request):
        return httpx.Response(200, json={"batch_id": "b-skip"})

    _patch_make_client(monkeypatch, bolna_batch_mod, _handler)
    batch_svc = BolnaBatchService(
        base_url="https://api.bolna.ai", api_key="k", connection_id=uuid.uuid4(),
    )
    resolver = _FakeResolver(bolna=None, bolna_batch=batch_svc)

    rows: list[tuple[str, dict]] = []
    for i in range(BATCH_THRESHOLD + 2):
        if i == 3:
            rows.append((f"L-{i}", {}))  # no phone
        else:
            rows.append((f"L-{i}", {"phone": f"+9199999000{i:02d}"}))
    cohort = CohortStream(rows)
    cfg = _Config(
        connection_id=uuid.uuid4(),
        template_slug=slug, agent_id="ag-1", phone_field="phone",
    )
    ctx = _make_ctx(db_session, run=run, version=version, workflow=workflow,
                    tenant_id=tenant_id, app_id=app_id, step_id=step_id,
                    connections=resolver)
    with pytest.raises(RuntimeError, match="missing required contact field 'phone'"):
        await _Handler().execute(cohort, cfg, ctx)
