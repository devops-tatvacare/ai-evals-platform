"""Tests for the analytics side-effects on the inside-sales sync paths.

Roadmap 01 §8.1–§8.3 invariants exercised here as pure-function tests on
the row-builder helpers in ``inside_sales_sync.py``. The full DB-bound
upserts are exercised by the wider integration suite; here we verify
shape, ID propagation, and the activities-path event-code allowlist.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

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


def test_targeted_activities_sync_requires_window():
    """Activities path has no LSQ point-fetch — windowed paging is the
    only way to reach a single ProspectActivityId, so the validator
    rejects targeted activities syncs that omit the window."""
    with pytest.raises(ValueError, match="targeted activities sync requires"):
        parse_inside_sales_sync_request(
            {
                "app_id": "inside-sales",
                "source_family": "activities",
                "sync_mode": "targeted",
                "targeted_source_id": "ACT-99",
                "event_codes": "47",
            }
        )


def test_targeted_call_sync_filters_fact_side_effect_in_lockstep():
    """Bug guard: the calls-path analytics side-effect must mirror the
    SAME activities the Layer 1 mirror persisted. Targeted-mode calls
    sync filters Layer 1 to the requested ProspectActivityId; the
    fact_lead_activity write path must filter to the same set so a
    targeted run cannot leak rows for unrelated calls.
    """
    import asyncio

    from app.services import inside_sales_sync as sync_service

    tenant_id = uuid.uuid4()

    targeted_id = "ACT-MATCH"
    raw_target = {
        "ProspectActivityId": targeted_id,
        "RelatedProspectId": "PROS-1",
        "ActivityEvent": 22,
        "CreatedBy": "AGENT-1",
        "mx_Custom_2": "2026-04-29 09:00:00",
        "CreatedOn": "2026-04-29 09:01:00",
    }
    raw_unrelated_a = dict(raw_target, ProspectActivityId="ACT-OTHER-A")
    raw_unrelated_b = dict(raw_target, ProspectActivityId="ACT-OTHER-B")
    activities_page = [raw_unrelated_a, raw_target, raw_unrelated_b]

    seen_call_rows: list[list[dict]] = []
    seen_fact_rows: list[list[dict]] = []

    class _StubDb:
        async def execute(self, _stmt):
            return None

    async def _fake_upsert_call_source_rows(_db, rows):
        seen_call_rows.append(list(rows))
        return len(rows)

    async def _fake_upsert_lead_activity_rows(_db, *, rows):
        seen_fact_rows.append(list(rows))
        return len(rows)

    async def _fake_fetch_call_activities(**_kwargs):
        return {"activities": activities_page, "total": len(activities_page)}

    async def _noop_progress(*_args, **_kwargs):
        return None

    async def _not_cancelled(*_args, **_kwargs):
        return False

    request = sync_service.InsideSalesSyncRequest(
        app_id="inside-sales",
        source_family="calls",
        sync_mode="targeted",
        source_system="lsq",
        date_from="2026-04-29 00:00:00",
        date_to="2026-04-29 23:59:59",
        targeted_source_id=targeted_id,
        event_codes=(22,),
    )
    sync_run = SimpleNamespace(
        id=uuid.uuid4(), details={}, records_scanned=0, records_upserted=0, records_failed=0
    )

    from unittest.mock import patch

    with (
        patch.object(sync_service, "fetch_call_activities", _fake_fetch_call_activities),
        patch.object(sync_service, "upsert_call_source_rows", _fake_upsert_call_source_rows),
        patch.object(
            sync_service, "_upsert_lead_activity_rows", _fake_upsert_lead_activity_rows
        ),
        patch(
            "app.services.job_worker.is_job_cancelled", _not_cancelled
        ),
        patch(
            "app.services.job_worker.update_job_progress", _noop_progress
        ),
    ):
        asyncio.run(
            sync_service._sync_calls_family(
                _StubDb(),  # type: ignore[arg-type]
                job_id=None,
                sync_run=sync_run,  # type: ignore[arg-type]
                request=request,
                tenant_id=tenant_id,
                user_id=uuid.uuid4(),
                watermark_from="2026-04-29 00:00:00",
                watermark_to="2026-04-29 23:59:59",
            )
        )

    # Layer 1: only the targeted call is persisted.
    assert seen_call_rows
    flat_calls = [r for batch in seen_call_rows for r in batch]
    assert [r["activity_id"] for r in flat_calls] == [targeted_id]
    # Side-effect: only the targeted call's fact row is persisted.
    flat_facts = [r for batch in seen_fact_rows for r in batch]
    assert [r["source_activity_id"] for r in flat_facts] == [targeted_id]


def test_targeted_activities_sync_persists_only_matching_activity():
    """Bug guard: ``_sync_activities_family`` must honour
    ``targeted_source_id`` — a targeted activities sync may only persist
    the matching ProspectActivityId, not the full fetched window.
    """
    import asyncio

    from app.services import inside_sales_sync as sync_service

    tenant_id = uuid.uuid4()
    targeted_id = "ACT-PAGE-VISIT-MATCH"

    raw_target = {
        "ProspectActivityId": targeted_id,
        "RelatedProspectId": "PROS-9",
        "ActivityEvent": 47,
        "ActivityEvent_Name": "Page Visit",
        "CreatedBy": "agent-2",
        "CreatedOn": "2026-04-29 12:00:00",
    }
    raw_other = dict(raw_target, ProspectActivityId="ACT-OTHER")
    activities_page = [raw_other, raw_target]

    seen_fact_rows: list[list[dict]] = []

    class _StubDb:
        async def execute(self, _stmt):
            return None

    async def _fake_upsert_lead_activity_rows(_db, *, rows):
        seen_fact_rows.append(list(rows))
        return len(rows)

    async def _fake_fetch_call_activities(**_kwargs):
        return {"activities": activities_page, "total": len(activities_page)}

    async def _noop_progress(*_args, **_kwargs):
        return None

    async def _not_cancelled(*_args, **_kwargs):
        return False

    request = sync_service.InsideSalesSyncRequest(
        app_id="inside-sales",
        source_family="activities",
        sync_mode="targeted",
        source_system="lsq",
        date_from="2026-04-29 00:00:00",
        date_to="2026-04-29 23:59:59",
        targeted_source_id=targeted_id,
        event_codes=(47,),
    )
    sync_run = SimpleNamespace(
        id=uuid.uuid4(), details={}, records_scanned=0, records_upserted=0, records_failed=0
    )

    from unittest.mock import patch

    with (
        patch.object(sync_service, "fetch_call_activities", _fake_fetch_call_activities),
        patch.object(
            sync_service, "_upsert_lead_activity_rows", _fake_upsert_lead_activity_rows
        ),
        patch(
            "app.services.job_worker.is_job_cancelled", _not_cancelled
        ),
        patch(
            "app.services.job_worker.update_job_progress", _noop_progress
        ),
    ):
        asyncio.run(
            sync_service._sync_activities_family(
                _StubDb(),  # type: ignore[arg-type]
                job_id=None,
                sync_run=sync_run,  # type: ignore[arg-type]
                request=request,
                tenant_id=tenant_id,
                watermark_from="2026-04-29 00:00:00",
                watermark_to="2026-04-29 23:59:59",
            )
        )

    flat_facts = [r for batch in seen_fact_rows for r in batch]
    assert [r["source_activity_id"] for r in flat_facts] == [targeted_id]


def test_targeted_activities_sync_raises_when_id_not_in_window():
    """Targeted activities sync that pages through the window without
    finding the requested ProspectActivityId must raise — silently
    completing would mask a typo / wrong-window operator error."""
    import asyncio

    from app.services import inside_sales_sync as sync_service

    raw_other = {
        "ProspectActivityId": "ACT-OTHER",
        "RelatedProspectId": "PROS-9",
        "ActivityEvent": 47,
        "CreatedBy": "agent-2",
        "CreatedOn": "2026-04-29 12:00:00",
    }

    class _StubDb:
        async def execute(self, _stmt):
            return None

    async def _fake_upsert_lead_activity_rows(_db, *, rows):
        return len(rows)

    async def _fake_fetch_call_activities(**_kwargs):
        return {"activities": [raw_other], "total": 1}

    async def _noop_progress(*_args, **_kwargs):
        return None

    async def _not_cancelled(*_args, **_kwargs):
        return False

    request = sync_service.InsideSalesSyncRequest(
        app_id="inside-sales",
        source_family="activities",
        sync_mode="targeted",
        source_system="lsq",
        date_from="2026-04-29 00:00:00",
        date_to="2026-04-29 23:59:59",
        targeted_source_id="ACT-DOES-NOT-EXIST",
        event_codes=(47,),
    )
    sync_run = SimpleNamespace(
        id=uuid.uuid4(), details={}, records_scanned=0, records_upserted=0, records_failed=0
    )

    from unittest.mock import patch

    with (
        patch.object(sync_service, "fetch_call_activities", _fake_fetch_call_activities),
        patch.object(
            sync_service, "_upsert_lead_activity_rows", _fake_upsert_lead_activity_rows
        ),
        patch(
            "app.services.job_worker.is_job_cancelled", _not_cancelled
        ),
        patch(
            "app.services.job_worker.update_job_progress", _noop_progress
        ),
    ):
        with pytest.raises(ValueError, match="Activity not found for targeted_source_id"):
            asyncio.run(
                sync_service._sync_activities_family(
                    _StubDb(),  # type: ignore[arg-type]
                    job_id=None,
                    sync_run=sync_run,  # type: ignore[arg-type]
                    request=request,
                    tenant_id=uuid.uuid4(),
                    watermark_from="2026-04-29 00:00:00",
                    watermark_to="2026-04-29 23:59:59",
                )
            )
