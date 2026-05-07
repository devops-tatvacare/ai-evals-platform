"""Phase 12 / Task 6 — end-to-end dataset → cohort-query SQL.

Live-DB smoke test for the full path:

  1. Create a dataset.
  2. Import a CSV (3 rows) producing v1 with rows in
     ``orchestration.cohort_dataset_rows``.
  3. Resolve the source via ``resolve_source`` (Task 5 hybrid resolver).
  4. Compile a ``source.cohort_query`` config against it (Task 6 JSONB
     branch).
  5. Execute the emitted INSERT-from-SELECT against
     ``orchestration.workflow_run_recipient_states``.
  6. Read back the inserted recipient states and assert recipient_ids
     and payload contents match the imported CSV.

The savepoint-rollback ``db_session`` fixture isolates side effects.
``import_version`` calls ``db.commit()``; we alias commit→flush so it
stays inside the savepoint per the dataset-routes test pattern.
"""
from __future__ import annotations

import io
import uuid

import pytest
from sqlalchemy import select, text

from app.models.orchestration import (
    CohortDatasetRow,
    Workflow,
    WorkflowRun,
    WorkflowRunRecipientState,
    WorkflowVersion,
)
from app.services.orchestration.api.datasets import (
    create_dataset,
    import_version,
)
from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryConfig,
    compile_cohort_query,
)
from app.services.orchestration.source_catalog import resolve_source


CSV_3ROWS = (
    "recipient_id,name,mql_score\n"
    "r1,alice,30\n"
    "r2,bob,75\n"
    "r3,carol,90\n"
)


async def _seed_workflow_version_run(
    db_session,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    source_ref: str,
):
    workflow = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type="crm",
        slug=f"e2e-{uuid.uuid4().hex[:8]}",
        name="dataset e2e",
        created_by=user_id,
    )
    db_session.add(workflow)
    await db_session.flush()

    version = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        version=1,
        definition={
            "nodes": [
                {
                    "id": "src",
                    "type": "source.cohort_query",
                    "config": {"source_ref": source_ref},
                },
                {"id": "done", "type": "sink.complete", "config": {}},
            ],
            "edges": [{"source": "src", "target": "done", "output_id": "default"}],
        },
        status="published",
    )
    db_session.add(version)
    await db_session.flush()

    run = WorkflowRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow.id,
        workflow_version_id=version.id,
        triggered_by="manual",
        triggered_by_user_id=user_id,
        status="running",
    )
    db_session.add(run)
    await db_session.flush()
    return workflow, version, run


@pytest.fixture
def commit_as_flush(db_session):
    """Pin db.commit() to flush() so import_version stays inside the savepoint.

    Same shim used by the dataset-routes test. Safe because the outer
    db_session fixture rolls back the connection-level transaction at
    teardown.
    """
    original = db_session.commit
    db_session.commit = db_session.flush  # type: ignore[assignment]
    try:
        yield db_session
    finally:
        db_session.commit = original  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_e2e_csv_to_recipient_states_column_id_strategy(
    commit_as_flush, seed_tenant_user_app,
):
    db_session = commit_as_flush
    tenant_id, user_id, app_id = seed_tenant_user_app

    # 1. Create dataset + import CSV with explicit recipient_id column.
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"e2e-col-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    version = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=io.StringIO(CSV_3ROWS),
        source_filename="cohort.csv",
        source_byte_size=len(CSV_3ROWS),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    assert version["row_count"] == 3

    # Sanity check: rows landed in cohort_dataset_rows.
    row_count = await db_session.scalar(
        select(text("count(*)"))
        .select_from(CohortDatasetRow)
        .where(CohortDatasetRow.dataset_version_id == version["id"])
    )
    assert row_count == 3

    # 2. Build workflow + run referencing the dataset.
    source_ref = f"dataset.{version['id']}"
    workflow, wf_version, run = await _seed_workflow_version_run(
        db_session,
        tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        source_ref=source_ref,
    )

    # 3. Resolve + compile.
    resolved = await resolve_source(
        source_ref, db=db_session, tenant_id=tenant_id,
    )
    cfg = CohortQueryConfig(source_ref=source_ref)
    sql, params = compile_cohort_query(
        cfg,
        run_id=run.id,
        workflow_id=workflow.id,
        workflow_version_id=wf_version.id,
        tenant_id=tenant_id,
        app_id=app_id,
        next_node_id="done",
        resolved_source=resolved,
    )

    # 4. Execute. INSERT...RETURNING — assert 3 recipient_ids surfaced.
    result = await db_session.execute(text(sql), params)
    inserted = [r[0] for r in result.all()]
    assert sorted(inserted) == ["r1", "r2", "r3"]

    # 5. Read back via the ORM and check payload contents survived the
    # JSONB round-trip with full payload retention.
    states = (
        await db_session.execute(
            select(WorkflowRunRecipientState)
            .where(WorkflowRunRecipientState.run_id == run.id)
            .order_by(WorkflowRunRecipientState.recipient_id)
        )
    ).scalars().all()
    assert [s.recipient_id for s in states] == ["r1", "r2", "r3"]
    by_id = {s.recipient_id: s.payload for s in states}
    # The importer keeps the id column in the payload alongside the rest;
    # the dataset branch carries the full payload through, so assert the
    # full shape including the recipient_id key.
    assert by_id["r1"] == {"recipient_id": "r1", "name": "alice", "mql_score": "30"}
    assert by_id["r2"] == {"recipient_id": "r2", "name": "bob", "mql_score": "75"}
    assert by_id["r3"] == {"recipient_id": "r3", "name": "carol", "mql_score": "90"}
    assert all(s.current_node_id == "done" for s in states)
    assert all(s.status == "ready" for s in states)


