"""Pydantic schema validation for orchestration request/response models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.orchestration import (
    OverrideRequest,
    TriggerCreateRequest,
    WorkflowCreateRequest,
    WorkflowVersionCreateRequest,
)


def test_workflow_create_requires_workflow_type():
    with pytest.raises(ValidationError):
        WorkflowCreateRequest(slug="x", name="X", appId="a")  # type: ignore[call-arg]


def test_workflow_create_rejects_unknown_type():
    with pytest.raises(ValidationError):
        WorkflowCreateRequest(slug="x", name="X", appId="a", workflowType="unknown")  # type: ignore[arg-type]


def test_trigger_cron_requires_expression():
    with pytest.raises(ValidationError):
        TriggerCreateRequest(kind="cron")


def test_trigger_event_requires_event_name():
    with pytest.raises(ValidationError):
        TriggerCreateRequest(kind="event")


def test_trigger_manual_no_extras_required():
    t = TriggerCreateRequest(kind="manual")
    assert t.kind == "manual"


def test_override_jump_requires_target_node():
    with pytest.raises(ValidationError):
        OverrideRequest(action="jump_to_node")


def test_override_pause_no_target_required():
    o = OverrideRequest(action="pause", reason="manual review")
    assert o.action == "pause"


def test_workflow_version_create_validates_definition_shape():
    with pytest.raises(ValidationError):
        WorkflowVersionCreateRequest(definition={"foo": "bar"})  # type: ignore[arg-type]
