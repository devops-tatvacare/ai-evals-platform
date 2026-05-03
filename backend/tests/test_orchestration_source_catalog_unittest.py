"""Phase 11 / Phase 12 — source catalog scaffolding tests.

Sync helpers cover the static engineering-owned catalog (Phase 11). The
async ``resolve_source`` / ``list_dataset_sources`` helpers and the
HTTP route extension cover the Phase 12 dataset-backed sources.
"""
from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.orchestration import CohortDataset, CohortDatasetVersion
from app.models.tenant import Tenant
from app.services.orchestration.definition_normalizer import normalize_definition
from app.services.orchestration.source_catalog import (
    CohortSource,
    DatasetSource,
    SourceCatalogError,
    all_source_refs,
    get_source,
    list_dataset_sources,
    list_sources,
    lookup_source,
    resolve_source,
    reverse_lookup_by_table,
)


def test_seeded_refs_present():
    refs = set(all_source_refs())
    assert {"crm.lead_record", "clinical.dim_patient"}.issubset(refs)


def test_get_source_returns_canonical_table():
    s = get_source("crm.lead_record")
    assert s.schema_qualified_table == "analytics.crm_lead_record"
    assert s.id_column == "prospect_id"
    assert "first_name" in s.allowed_payload_columns
    assert "prospect_stage" in s.allowed_filter_columns
    assert "created_on" in s.allowed_lookback_columns


def test_clinical_source():
    s = get_source("clinical.dim_patient")
    assert s.schema_qualified_table == "clinical.dim_patient"
    assert s.id_column == "patient_id"
    assert "primary_condition" in s.allowed_filter_columns


def test_get_source_unknown_raises():
    with pytest.raises(SourceCatalogError):
        get_source("nope.unknown")


def test_lookup_source_returns_none_for_unknown():
    assert lookup_source("nope.unknown") is None


def test_list_sources_filters_by_workflow_type():
    crm = list_sources(workflow_type="crm")
    clinical = list_sources(workflow_type="clinical")
    assert any(s.source_ref == "crm.lead_record" for s in crm)
    assert all(s.source_ref != "crm.lead_record" for s in clinical)
    assert any(s.source_ref == "clinical.dim_patient" for s in clinical)


def test_list_sources_filters_by_app_id():
    visible = list_sources(app_id="inside-sales")
    refs = {s.source_ref for s in visible}
    assert "crm.lead_record" in refs
    assert "clinical.dim_patient" in refs


def test_reverse_lookup_recovers_legacy_table_to_ref():
    s = reverse_lookup_by_table("analytics.crm_lead_record")
    assert s is not None
    assert s.source_ref == "crm.lead_record"
    assert reverse_lookup_by_table("public.does_not_exist") is None


# ─── Phase 12 — async resolver + DB-backed dataset sources ─────────────────


APP_ID = "inside-sales"


def _schema_descriptor(columns: list[dict]) -> dict:
    return {"columns": columns, "row_count": len(columns)}


async def _seed_tenant(db_session) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    db_session.add(Tenant(
        id=tenant_id,
        name=f"src-cat-{tenant_id.hex[:8]}",
        slug=f"src-cat-{tenant_id.hex[:8]}",
        is_active=True,
    ))
    await db_session.flush()
    return tenant_id


async def _seed_dataset_with_version(
    db_session,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    name: str,
    version_number: int = 1,
    id_strategy: str = "uuid",
    id_column: str | None = None,
    columns: list[dict] | None = None,
) -> tuple[CohortDataset, CohortDatasetVersion]:
    dataset = CohortDataset(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        name=name,
        description="phase 12 src cat fixture",
        created_by=user_id,
    )
    db_session.add(dataset)
    await db_session.flush()
    cols = columns if columns is not None else [
        {"name": "phone", "type": "string", "sample_values": ["+91"], "distinct_count": 1},
        {"name": "first_seen_at", "type": "datetime", "sample_values": ["2026-01-01"], "distinct_count": 1},
    ]
    version = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        version_number=version_number,
        source_type="csv",
        source_filename="cohort.csv",
        source_byte_size=1024,
        row_count=1,
        id_strategy=id_strategy,
        id_column=id_column,
        schema_descriptor=_schema_descriptor(cols),
        imported_by=user_id,
    )
    db_session.add(version)
    await db_session.flush()
    return dataset, version


