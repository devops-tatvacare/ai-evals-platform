"""Phase 14 / Phase E — structured publish-error contract.

The FE renders 400 (DefinitionValidationError) and 422
(DispatchRequiredFieldsError) through the same ``PublishErrorPanel``.
That works because both raise with ``errors: list[{node_id, field,
message}]`` and the route maps both onto an array ``detail``. These
tests pin down the contract so a future refactor cannot silently drop
the structured shape and drag the FE back to ``[object Object]``.
"""
from __future__ import annotations

import pytest

from app.services.orchestration.definition_validator import (
    DefinitionValidationError,
    validate_definition,
)


def _wf(nodes, edges):
    return {"nodes": nodes, "edges": edges}


def test_definition_validation_error_carries_structured_errors_list():
    """Internal contract: every item is ``{node_id, field, message}``.
    Bullet-list ``str(exc)`` keeps the legacy log-friendly format."""
    exc = DefinitionValidationError(
        [
            {"node_id": "n1", "field": "config", "message": "config invalid: foo"},
            {"node_id": None, "field": None, "message": "workflow has no ingress (source.*) node"},
        ]
    )
    assert isinstance(exc.errors, list)
    assert exc.errors[0] == {
        "node_id": "n1",
        "field": "config",
        "message": "config invalid: foo",
    }
    assert "config invalid: foo" in str(exc)


def test_definition_validation_error_accepts_legacy_string_list():
    """Pre-Phase-E callers that built the exception with a list of
    strings still work — every string is lifted to an unkeyed
    ``{node_id: None, field: None, message: ...}`` dict."""
    exc = DefinitionValidationError(["edge 'e1' source 'ghost' not in nodes"])
    assert exc.errors[0]["message"] == "edge 'e1' source 'ghost' not in nodes"
    assert exc.errors[0]["node_id"] is None
    assert exc.errors[0]["field"] is None


def test_validate_definition_emits_node_id_for_config_failure():
    """A bad node config produces an issue keyed on the offending
    node id so the FE can decorate the corresponding canvas card."""
    bad = {
        "id": "split1",
        "type": "logic.split",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {
            "mode": "by_field",
            "field": "plan",
            "branches": [
                # Two branches with the same id — validates after Pydantic accepts them.
                {"id": "gold", "label": "Gold", "match": "gold"},
                {"id": "gold", "label": "Gold dup", "match": "silver"},
            ],
        },
    }
    sink = {
        "id": "done",
        "type": "sink.complete",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {},
    }
    src = {
        "id": "src",
        "type": "source.cohort_query",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"source_ref": "platform.lead_record", "payload_fields": []},
    }
    defn = _wf(
        [src, bad, sink],
        [
            {"id": "e1", "source": "src", "target": "split1", "output_id": "default"},
            {"id": "e2", "source": "split1", "target": "done", "output_id": "gold"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    items = exc_info.value.errors
    config_issue = next(
        (it for it in items if it.get("node_id") == "split1" and it.get("field") == "config"),
        None,
    )
    assert config_issue is not None, items
    assert "config" in (config_issue.get("message") or "").lower() or "branch" in (
        config_issue.get("message") or ""
    ).lower()


def test_validate_definition_emits_field_for_edge_failure():
    """A duplicate edge id produces a field path so the FE can route the
    error to the edge surface even when it isn't keyed to a node."""
    src = {
        "id": "src",
        "type": "source.cohort_query",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {"source_ref": "platform.lead_record", "payload_fields": []},
    }
    sink = {
        "id": "done",
        "type": "sink.complete",
        "position": {"x": 0, "y": 0},
        "data": {},
        "config": {},
    }
    defn = _wf(
        [src, sink],
        [
            {"id": "dup", "source": "src", "target": "done", "output_id": "default"},
            {"id": "dup", "source": "src", "target": "done", "output_id": "default"},
        ],
    )
    with pytest.raises(DefinitionValidationError) as exc_info:
        validate_definition(defn, workflow_type="crm")
    items = exc_info.value.errors
    dup = next(
        (it for it in items if "duplicate edge" in (it.get("message") or "").lower()),
        None,
    )
    assert dup is not None, items
    assert dup.get("field", "").startswith("edges["), dup


def test_version_publish_error_carries_errors_list():
    """The publish-path wrapper exception preserves the structured list
    so the route handler can turn it into an array-shaped 400 ``detail``."""
    from app.services.orchestration.api.versions import VersionPublishError

    exc = VersionPublishError(
        "boom",
        errors=[{"node_id": "n1", "field": "config.template_name", "message": "missing"}],
    )
    assert exc.errors == [
        {"node_id": "n1", "field": "config.template_name", "message": "missing"}
    ]
    assert str(exc) == "boom"


def test_version_publish_error_defaults_to_empty_list():
    """Bare freeform-message construction still works for legacy call
    sites and yields an empty ``errors`` list (route falls back to
    string ``detail``)."""
    from app.services.orchestration.api.versions import VersionPublishError

    exc = VersionPublishError("legacy bare-string failure")
    assert exc.errors == []
    assert "legacy" in str(exc)
