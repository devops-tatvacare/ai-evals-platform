"""Inside Sales source-record schema coverage."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.models import Base
from app.models.source_records import (
    SourceCallRecord,
    SourceLeadRecord,
    SourceSyncRun,
)
from app.schemas.source_records import (
    SourceCallRecordRow,
    SourceLeadRecordRow,
    SourceSyncRunResponse,
)


def test_source_record_tables_are_registered_with_expected_indexes():
    assert "source_call_records" in Base.metadata.tables
    assert "source_lead_records" in Base.metadata.tables
    assert "source_sync_runs" in Base.metadata.tables

    call_constraints = {constraint.name for constraint in SourceCallRecord.__table__.constraints}
    lead_constraints = {constraint.name for constraint in SourceLeadRecord.__table__.constraints}

    assert "uq_source_call_records_tenant_app_activity" in call_constraints
    assert "uq_source_lead_records_tenant_app_prospect" in lead_constraints

    call_indexes = {index.name for index in SourceCallRecord.__table__.indexes}
    lead_indexes = {index.name for index in SourceLeadRecord.__table__.indexes}
    sync_indexes = {index.name for index in SourceSyncRun.__table__.indexes}

    assert "idx_source_call_records_tenant_app_call_started" in call_indexes
    assert "idx_source_call_records_tenant_app_status" in call_indexes
    assert "idx_source_lead_records_tenant_app_stage" in lead_indexes
    assert "idx_source_lead_records_tenant_app_mql" in lead_indexes
    assert "idx_source_sync_runs_tenant_family_status" in sync_indexes


def test_call_source_row_schema_exposes_camel_case_fields():
    now = datetime.now(timezone.utc)
    row = SourceCallRecordRow.model_validate(
        SimpleNamespace(
            id=uuid4(),
            tenant_id=uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            source_record_hash="abc123",
            first_synced_at=now,
            last_synced_at=now,
            last_seen_in_source_at=now,
            last_synced_by_user_id=uuid4(),
            raw_payload={"ActivityEvent": 21},
            created_at=now,
            updated_at=now,
            activity_id="activity-1",
            prospect_id="prospect-1",
            agent_id="agent-1",
            agent_name="Agent Amy",
            agent_name_normalized="agent amy",
            agent_email="amy@example.com",
            event_code=21,
            direction="inbound",
            status="Answered",
            status_normalized="answered",
            call_started_at=now,
            duration_seconds=180,
            has_recording=True,
            recording_url="https://example.com/recording.mp3",
            phone_number="9999999999",
            display_number="Lead Amy",
            call_notes="Strong lead intent",
            call_session_id="session-1",
            created_on=now,
        )
    )

    dumped = row.model_dump(by_alias=True)

    assert dumped["activityId"] == "activity-1"
    assert dumped["agentNameNormalized"] == "agent amy"
    assert dumped["hasRecording"] is True


def test_lead_source_row_schema_keeps_derived_metrics_typed():
    now = datetime.now(timezone.utc)
    row = SourceLeadRecordRow.model_validate(
        SimpleNamespace(
            id=uuid4(),
            tenant_id=uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            source_record_hash="hash-1",
            first_synced_at=now,
            last_synced_at=now,
            last_seen_in_source_at=now,
            last_synced_by_user_id=None,
            raw_payload={"ProspectID": "prospect-1"},
            created_at=now,
            updated_at=now,
            prospect_id="prospect-1",
            first_name="Lead",
            last_name="One",
            phone="9999999999",
            email="lead@example.com",
            prospect_stage="New Lead",
            prospect_stage_normalized="new lead",
            city="Mumbai",
            city_normalized="mumbai",
            age_group="31-40",
            condition="Diabetes",
            condition_normalized="diabetes",
            hba1c_band="6.5",
            intent_to_pay="Yes",
            agent_name="Agent Amy",
            agent_name_normalized="agent amy",
            source="Campaign",
            source_campaign="Summer",
            created_on=now,
            first_activity_on=now,
            last_activity_on=now,
            rnr_count=2,
            answered_count=3,
            total_dials=5,
            connect_rate=Decimal("60.00"),
            frt_seconds=240,
            lead_age_days=7,
            days_since_last_contact=1,
            mql_score=4,
            mql_signals={"age": True, "city": True, "condition": True, "hba1c": True, "intent": False},
        )
    )

    dumped = row.model_dump(by_alias=True)

    assert dumped["prospectId"] == "prospect-1"
    assert row.connect_rate == 60.0
    assert dumped["mqlSignals"]["city"] is True


def test_sync_run_schema_tracks_watermarks_and_counts():
    now = datetime.now(timezone.utc)
    row = SourceSyncRunResponse.model_validate(
        SimpleNamespace(
            id=uuid4(),
            tenant_id=uuid4(),
            app_id="inside-sales",
            source_system="lsq",
            source_family="calls",
            sync_mode="incremental",
            status="completed",
            requested_by_user_id=uuid4(),
            targeted_source_id=None,
            watermark_from="2026-04-01T00:00:00Z",
            watermark_to="2026-04-02T00:00:00Z",
            records_scanned=120,
            records_upserted=118,
            records_failed=2,
            started_at=now,
            completed_at=now,
            error_message=None,
            details={"cursor": "2026-04-02T00:00:00Z"},
            created_at=now,
            updated_at=now,
        )
    )

    dumped = row.model_dump(by_alias=True)

    assert dumped["sourceFamily"] == "calls"
    assert dumped["syncMode"] == "incremental"
    assert dumped["recordsUpserted"] == 118