@pytest.mark.asyncio
async def test_e2e_csv_to_recipient_states_uuid_id_strategy(
    commit_as_flush, seed_tenant_user_app,
):
    db_session = commit_as_flush
    tenant_id, user_id, app_id = seed_tenant_user_app

    csv_no_id = "name,mql_score\nalice,30\nbob,75\ncarol,90\n"
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        name=f"e2e-uuid-{uuid.uuid4().hex[:6]}",
        description=None, created_by=user_id,
    )
    version = await import_version(
        db_session,
        tenant_id=tenant_id, dataset_id=ds["id"],
        file_handle=io.StringIO(csv_no_id),
        source_filename="cohort.csv", source_byte_size=len(csv_no_id),
        id_strategy="uuid", id_column=None,
        imported_by=user_id,
    )
    source_ref = f"dataset.{version['id']}"
    workflow, wf_version, run = await _seed_workflow_version_run(
        db_session,
        tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        source_ref=source_ref,
    )
    resolved = await resolve_source(
        source_ref, db=db_session, tenant_id=tenant_id,
    )
    sql, params = compile_cohort_query(
        CohortQueryConfig(source_ref=source_ref),
        run_id=run.id, workflow_id=workflow.id,
        workflow_version_id=wf_version.id,
        tenant_id=tenant_id, app_id=app_id, next_node_id="done",
        resolved_source=resolved,
    )
    result = await db_session.execute(text(sql), params)
    inserted = [r[0] for r in result.all()]
    assert len(inserted) == 3
    # Auto-generated UUIDs — each parses as a UUID, all unique.
    assert len(set(inserted)) == 3
    for rid in inserted:
        uuid.UUID(rid)


@pytest.mark.asyncio
async def test_e2e_jsonb_filter_narrows_cohort(
    commit_as_flush, seed_tenant_user_app,
):
    """Filter on numeric column via JSONB cast — only rows matching come back."""
    db_session = commit_as_flush
    tenant_id, user_id, app_id = seed_tenant_user_app

    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id, app_id=app_id,
        name=f"e2e-filt-{uuid.uuid4().hex[:6]}",
        description=None, created_by=user_id,
    )
    version = await import_version(
        db_session,
        tenant_id=tenant_id, dataset_id=ds["id"],
        file_handle=io.StringIO(CSV_3ROWS),
        source_filename="cohort.csv", source_byte_size=len(CSV_3ROWS),
        id_strategy="column", id_column="recipient_id",
        imported_by=user_id,
    )
    # Confirm the importer typed mql_score as integer — that's what makes
    # the numeric cast work end-to-end.
    score_col = next(
        c for c in version["schema_descriptor"]["columns"]
        if c["name"] == "mql_score"
    )
    assert score_col["type"] == "integer"

    source_ref = f"dataset.{version['id']}"
    workflow, wf_version, run = await _seed_workflow_version_run(
        db_session,
        tenant_id=tenant_id, user_id=user_id, app_id=app_id,
        source_ref=source_ref,
    )
    resolved = await resolve_source(
        source_ref, db=db_session, tenant_id=tenant_id,
    )
    cfg = CohortQueryConfig(
        source_ref=source_ref,
        filters=[{"column": "mql_score", "op": "gte", "value": 70}],
    )
    sql, params = compile_cohort_query(
        cfg,
        run_id=run.id, workflow_id=workflow.id,
        workflow_version_id=wf_version.id,
        tenant_id=tenant_id, app_id=app_id, next_node_id="done",
        resolved_source=resolved,
    )
    # Sanity-check the emitted SQL on the way through.
    assert "NULLIF(src.payload->>'mql_score', '')::bigint >= :filter_0" in sql

    result = await db_session.execute(text(sql), params)
    inserted = sorted(r[0] for r in result.all())
    # r1 (30) is filtered out; r2 (75) + r3 (90) survive.
    assert inserted == ["r2", "r3"]
