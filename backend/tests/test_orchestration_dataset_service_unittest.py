"""Service-layer tests for ``services.orchestration.api.datasets``.

Covers the public surface (create / list / get / delete dataset, import /
get / delete version), tenant isolation, name-conflict mapping, and
workflow-binding refusal on delete. Live-DB via the shared ``db_session``
fixture; rolled back by the savepoint pattern in conftest.

CsvImportError propagation is asserted (the service does NOT wrap parser
errors — the route layer maps them to 400).
"""
from __future__ import annotations

import io
import uuid

import pytest
from sqlalchemy import select

from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.models.orchestration import (
    CohortDataset,
    CohortDatasetVersion,
    Workflow,
    WorkflowVersion,
)
from app.services.orchestration.api.datasets import (
    DatasetConflict,
    DatasetInUse,
    DatasetNotFound,
    create_dataset,
    delete_dataset,
    delete_version,
    get_dataset,
    get_version,
    import_version,
    list_datasets,
)
from app.services.orchestration.datasets.csv_importer import CsvImportError


CSV_BASIC = "recipient_id,name,age\nr1,alice,30\nr2,bob,25\nr3,carol,40\n"


def _csv(text: str) -> io.StringIO:
    return io.StringIO(text)


async def _seed_workflow_with_dataset_binding(
    db_session,
    *,
    tenant_id,
    user_id,
    app_id,
    version_id: uuid.UUID,
    workflow_name: str = "Bound Workflow",
) -> Workflow:
    workflow = Workflow(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type="crm",
        slug=f"binding-{uuid.uuid4().hex[:8]}",
        name=workflow_name,
        created_by=user_id,
    )
    db_session.add(workflow)
    await db_session.flush()
    wf_version = WorkflowVersion(
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
                    "config": {"source_ref": f"dataset.{version_id}"},
                },
                {"id": "done", "type": "sink.complete", "config": {}},
            ],
            "edges": [{"source": "src", "target": "done"}],
        },
        status="published",
    )
    db_session.add(wf_version)
    await db_session.flush()
    workflow.current_published_version_id = wf_version.id
    await db_session.flush()
    return workflow


# ─── 1. Happy path ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_import_list_get_happy_path(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app

    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"happy-{uuid.uuid4().hex[:6]}",
        description="happy-path dataset",
        created_by=user_id,
    )
    assert ds["latest_version"] is None

    version = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="cohort.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    assert version["row_count"] == 3
    assert version["version_number"] == 1
    assert version["sample_rows"] == []

    listed = await list_datasets(db_session, tenant_id=tenant_id, app_id=app_id)
    matches = [r for r in listed if r["id"] == ds["id"]]
    assert len(matches) == 1
    assert matches[0]["latest_version"] is not None
    assert matches[0]["latest_version"]["row_count"] == 3
    assert matches[0]["latest_version"]["version_number"] == 1

    detail = await get_dataset(
        db_session, tenant_id=tenant_id, dataset_id=ds["id"],
    )
    assert len(detail["versions"]) == 1

    with_sample = await get_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        version_id=version["id"],
        sample_rows=2,
    )
    assert len(with_sample["sample_rows"]) == 2
    assert with_sample["sample_rows"][0]["recipient_id"] == "r1"
    assert with_sample["sample_rows"][0]["payload"]["name"] == "alice"


# ─── 2. UUID id strategy ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_import_with_uuid_id_strategy(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"uuid-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    csv_no_id = "name,age\nalice,30\nbob,25\n"
    version = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(csv_no_id),
        source_filename="x.csv",
        source_byte_size=len(csv_no_id),
        id_strategy="uuid",
        id_column=None,
        imported_by=user_id,
    )
    assert version["row_count"] == 2
    assert version["id_strategy"] == "uuid"
    assert version["id_column"] is None

    sampled = await get_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        version_id=version["id"],
        sample_rows=10,
    )
    recipient_ids = [r["recipient_id"] for r in sampled["sample_rows"]]
    assert len(recipient_ids) == 2
    assert len(set(recipient_ids)) == 2  # unique
    for rid in recipient_ids:
        uuid.UUID(rid)  # parses as UUID


# ─── 3. Version increment ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_import_twice_increments_version_number(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"versioned-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    v1 = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="v1.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    csv_v2 = "recipient_id,name\nr10,dave\n"
    v2 = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(csv_v2),
        source_filename="v2.csv",
        source_byte_size=len(csv_v2),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    assert v1["version_number"] == 1
    assert v2["version_number"] == 2

    detail = await get_dataset(
        db_session, tenant_id=tenant_id, dataset_id=ds["id"],
    )
    assert [v["version_number"] for v in detail["versions"]] == [2, 1]


# ─── 4. Bad id_column raises CsvImportError (unwrapped) ────────────────────


