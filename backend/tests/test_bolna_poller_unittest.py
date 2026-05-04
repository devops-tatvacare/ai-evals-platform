"""Per-correlation Bolna polling chain — happy paths, idempotency, ceiling.

Replaces the every-minute ``run_once`` sweep tests. Each test exercises
``poll_correlation_once`` against the live local Postgres (via the
``db_session`` fixture) with the upstream Bolna service mocked at the
module-import boundary.

What we cover:

- Single-call terminal events reconcile + flip ``provider_terminal``.
- Single-call non-terminal events return ``rescheduled`` and write a
  next-attempt BackgroundJob row (with bumped ``available_at``).
- Batch executions reconciled in one paginated fetch, matched back to
  recipients via ``user_data.recipient_id``.
- Empty open-actions short-circuits without an upstream call.
- Missing / wrong-provider connection returns ``connection_missing``
  without an upstream call.
- Re-running with the same ``(correlation_id, attempt)`` is a no-op
  (ON CONFLICT DO NOTHING on the partial unique idempotency index).
- Ceiling reached (first_attempt_at older than 6 h) flushes remaining
  open rows via the ``bolna_poll_timeout`` synthetic event.
- Anomaly sweep's ``find_orphan_correlations`` detects rows without a
  live polling job and skips ones with a live job.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from cryptography.fernet import Fernet

from app.constants import SYSTEM_USER_ID
from app.models.job import BackgroundJob
from app.models.orchestration import WorkflowRunRecipientAction
from app.models.provider_connection import ProviderConnection
from app.services.orchestration.connections import crypto as connection_crypto
from app.services.orchestration.dispatch import bolna_poller
from sqlalchemy import select


# ── Pure-function tests ────────────────────────────────────────────────


def test_index_executions_keys_by_recipient_and_execution():
    rows = [
        {
            "execution_id": "ex-A",
            "status": "completed",
            "context_details": {"recipient_data": {"recipient_id": "L-1"}},
        },
        {"execution_id": "ex-B", "status": "no-answer"},
    ]
    idx = bolna_poller._index_executions(rows)
    assert idx["recipient:L-1"]["execution_id"] == "ex-A"
    assert idx["execution:ex-A"]["execution_id"] == "ex-A"
    assert idx["execution:ex-B"]["status"] == "no-answer"


def test_backoff_schedule_matches_spec():
    """30s (initial, set by dispatch) → 60s → 2m → 5m → 10m → 15m → 15m..."""
    # next_attempt=1 is unreachable in production (handler always sees 2+),
    # but the helper still has to be defined; assert the sentinel.
    assert bolna_poller._backoff_for_next_attempt(1) == 30
    assert bolna_poller._backoff_for_next_attempt(2) == 60
    assert bolna_poller._backoff_for_next_attempt(3) == 120
    assert bolna_poller._backoff_for_next_attempt(4) == 300
    assert bolna_poller._backoff_for_next_attempt(5) == 600
    assert bolna_poller._backoff_for_next_attempt(6) == 900
    # Past the explicit table → cap.
    assert bolna_poller._backoff_for_next_attempt(7) == 900
    assert bolna_poller._backoff_for_next_attempt(50) == 900


# ── Fixtures + helpers ─────────────────────────────────────────────────


class _FakeBolna:
    """Drop-in for BolnaService.get_execution."""

    def __init__(self, executions: dict[str, dict[str, Any]]) -> None:
        self._executions = executions
        self.calls: list[str] = []

    async def get_execution(self, *, execution_id: str) -> dict[str, Any]:
        self.calls.append(execution_id)
        return self._executions[execution_id]


class _FakeBolnaBatch:
    """Drop-in for BolnaBatchService.list_batch_executions. Single-page;
    multi-page coverage isn't useful for this test surface and would
    duplicate what the Bolna integration tests already cover."""

    def __init__(self, *, batch_id: str, executions: list[dict[str, Any]]) -> None:
        self._batch_id = batch_id
        self._executions = executions
        self.calls: list[tuple[str, int]] = []

    async def list_batch_executions(
        self, batch_id: str, *, page: int = 1, page_size: int = 100,
    ) -> dict[str, Any]:
        self.calls.append((batch_id, page))
        if batch_id != self._batch_id:
            return {"executions": [], "page": page, "total": 0}
        return {
            "executions": self._executions,
            "page": page,
            "total": len(self._executions),
            "page_size": page_size,
        }


@pytest.fixture
def _bolna_connection_key(monkeypatch):
    """Stable Fernet key per test. Each test gets its own — the orchestration
    crypto module reads the env var at encrypt/decrypt time, so this swap is
    safe across the live db_session."""
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


async def _seed_bolna_connection(db_session, *, tenant_id, app_id) -> uuid.UUID:
    cid = uuid.uuid4()
    db_session.add(ProviderConnection(
        id=cid, tenant_id=tenant_id, app_id=app_id,
        provider="bolna",
        name=f"bolna-poll-{cid.hex[:8]}",
        config_encrypted=connection_crypto.encrypt({
            "base_url": "https://api.bolna.ai",
            "api_key": "k-test",
        }),
        active=True,
        created_by=SYSTEM_USER_ID,
    ))
    await db_session.flush()
    return cid


def _seed_open_action(
    db, *, run, version, workflow, node_step, tenant_id, app_id,
    recipient_id: str, execution_id: str | None = None,
    batch_id: str | None = None,
) -> WorkflowRunRecipientAction:
    action = WorkflowRunRecipientAction(
        id=uuid.uuid4(), tenant_id=tenant_id, app_id=app_id,
        workflow_id=workflow.id, workflow_version_id=version.id,
        run_id=run.id, node_step_id=node_step.id, recipient_id=recipient_id,
        channel="bolna", action_type="bolna_queued", status="success",
        idempotency_key=f"bk-{uuid.uuid4().hex[:8]}",
        payload={}, response={"execution_id": execution_id, "batch_id": batch_id},
        bolna_execution_id=execution_id,
        bolna_batch_id=batch_id,
        provider_terminal=False,
    )
    db.add(action)
    return action


def _patch_bolna_services(monkeypatch, *, single=None, batch=None) -> None:
    """Patch the integration constructors that ``poll_correlation_once``
    imports lazily. We patch where they are *resolved* (the integrations
    module), not where they are imported in the poller."""
    if single is not None:
        from app.services.orchestration.integrations import bolna as bolna_mod
        monkeypatch.setattr(bolna_mod, "BolnaService", lambda **_kwargs: single)
    if batch is not None:
        from app.services.orchestration.integrations import bolna_batch as bb_mod
        monkeypatch.setattr(bb_mod, "BolnaBatchService", lambda **_kwargs: batch)


# ── poll_correlation_once happy paths ──────────────────────────────────


@pytest.mark.asyncio
async def test_poll_single_terminal_reconciles_action(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-1", execution_id="ex-1",
    )
    await db_session.flush()

    fake = _FakeBolna({"ex-1": {"execution_id": "ex-1", "status": "completed"}})
    _patch_bolna_services(monkeypatch, single=fake)

    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-1", kind="execution", attempt=1,
    )

    assert result.status == "done"
    assert result.events_reconciled == 1
    assert fake.calls == ["ex-1"]
    await db_session.refresh(a)
    assert a.provider_terminal is True
    assert a.provider_status == "completed"


@pytest.mark.asyncio
async def test_poll_single_in_flight_reschedules_with_backoff(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    """Non-terminal upstream → next-attempt BackgroundJob written via
    on_conflict_do_nothing, action stays open."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-2", execution_id="ex-2",
    )
    await db_session.flush()

    fake = _FakeBolna({"ex-2": {"execution_id": "ex-2", "status": "in-progress"}})
    _patch_bolna_services(monkeypatch, single=fake)

    before = datetime.now(timezone.utc)
    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-2", kind="execution", attempt=1,
    )

    assert result.status == "rescheduled"
    assert result.next_attempt == 2
    assert result.events_reconciled == 0
    await db_session.refresh(a)
    assert a.provider_terminal is False

    next_job = (
        await db_session.scalar(
            select(BackgroundJob).where(
                BackgroundJob.idempotency_key == "bolna-poll:ex-2:attempt-2"
            )
        )
    )
    assert next_job is not None
    assert next_job.job_type == "poll-bolna-correlation"
    assert next_job.status == "queued"
    # Backoff for attempt 2 is 60s — available_at lands in the future.
    assert next_job.available_at is not None
    assert next_job.available_at >= before + timedelta(seconds=55)
    assert next_job.params["attempt"] == 2
    assert next_job.params["correlation_id"] == "ex-2"
    assert next_job.params["kind"] == "execution"


