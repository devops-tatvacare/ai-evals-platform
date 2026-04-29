"""Tests for the analytics side-effects on the inside-sales sync paths.

Roadmap 01 §8.1–§8.3 invariants exercised here as pure-function tests on
the row-builder helpers in ``inside_sales_sync.py``. The full DB-bound
upserts are exercised by the wider integration suite; here we verify
shape, ID propagation, and the activities-path event-code allowlist.
"""
from __future__ import annotations

import uuid

import pytest

from app.services.inside_sales_sync import (
    _activity_subtype_for_event_code,
    build_call_activity_fact_row,
    build_generic_activity_fact_row,
    parse_inside_sales_sync_request,
)


def test_activity_subtype_maps_lsq_call_codes():
    assert _activity_subtype_for_event_code(21) == "inbound_call"
    assert _activity_subtype_for_event_code(22) == "outbound_call"
    assert _activity_subtype_for_event_code(99) is None
    assert _activity_subtype_for_event_code(None) is None


def test_build_call_activity_fact_row_shape():
    tenant_id = uuid.uuid4()
    sync_run_id = uuid.uuid4()
    raw = {
        "ProspectActivityId": "ACT-1",
        "RelatedProspectId": "PROS-1",
        "CreatedBy": "AGENT-7",
        "CreatedByName": "Asha",
        "CreatedByEmailAddress": "asha@tatva.com",
        "ActivityEvent": 22,  # outbound
        "Status": "completed",
        "mx_Custom_2": "2026-04-29 10:30:00",
        "mx_Custom_3": "180",
        "mx_Custom_4": "https://example/recording.mp3",
        "mx_Custom_1": "+91...",
        "ActivityEvent_Note": "",
        "CreatedOn": "2026-04-29 10:31:00",
    }
    row = build_call_activity_fact_row(
        raw, tenant_id=tenant_id, app_id="inside-sales", sync_run_id=sync_run_id
    )
    assert row is not None
    assert row["tenant_id"] == tenant_id
    assert row["app_id"] == "inside-sales"
    assert row["lead_id"] == "PROS-1"
    assert row["source_activity_id"] == "ACT-1"
    assert row["activity_type"] == "call"
    assert row["activity_subtype"] == "outbound_call"
    assert row["source_event_code"] == 22
    assert row["actor_type"] == "agent"
    assert row["actor_id"] == "AGENT-7"
    assert row["sync_run_id"] == sync_run_id
    # Attributes carry call-specific fields without the agent-id duplicate.
    assert row["attributes"]["status"] == "completed"
    assert row["attributes"]["recording_url"] == "https://example/recording.mp3"


def test_build_call_activity_skips_when_missing_ids():
    assert (
        build_call_activity_fact_row(
            {"ProspectActivityId": "", "RelatedProspectId": "P-1"},
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            sync_run_id=None,
        )
        is None
    )
    assert (
        build_call_activity_fact_row(
            {"ProspectActivityId": "A-1", "RelatedProspectId": ""},
            tenant_id=uuid.uuid4(),
            app_id="inside-sales",
            sync_run_id=None,
        )
        is None
    )


def test_build_generic_activity_fact_row_shape():
    raw = {
        "ProspectActivityId": "ACT-Z",
        "RelatedProspectId": "PROS-Z",
        "ActivityEvent": 47,
        "ActivityEvent_Name": "Page Visit",
        "CreatedBy": "agent-3",
        "CreatedOn": "2026-04-29 12:00:00",
    }
    row = build_generic_activity_fact_row(
        raw, tenant_id=uuid.uuid4(), app_id="inside-sales", sync_run_id=None
    )
    assert row is not None
    assert row["activity_type"] == "custom"
    assert row["activity_subtype"] == "Page Visit"
    assert row["source_event_code"] == 47
    assert row["actor_type"] == "agent"
    assert row["attributes"]["activity_event_name"] == "Page Visit"


def test_activities_source_family_accepted_by_validator():
    req = parse_inside_sales_sync_request(
        {
            "app_id": "inside-sales",
            "source_family": "activities",
            "sync_mode": "incremental",
        }
    )
    assert req.source_family == "activities"


def test_invalid_source_family_rejected():
    with pytest.raises(ValueError, match="source_family must be one of"):
        parse_inside_sales_sync_request(
            {"app_id": "inside-sales", "source_family": "garbage"}
        )