@pytest.mark.asyncio
async def test_resolve_source_static_returns_cohort_source(db_session, seed_tenant_user_app):
    tenant_id, _user_id, _app_id = seed_tenant_user_app
    out = await resolve_source("crm.lead_record", db=db_session, tenant_id=tenant_id)
    assert isinstance(out, CohortSource)
    assert out.source_ref == "crm.lead_record"
    assert out.schema_qualified_table == "analytics.crm_lead_record"


@pytest.mark.asyncio
async def test_resolve_source_dataset_returns_dataset_source(db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    dataset, version = await _seed_dataset_with_version(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=APP_ID,
        name=f"resolve-{uuid.uuid4().hex[:8]}",
        version_number=2,
        id_strategy="column",
        id_column="phone",
    )
    out = await resolve_source(
        f"dataset.{version.id}", db=db_session, tenant_id=tenant_id,
    )
    assert isinstance(out, DatasetSource)
    assert out.dataset_id == dataset.id
    assert out.dataset_version_id == version.id
    assert out.display_label == f"{dataset.name} (v2)"
    assert out.id_strategy == "column"
    assert out.id_column == "phone"
    assert out.app_id == APP_ID
    assert out.workflow_types == ["*"]
    assert out.schema_descriptor["columns"][0]["name"] == "phone"


@pytest.mark.asyncio
async def test_resolve_source_dataset_other_tenant_raises(db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    other_tenant = await _seed_tenant(db_session)
    _, version = await _seed_dataset_with_version(
        db_session,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=APP_ID,
        name=f"isolation-{uuid.uuid4().hex[:8]}",
    )
    with pytest.raises(SourceCatalogError, match="not found or not owned"):
        await resolve_source(
            f"dataset.{version.id}", db=db_session, tenant_id=other_tenant,
        )


@pytest.mark.asyncio
async def test_resolve_source_dataset_malformed_uuid_raises(db_session, seed_tenant_user_app):
    tenant_id, _user_id, _ = seed_tenant_user_app
    with pytest.raises(SourceCatalogError, match="malformed"):
        await resolve_source("dataset.not-a-uuid", db=db_session, tenant_id=tenant_id)


@pytest.mark.asyncio
async def test_resolve_source_dataset_unknown_uuid_raises(db_session, seed_tenant_user_app):
    tenant_id, _user_id, _ = seed_tenant_user_app
    with pytest.raises(SourceCatalogError, match="not found"):
        await resolve_source(
            f"dataset.{uuid.uuid4()}", db=db_session, tenant_id=tenant_id,
        )


@pytest.mark.asyncio
async def test_resolve_source_unknown_prefix_raises(db_session, seed_tenant_user_app):
    tenant_id, _user_id, _ = seed_tenant_user_app
    with pytest.raises(SourceCatalogError, match="unknown source_ref"):
        await resolve_source("totally-unknown", db=db_session, tenant_id=tenant_id)


@pytest.mark.asyncio
async def test_list_dataset_sources_returns_latest_version_per_dataset(
    db_session, seed_tenant_user_app,
):
    tenant_id, user_id, _ = seed_tenant_user_app
    name_a = f"latest-a-{uuid.uuid4().hex[:8]}"
    _, v1 = await _seed_dataset_with_version(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=APP_ID,
        name=name_a, version_number=1,
    )
    # Reuse the same dataset id for v2 by inserting a CohortDatasetVersion
    # against the existing dataset row.
    dataset_a_id = (await db_session.execute(
        select(CohortDataset.id).where(CohortDataset.id == v1.dataset_id)
    )).scalar_one()
    v2 = CohortDatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset_a_id,
        tenant_id=tenant_id,
        version_number=2,
        source_type="csv",
        source_filename="cohort_v2.csv",
        source_byte_size=2048,
        row_count=2,
        id_strategy="uuid",
        id_column=None,
        schema_descriptor=_schema_descriptor([{"name": "phone", "type": "string", "sample_values": [], "distinct_count": 0}]),
        imported_by=user_id,
    )
    db_session.add(v2)
    await db_session.flush()

    # A second dataset under a different app — must NOT appear when filtered.
    _, _other_app_version = await _seed_dataset_with_version(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id="kaira-bot",
        name=f"other-app-{uuid.uuid4().hex[:8]}", version_number=1,
    )

    out = await list_dataset_sources(db_session, tenant_id=tenant_id, app_id=APP_ID)
    matching = [d for d in out if d.dataset_id == dataset_a_id]
    assert len(matching) == 1
    assert matching[0].dataset_version_id == v2.id
    assert all(d.app_id == APP_ID for d in out)


@pytest.mark.asyncio
async def test_list_dataset_sources_tenant_isolation(db_session, seed_tenant_user_app):
    tenant_id, user_id, _ = seed_tenant_user_app
    other_tenant = await _seed_tenant(db_session)
    _, mine = await _seed_dataset_with_version(
        db_session, tenant_id=tenant_id, user_id=user_id, app_id=APP_ID,
        name=f"mine-{uuid.uuid4().hex[:8]}",
    )
    other_results = await list_dataset_sources(
        db_session, tenant_id=other_tenant, app_id=APP_ID,
    )
    assert all(d.dataset_version_id != mine.id for d in other_results)


def test_normalize_definition_preserves_dataset_source_ref():
    version_id = uuid.uuid4()
    raw = {
        "nodes": [
            {
                "id": "src",
                "type": "source.cohort_query",
                "config": {
                    "source_ref": f"dataset.{version_id}",
                    "payload_fields": ["phone"],
                },
            },
            {"id": "done", "type": "sink.complete", "config": {}},
        ],
        "edges": [{"source": "src", "target": "done", "output_id": "default"}],
    }
    out = normalize_definition(raw)
    src_node = next(n for n in out["nodes"] if n["id"] == "src")
    assert src_node["config"]["source_ref"] == f"dataset.{version_id}"
    # Untouched: no source_table sneaks in, no id_column added.
    assert "source_table" not in src_node["config"]
    assert "id_column" not in src_node["config"]


# ─── HTTP route — /api/orchestration/source_catalog ────────────────────────


def _make_auth(tenant_id: uuid.UUID) -> AuthContext:
    return AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="src-cat-route@orchestration.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )


@pytest_asyncio.fixture
async def route_tenant_id(db_session) -> uuid.UUID:
    return await _seed_tenant(db_session)


@pytest_asyncio.fixture
async def route_client(db_session, route_tenant_id):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]
    fastapi_app.dependency_overrides[get_auth_context] = lambda: _make_auth(route_tenant_id)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest.mark.asyncio