@pytest.mark.asyncio
async def test_poll_batch_reconciles_each_open_recipient_in_one_fetch(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-A", batch_id="b-1",
    )
    b = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-B", batch_id="b-1",
    )
    await db_session.flush()

    fake_batch = _FakeBolnaBatch(batch_id="b-1", executions=[
        {
            "execution_id": "ex-aa", "status": "completed",
            "context_details": {"recipient_data": {"recipient_id": "L-A"}},
        },
        {
            "execution_id": "ex-bb", "status": "no-answer",
            "context_details": {"recipient_data": {"recipient_id": "L-B"}},
        },
    ])
    _patch_bolna_services(monkeypatch, batch=fake_batch)

    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="b-1", kind="batch", attempt=1,
    )

    assert result.status == "done"
    assert result.events_reconciled == 2
    assert fake_batch.calls == [("b-1", 1)]
    await db_session.refresh(a)
    await db_session.refresh(b)
    assert a.provider_terminal is True
    assert a.provider_status == "completed"
    assert b.provider_terminal is True
    assert b.provider_status == "no-answer"


# ── Short-circuits + idempotency ───────────────────────────────────────


@pytest.mark.asyncio
async def test_poll_with_no_open_actions_returns_done_without_upstream_call(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    fake = _FakeBolna({})  # no entries — would KeyError if called
    _patch_bolna_services(monkeypatch, single=fake)

    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-nope", kind="execution", attempt=1,
    )

    assert result.status == "done"
    assert result.events_reconciled == 0
    # Crucial: no upstream call — the chain dies without burning Bolna API.
    assert fake.calls == []


