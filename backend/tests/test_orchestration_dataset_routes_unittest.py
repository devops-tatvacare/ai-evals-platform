"""End-to-end /api/orchestration/datasets route tests.

Mirrors the connection-routes test pattern: live ``db_session`` fixture,
override ``get_db`` and ``get_auth_context`` via FastAPI dependency_overrides,
HTTPX ``AsyncClient`` against the ASGI app.

Covers (per Phase 12 / Task 4 plan):
- auth required on every route (401 without auth)
- create / list / get / delete dataset CRUD shape and tenant isolation
- multipart CSV upload (uuid + column id strategies, version increment)
- 50 MB outer guard (413) vs. 20k row cap parser error (400)
- sampleRows clamp + out-of-range
- workflow-binding refusal on delete (409 with workflow names)
"""
from __future__ import annotations

import io
import uuid
import csv as _csv
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.auth import AuthContext, get_auth_context
from app.constants import SYSTEM_USER_ID
from app.database import get_db
from app.main import app as fastapi_app
from app.models.orchestration import Workflow, WorkflowVersion
from app.models.tenant import Tenant


APP_ID = "inside-sales"


def _override_db(db_session):
    async def _g():
        yield db_session
    fastapi_app.dependency_overrides[get_db] = _g
    db_session.commit = db_session.flush  # type: ignore[assignment]


def _make_auth(tenant_id: uuid.UUID) -> AuthContext:
    return AuthContext(
        user_id=SYSTEM_USER_ID,
        tenant_id=tenant_id,
        email="dataset-route@orchestration.local",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"voice-rx", "kaira-bot", "inside-sales"}),
    )


def _override_auth(auth: AuthContext):
    fastapi_app.dependency_overrides[get_auth_context] = lambda: auth


@pytest_asyncio.fixture
async def route_tenant_id(db_session) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    db_session.add(Tenant(
        id=tenant_id,
        name=f"ds-route-{tenant_id.hex[:8]}",
        slug=f"ds-route-{tenant_id.hex[:8]}",
        is_active=True,
    ))
    await db_session.flush()
    return tenant_id


@pytest_asyncio.fixture
async def other_tenant_id(db_session) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    db_session.add(Tenant(
        id=tenant_id,
        name=f"ds-route-other-{tenant_id.hex[:8]}",
        slug=f"ds-route-other-{tenant_id.hex[:8]}",
        is_active=True,
    ))
    await db_session.flush()
    return tenant_id


@pytest_asyncio.fixture
async def client(db_session, route_tenant_id):
    _override_db(db_session)
    _override_auth(_make_auth(route_tenant_id))
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        fastapi_app.dependency_overrides.pop(get_auth_context, None)


@pytest_asyncio.fixture
async def unauth_client(db_session):
    """Client with the DB override but auth NOT overridden (401 expected)."""
    _override_db(db_session)
    fastapi_app.dependency_overrides.pop(get_auth_context, None)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test",
        ) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)


def _basic_csv_bytes(rows: int = 3) -> bytes:
    lines = ["recipient_id,name,age"]
    for i in range(rows):
        lines.append(f"r{i},person{i},{20 + i}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _create_payload(name: str | None = None) -> dict[str, Any]:
    return {
        "appId": APP_ID,
        "name": name or f"ds-{uuid.uuid4().hex[:8]}",
        "description": "test dataset",
    }


# ─── auth ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_requires_auth(unauth_client):
    r = await unauth_client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    # FastAPI HTTPBearer returns 403 when the header is missing entirely; the
    # important assertion is the route is auth-gated (not anon-accessible).
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_create_dataset_returns_201_and_response_shape(client):
    r = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    assert r.status_code == 201, r.text
    payload = r.json()
    assert "id" in payload
    assert payload["appId"] == APP_ID
    assert payload["name"].startswith("ds-")
    assert payload["latestVersion"] is None


# ─── tenant scoping ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tenant_scoping_returns_404_for_other_tenant(
    client, other_tenant_id,
):
    # Create dataset under tenant A.
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    assert create.status_code == 201, create.text
    dataset_id = create.json()["id"]

    # Switch the auth override to tenant B, GET should be 404 (NOT 403).
    _override_auth(_make_auth(other_tenant_id))

    g = await client.get(f"/api/orchestration/datasets/{dataset_id}")
    assert g.status_code == 404, g.text
    assert g.json()["detail"] == "dataset not found"

    # Listing as tenant B does NOT include tenant A's dataset.
    listing = await client.get(f"/api/orchestration/datasets?appId={APP_ID}")
    assert listing.status_code == 200, listing.text
    assert all(row["id"] != dataset_id for row in listing.json())


# ─── multipart upload ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_multipart_upload_uuid_strategy(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    csv_bytes = _basic_csv_bytes(3)
    files = {"file": ("rows.csv", csv_bytes, "text/csv")}
    data = {"id_strategy": "uuid"}
    r = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files,
        data=data,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["versionNumber"] == 1
    assert body["idStrategy"] == "uuid"
    assert body["idColumn"] is None
    assert body["rowCount"] == 3
    # schema_descriptor inferred and on the wire as schemaDescriptor.
    assert "schemaDescriptor" in body
    assert isinstance(body["schemaDescriptor"], dict)
    # sampleRows not requested -> empty list.
    assert body["sampleRows"] == []


