"""CohortDataset / CohortDatasetVersion / CohortDatasetRow ORM round-trip.

Live-DB via the shared ``db_session`` fixture. Asserts the three Phase-12
schema rows persist + can be selected back out via the parent → child FK,
plus that the three CHECK constraints on cohort_dataset_versions actually
fire on bad inserts. These tests roll back at teardown so no rows leak.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.orchestration import (
    CohortDataset,
    CohortDatasetRow,
    CohortDatasetVersion,
)


async def _seed_dataset(db_session, tenant_id, user_id, app_id) -> CohortDataset:
    dataset = CohortDataset(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"dataset-{uuid.uuid4().hex[:8]}",
        description="check-constraint test fixture",
        created_by=user_id,
    )
    db_session.add(dataset)
    await db_session.flush()
    return dataset


@pytest.mark.asyncio
async def test_dataset_version_rows_round_trip(db_session, seed_tenant_user_app):
    tenant_id, user_id, app_id = seed_tenant_user_app

    dataset = CohortDataset(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        name=f"dataset-{uuid.uuid4().hex[:8]}",
        description="round-trip test fixture",
        created_by=user_id,
    )
    db_session.add(dataset)
    await db_session.flush()

    version = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=1,
        source_type="csv",
        source_filename="cohort.csv",
        source_byte_size=1024,
        row_count=2,
        id_strategy="uuid",
        id_column=None,
        schema_descriptor={"columns": []},
        imported_by=user_id,
    )
    db_session.add(version)
    await db_session.flush()

    db_session.add_all(
        [
            CohortDatasetRow(
                dataset_version_id=version.id,
                row_seq=1,
                tenant_id=tenant_id,
                recipient_id="recipient-001",
                payload={"name": "alice"},
            ),
            CohortDatasetRow(
                dataset_version_id=version.id,
                row_seq=2,
                tenant_id=tenant_id,
                recipient_id="recipient-002",
                payload={"name": "bob"},
            ),
        ]
    )
    await db_session.flush()

    rows = (
        await db_session.scalars(
            select(CohortDatasetRow)
            .where(CohortDatasetRow.dataset_version_id == version.id)
            .order_by(CohortDatasetRow.row_seq)
        )
    ).all()
    assert len(rows) == 2
    assert [r.recipient_id for r in rows] == ["recipient-001", "recipient-002"]
    assert rows[0].payload == {"name": "alice"}
    assert rows[1].payload == {"name": "bob"}


@pytest.mark.asyncio
async def test_dataset_version_id_strategy_check(db_session, seed_tenant_user_app):
    """id_strategy='hash' is rejected by ck_dataset_id_strategy."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    dataset = await _seed_dataset(db_session, tenant_id, user_id, app_id)

    bad = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=1,
        source_type="csv",
        row_count=0,
        id_strategy="hash",
        id_column=None,
        schema_descriptor={"columns": []},
        imported_by=user_id,
    )
    db_session.add(bad)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_dataset_version_source_type_check(db_session, seed_tenant_user_app):
    """source_type='excel' is rejected by ck_dataset_source_type."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    dataset = await _seed_dataset(db_session, tenant_id, user_id, app_id)

    bad = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=1,
        source_type="excel",
        row_count=0,
        id_strategy="uuid",
        id_column=None,
        schema_descriptor={"columns": []},
        imported_by=user_id,
    )
    db_session.add(bad)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_dataset_version_id_column_required_when_column_strategy(
    db_session, seed_tenant_user_app
):
    """id_strategy='column' with id_column=None is rejected by ck_dataset_id_column_when_column."""
    tenant_id, user_id, app_id = seed_tenant_user_app
    dataset = await _seed_dataset(db_session, tenant_id, user_id, app_id)

    bad = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=1,
        source_type="csv",
        row_count=0,
        id_strategy="column",
        id_column=None,
        schema_descriptor={"columns": []},
        imported_by=user_id,
    )
    db_session.add(bad)
    with pytest.raises((IntegrityError, DBAPIError)):
        await db_session.flush()
    await db_session.rollback()