async def test_source_catalog_route_returns_static_and_dataset_kinds(
    route_client, db_session, route_tenant_id,
):
    # Seed one dataset under the route tenant + APP_ID — route should surface it.
    user_id = SYSTEM_USER_ID
    _, version = await _seed_dataset_with_version(
        db_session, tenant_id=route_tenant_id, user_id=user_id, app_id=APP_ID,
        name=f"route-{uuid.uuid4().hex[:8]}",
        columns=[
            {"name": "phone", "type": "string", "sample_values": [], "distinct_count": 0},
            {"name": "joined_at", "type": "datetime", "sample_values": [], "distinct_count": 0},
        ],
    )
    r = await route_client.get(f"/api/orchestration/source_catalog?appId={APP_ID}")
    assert r.status_code == 200, r.text
    body: list[dict[str, Any]] = r.json()

    static_entries = [e for e in body if e["kind"] == "static"]
    dataset_entries = [e for e in body if e["kind"] == "dataset"]
    assert any(e["sourceRef"] == "crm.lead_record" for e in static_entries)
    matching = [e for e in dataset_entries if e["sourceRef"] == f"dataset.{version.id}"]
    assert len(matching) == 1
    entry = matching[0]
    assert "phone" in entry["allowedPayloadColumns"]
    assert entry["allowedLookbackColumns"] == ["joined_at"]
    assert entry["idColumn"] == "recipient_id"  # uuid strategy default


@pytest.mark.asyncio
async def test_source_catalog_route_does_not_leak_other_tenants_datasets(
    route_client, db_session, route_tenant_id,
):
    # Seed a dataset under a *different* tenant — must not appear in response.
    other_tenant = await _seed_tenant(db_session)
    _, leaked = await _seed_dataset_with_version(
        db_session, tenant_id=other_tenant, user_id=SYSTEM_USER_ID, app_id=APP_ID,
        name=f"leaked-{uuid.uuid4().hex[:8]}",
    )
    r = await route_client.get(f"/api/orchestration/source_catalog?appId={APP_ID}")
    assert r.status_code == 200
    body: list[dict[str, Any]] = r.json()
    assert all(e["sourceRef"] != f"dataset.{leaked.id}" for e in body)