@pytest.mark.asyncio
async def test_multipart_upload_column_strategy(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    csv_bytes = _basic_csv_bytes(2)
    files = {"file": ("rows.csv", csv_bytes, "text/csv")}
    data = {"id_strategy": "column", "id_column": "recipient_id"}
    r = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files,
        data=data,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["idStrategy"] == "column"
    assert body["idColumn"] == "recipient_id"


@pytest.mark.asyncio
async def test_multipart_upload_exceeds_row_cap_returns_400(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    # Build 20_001 rows via csv module — well under the 50 MB outer guard.
    buf = io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["recipient_id", "name"])
    for i in range(20_001):
        writer.writerow([f"r{i}", f"n{i}"])
    csv_bytes = buf.getvalue().encode("utf-8")

    files = {"file": ("big.csv", csv_bytes, "text/csv")}
    data = {"id_strategy": "uuid"}
    r = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files,
        data=data,
    )
    assert r.status_code == 400, r.text
    assert "row cap" in r.json()["detail"]


@pytest.mark.asyncio
async def test_multipart_upload_exceeds_50mb_returns_413(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    # 51 MB single-blob upload -> outer guard.
    big = b"x" * (51 * 1024 * 1024)
    files = {"file": ("huge.csv", big, "text/csv")}
    data = {"id_strategy": "uuid"}
    r = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files,
        data=data,
    )
    assert r.status_code == 413, r.text
    assert "50MB" in r.json()["detail"]


@pytest.mark.asyncio
async def test_reupload_increments_version_number(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    files = {"file": ("rows.csv", _basic_csv_bytes(2), "text/csv")}
    data = {"id_strategy": "uuid"}
    r1 = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files, data=data,
    )
    assert r1.status_code == 201, r1.text
    assert r1.json()["versionNumber"] == 1

    files2 = {"file": ("rows2.csv", _basic_csv_bytes(2), "text/csv")}
    r2 = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files2, data=data,
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["versionNumber"] == 2


# ─── list / get version ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_datasets_returns_latest_version_inlined(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    files = {"file": ("rows.csv", _basic_csv_bytes(3), "text/csv")}
    data = {"id_strategy": "uuid"}
    up = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files, data=data,
    )
    assert up.status_code == 201

    listing = await client.get(f"/api/orchestration/datasets?appId={APP_ID}")
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    match = next(r for r in rows if r["id"] == dataset_id)
    assert match["latestVersion"] is not None
    assert match["latestVersion"]["versionNumber"] == 1
    assert match["latestVersion"]["rowCount"] == 3


@pytest.mark.asyncio
async def test_get_version_with_sample_rows(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    files = {"file": ("rows.csv", _basic_csv_bytes(7), "text/csv")}
    data = {"id_strategy": "uuid"}
    up = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files, data=data,
    )
    version_id = up.json()["id"]

    g = await client.get(
        f"/api/orchestration/datasets/{dataset_id}/versions/{version_id}"
        f"?sampleRows=5",
    )
    assert g.status_code == 200, g.text
    payload = g.json()
    assert len(payload["sampleRows"]) == 5
    # Each sample row has recipient_id + payload.
    for r in payload["sampleRows"]:
        assert "recipientId" in r or "recipient_id" in r
        assert "payload" in r


@pytest.mark.asyncio
async def test_get_version_sample_rows_out_of_range(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    files = {"file": ("rows.csv", _basic_csv_bytes(2), "text/csv")}
    data = {"id_strategy": "uuid"}
    up = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files, data=data,
    )
    version_id = up.json()["id"]

    r = await client.get(
        f"/api/orchestration/datasets/{dataset_id}/versions/{version_id}"
        f"?sampleRows=999",
    )
    assert r.status_code == 400, r.text
    assert "sampleRows" in r.json()["detail"]


# ─── delete ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_dataset_no_bindings_returns_204(client):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]

    d = await client.delete(f"/api/orchestration/datasets/{dataset_id}")
    assert d.status_code == 204

    # Confirm gone.
    g = await client.get(f"/api/orchestration/datasets/{dataset_id}")
    assert g.status_code == 404


@pytest.mark.asyncio
async def test_delete_dataset_with_workflow_binding_returns_409(
    client, db_session, route_tenant_id,
):
    create = await client.post(
        "/api/orchestration/datasets", json=_create_payload(),
    )
    dataset_id = create.json()["id"]
    files = {"file": ("rows.csv", _basic_csv_bytes(2), "text/csv")}
    data = {"id_strategy": "uuid"}
    up = await client.post(
        f"/api/orchestration/datasets/{dataset_id}/versions",
        files=files, data=data,
    )
    version_id = up.json()["id"]

    # Seed a bound workflow + version pointing at the imported version_id.
    workflow_name = "Bound Test Workflow"
    workflow = Workflow(
        id=uuid.uuid4(),
        tenant_id=route_tenant_id,
        app_id=APP_ID,
        workflow_type="crm",
        slug=f"binding-{uuid.uuid4().hex[:8]}",
        name=workflow_name,
        created_by=SYSTEM_USER_ID,
    )
    db_session.add(workflow)
    await db_session.flush()
    wf_version = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=route_tenant_id,
        app_id=APP_ID,
        workflow_id=workflow.id,
        version=1,
        definition={
            "nodes": [
                {
                    "id": "src",
                    "type": "source.cohort_query",
                    "config": {"source_ref": f"dataset.{version_id}"},
                },
            ],
            "edges": [],
        },
        status="published",
    )
    db_session.add(wf_version)
    await db_session.flush()

    d = await client.delete(f"/api/orchestration/datasets/{dataset_id}")
    assert d.status_code == 409, d.text
    assert workflow_name in d.json()["detail"]
