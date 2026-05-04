"""Phase 13 / B.3 — publish blocks when dispatch nodes lack UI-supplied fields.

Direct unit tests against ``validate_dispatch_required_fields`` plus an
integration test through ``publish_version`` to confirm the
``DispatchRequiredFieldsError`` round-trips through the version service.
The route-level HTTP 422 mapping is exercised in routes test files.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.orchestration import Workflow, WorkflowVersion
from app.services.orchestration.api.versions import (
    DispatchRequiredFieldsError,
    publish_version,
)
from app.services.orchestration.definition_validator import (
    validate_dispatch_required_fields,
)


# ─── Pure validator ────────────────────────────────────────────────────


def _bolna_node(*, node_id: str, **config_overrides) -> dict:
    config = {
        "connection_id": str(uuid.uuid4()),
        "agent_id": "agent-confirm-1",
        "template_slug": "concierge_confirmation",
    }
    config.update(config_overrides)
    return {
        "id": node_id,
        "type": "crm.place_bolna_call",
        "config": config,
    }


def test_validator_passes_when_all_required_fields_present():
    definition = {"nodes": [_bolna_node(node_id="bn-1")], "edges": []}
    assert validate_dispatch_required_fields(definition) == []


def test_validator_flags_missing_connection_id():
    definition = {
        "nodes": [_bolna_node(node_id="bn-1", connection_id=None)],
        "edges": [],
    }
    errors = validate_dispatch_required_fields(definition)
    assert len(errors) == 1
    assert errors[0]["node_id"] == "bn-1"
    assert errors[0]["field"] == "connection_id"


def test_validator_flags_missing_agent_id():
    definition = {
        "nodes": [_bolna_node(node_id="bn-1", agent_id="")],
        "edges": [],
    }
    errors = validate_dispatch_required_fields(definition)
    assert len(errors) == 1
    assert errors[0]["field"] == "agent_id"


def test_validator_flags_blank_agent_id_with_whitespace():
    """A whitespace-only string must not pass — operators copy/pasting from
    a spreadsheet sometimes leave a trailing space; we treat it as blank."""
    definition = {
        "nodes": [_bolna_node(node_id="bn-1", agent_id="   ")],
        "edges": [],
    }
    errors = validate_dispatch_required_fields(definition)
    assert [e["field"] for e in errors] == ["agent_id"]


def test_validator_aggregates_errors_across_nodes():
    definition = {
        "nodes": [
            _bolna_node(node_id="bn-1", agent_id=""),
            _bolna_node(node_id="bn-2", connection_id=None, agent_id=""),
        ],
        "edges": [],
    }
    errors = validate_dispatch_required_fields(definition)
    assert {(e["node_id"], e["field"]) for e in errors} == {
        ("bn-1", "agent_id"),
        ("bn-2", "connection_id"),
        ("bn-2", "agent_id"),
    }


def test_validator_ignores_non_dispatch_nodes():
    definition = {
        "nodes": [
            {"id": "src-1", "type": "source.cohort_query", "config": {}},
            {"id": "snk-1", "type": "sink.complete", "config": {}},
        ],
        "edges": [],
    }
    assert validate_dispatch_required_fields(definition) == []


# ─── Integration: publish_version raises ───────────────────────────────


@pytest.mark.asyncio
async def test_publish_raises_when_bolna_node_missing_agent_id(
    db_session, seed_full_run,
):
    """A draft version that points at a Bolna node with a blank agent_id
    must fail to publish — even when the regular structural validator
    would otherwise accept the graph."""
    run, version, workflow, _step, tenant_id, _app_id = seed_full_run
    # Reuse the existing workflow but add a fresh draft version that
    # carries a Bolna node without agent_id.
    bolna_node = _bolna_node(node_id="bn-fail", agent_id="")
    draft = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=workflow.app_id,
        workflow_id=workflow.id,
        version=version.version + 1,
        definition={
            "nodes": [
                {
                    "id": "src",
                    "type": "source.event_trigger",
                    "config": {"event_name": "lead.created"},
                },
                bolna_node,
                {"id": "snk", "type": "sink.complete", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "src", "target": "bn-fail",
                 "output_id": "default"},
                {"id": "e2", "source": "bn-fail", "target": "snk",
                 "output_id": "success"},
                {"id": "e3", "source": "bn-fail", "target": "snk",
                 "output_id": "exhausted"},
            ],
            "canvas": {},
        },
        status="draft",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(draft)
    await db_session.flush()

    with pytest.raises(DispatchRequiredFieldsError) as excinfo:
        await publish_version(
            db_session,
            tenant_id=tenant_id,
            workflow_id=workflow.id,
            version_id=draft.id,
            published_by=workflow.created_by,
        )

    fields = {e["field"] for e in excinfo.value.errors}
    assert "agent_id" in fields
    # The version stays a draft because publish raised before the row update.
    refreshed = await db_session.scalar(
        select(WorkflowVersion).where(WorkflowVersion.id == draft.id)
    )
    assert refreshed is not None
    assert refreshed.status == "draft"


@pytest.mark.asyncio
async def test_publish_succeeds_when_required_fields_present(
    db_session, seed_full_run,
):
    """Sanity check the gate doesn't false-positive."""
    run, version, workflow, _step, tenant_id, _app_id = seed_full_run
    bolna_node = _bolna_node(node_id="bn-ok")
    draft = WorkflowVersion(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=workflow.app_id,
        workflow_id=workflow.id,
        version=version.version + 1,
        definition={
            "nodes": [
                {
                    "id": "src",
                    "type": "source.event_trigger",
                    "config": {"event_name": "lead.created"},
                },
                bolna_node,
                {"id": "snk", "type": "sink.complete", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "src", "target": "bn-ok",
                 "output_id": "default"},
                {"id": "e2", "source": "bn-ok", "target": "snk",
                 "output_id": "success"},
                {"id": "e3", "source": "bn-ok", "target": "snk",
                 "output_id": "exhausted"},
            ],
            "canvas": {},
        },
        status="draft",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(draft)
    await db_session.flush()

    published = await publish_version(
        db_session,
        tenant_id=tenant_id,
        workflow_id=workflow.id,
        version_id=draft.id,
        published_by=workflow.created_by,
    )
    assert published is not None
    assert published.status == "published"
    # Workflow now points at the new version.
    refreshed_wf = await db_session.scalar(
        select(Workflow).where(Workflow.id == workflow.id)
    )
    assert refreshed_wf is not None
    assert refreshed_wf.current_published_version_id == draft.id