@pytest.mark.asyncio
async def test_import_with_bad_id_column_raises_csv_import_error(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"badid-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    with pytest.raises(CsvImportError):
        await import_version(
            db_session,
            tenant_id=tenant_id,
            dataset_id=ds["id"],
            file_handle=_csv(CSV_BASIC),
            source_filename="bad.csv",
            source_byte_size=len(CSV_BASIC),
            id_strategy="column",
            id_column="not_a_real_column",
            imported_by=user_id,
        )


# ─── 5 + 6. delete_version with / without binding ─────────────────────────


@pytest.mark.asyncio
async def test_delete_version_when_no_binding_succeeds(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"unbound-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    v = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="x.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    await delete_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        version_id=v["id"],
    )
    remaining = await db_session.scalar(
        select(CohortDatasetVersion).where(CohortDatasetVersion.id == v["id"])
    )
    assert remaining is None


@pytest.mark.asyncio
async def test_delete_version_blocked_by_workflow_binding(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"bound-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    v = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="x.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    workflow = await _seed_workflow_with_dataset_binding(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        version_id=v["id"],
        workflow_name="Bound v1",
    )
    with pytest.raises(DatasetInUse) as exc_info:
        await delete_version(
            db_session,
            tenant_id=tenant_id,
            dataset_id=ds["id"],
            version_id=v["id"],
        )
    assert workflow.id in exc_info.value.workflow_ids
    assert "Bound v1" in exc_info.value.workflow_names


# ─── 7 + 8. delete_dataset with / without binding ─────────────────────────


@pytest.mark.asyncio
async def test_delete_dataset_cascades_when_unbound(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"cascade-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="x.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    await delete_dataset(
        db_session, tenant_id=tenant_id, dataset_id=ds["id"],
    )
    listed = await list_datasets(db_session, tenant_id=tenant_id, app_id=app_id)
    assert all(r["id"] != ds["id"] for r in listed)


@pytest.mark.asyncio
async def test_delete_dataset_blocked_by_workflow_binding(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    ds = await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"bound-ds-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )
    v = await import_version(
        db_session,
        tenant_id=tenant_id,
        dataset_id=ds["id"],
        file_handle=_csv(CSV_BASIC),
        source_filename="x.csv",
        source_byte_size=len(CSV_BASIC),
        id_strategy="column",
        id_column="recipient_id",
        imported_by=user_id,
    )
    await _seed_workflow_with_dataset_binding(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        version_id=v["id"],
        workflow_name="Bound DS",
    )
    with pytest.raises(DatasetInUse) as exc_info:
        await delete_dataset(
            db_session, tenant_id=tenant_id, dataset_id=ds["id"],
        )
    assert "Bound DS" in exc_info.value.workflow_names


# ─── 9. Cross-tenant isolation ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cross_tenant_isolation(db_session, seed_tenant_user_app):
    tenant_a, user_id, app_id = seed_tenant_user_app
    # tenant_b is a fabricated UUID — we don't seed a real platform tenant
    # because we never insert under tenant_b; we only assert that tenant_a's
    # data is invisible from tenant_b's perspective and vice-versa for the
    # negative read paths.
    tenant_b = uuid.uuid4()

    ds_a = await create_dataset(
        db_session,
        tenant_id=tenant_a,
        app_id=app_id,
        name=f"iso-{uuid.uuid4().hex[:6]}",
        description=None,
        created_by=user_id,
    )

    listed_b = await list_datasets(db_session, tenant_id=tenant_b, app_id=app_id)
    assert all(r["id"] != ds_a["id"] for r in listed_b)

    with pytest.raises(DatasetNotFound):
        await get_dataset(
            db_session, tenant_id=tenant_b, dataset_id=ds_a["id"],
        )

    with pytest.raises(DatasetNotFound):
        await import_version(
            db_session,
            tenant_id=tenant_b,
            dataset_id=ds_a["id"],
            file_handle=_csv(CSV_BASIC),
            source_filename="x.csv",
            source_byte_size=len(CSV_BASIC),
            id_strategy="column",
            id_column="recipient_id",
            imported_by=user_id,
        )


# ─── 10. Name conflict ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_duplicate_name_raises_conflict(
    db_session, seed_tenant_user_app
):
    tenant_id, user_id, app_id = seed_tenant_user_app
    name = f"dup-{uuid.uuid4().hex[:6]}"
    await create_dataset(
        db_session,
        tenant_id=tenant_id,
        app_id=app_id,
        name=name,
        description=None,
        created_by=user_id,
    )
    with pytest.raises(DatasetConflict):
        await create_dataset(
            db_session,
            tenant_id=tenant_id,
            app_id=app_id,
            name=name,
            description=None,
            created_by=user_id,
        )