@pytest.mark.asyncio
async def test_poll_connection_missing_returns_status_without_upstream_call(
    db_session, seed_full_run, monkeypatch,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-orphan", execution_id="ex-orphan",
    )
    await db_session.flush()

    fake = _FakeBolna({})
    _patch_bolna_services(monkeypatch, single=fake)

    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=uuid.uuid4(),  # not seeded → won't resolve
        correlation_id="ex-orphan", kind="execution", attempt=1,
    )

    assert result.status == "connection_missing"
    assert fake.calls == []


@pytest.mark.asyncio
async def test_poll_idempotent_on_chain_retry(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    """If the worker retries this job after the next-attempt insert
    already committed, the second insert lands on the partial unique
    index and silently no-ops via on_conflict_do_nothing."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-idem", execution_id="ex-idem",
    )
    await db_session.flush()

    fake = _FakeBolna({"ex-idem": {"execution_id": "ex-idem", "status": "in-progress"}})
    _patch_bolna_services(monkeypatch, single=fake)

    first = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-idem", kind="execution", attempt=1,
    )
    second = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-idem", kind="execution", attempt=1,
    )
    assert first.status == "rescheduled"
    assert second.status == "rescheduled"

    # Exactly ONE attempt-2 row, despite two passes through the handler.
    rows = (await db_session.execute(
        select(BackgroundJob).where(
            BackgroundJob.idempotency_key == "bolna-poll:ex-idem:attempt-2"
        )
    )).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_poll_ceiling_reached_force_timeouts_remaining_rows(
    db_session, seed_full_run, monkeypatch, _bolna_connection_key,
):
    """``first_attempt_at`` more than 6 h ago + still-open rows → flush
    remaining via the bolna_poll_timeout synthetic event (routes via
    bolna_failed)."""
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid = await _seed_bolna_connection(db_session, tenant_id=tenant_id, app_id=app_id)
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-stuck", execution_id="ex-stuck",
    )
    await db_session.flush()

    fake = _FakeBolna({"ex-stuck": {"execution_id": "ex-stuck", "status": "in-progress"}})
    _patch_bolna_services(monkeypatch, single=fake)

    very_old = datetime.now(timezone.utc) - timedelta(hours=7)
    result = await bolna_poller.poll_correlation_once(
        db_session,
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        connection_id=cid, correlation_id="ex-stuck", kind="execution",
        attempt=99, first_attempt_at=very_old,
    )

    assert result.status == "ceiling_reached"
    await db_session.refresh(a)
    assert a.provider_terminal is True

    # No further chain enqueued past the ceiling.
    no_attempt_100 = await db_session.scalar(
        select(BackgroundJob).where(
            BackgroundJob.idempotency_key == "bolna-poll:ex-stuck:attempt-100"
        )
    )
    assert no_attempt_100 is None


# ── Anomaly sweep helper ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_orphan_correlation_detected_when_no_live_job(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid_uuid = uuid.uuid4()
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-orphan", execution_id="ex-orphaned",
    )
    a.payload = {"connection_id": str(cid_uuid)}
    # Backdate so the cutoff matches.
    a.created_at = datetime.now(timezone.utc) - timedelta(hours=12)
    await db_session.flush()

    found = await bolna_poller.find_orphan_correlations(
        db_session, older_than=timedelta(hours=6),
    )
    matching = [o for o in found if o.correlation_id == "ex-orphaned"]
    assert len(matching) == 1
    assert matching[0].connection_id == cid_uuid
    assert matching[0].kind == "execution"


@pytest.mark.asyncio
async def test_orphan_correlation_skipped_when_live_poll_job_exists(
    db_session, seed_full_run,
):
    run, version, workflow, node_step, tenant_id, app_id = seed_full_run
    cid_uuid = uuid.uuid4()
    a = _seed_open_action(
        db_session, run=run, version=version, workflow=workflow, node_step=node_step,
        tenant_id=tenant_id, app_id=app_id,
        recipient_id="L-covered", execution_id="ex-covered",
    )
    a.payload = {"connection_id": str(cid_uuid)}
    a.created_at = datetime.now(timezone.utc) - timedelta(hours=12)

    # Seed a live polling job — orphan detection must skip this correlation.
    db_session.add(BackgroundJob(
        id=uuid.uuid4(),
        tenant_id=tenant_id, user_id=SYSTEM_USER_ID, app_id=app_id,
        job_type="poll-bolna-correlation",
        queue_class="standard",
        status="queued",
        idempotency_key="bolna-poll:ex-covered:attempt-3",
        params={"correlation_id": "ex-covered"},
    ))
    await db_session.flush()

    found = await bolna_poller.find_orphan_correlations(
        db_session, older_than=timedelta(hours=6),
    )
    matching = [o for o in found if o.correlation_id == "ex-covered"]
    assert matching == []
