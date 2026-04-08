import os
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.models.inside_sales_mirror import InsideSalesCallMirror, InsideSalesLeadMirror  # noqa: E402
from app.services.inside_sales_dataset_resolver import InsideSalesCallFilters, InsideSalesLeadFilters  # noqa: E402
from app.services.inside_sales_queries import (  # noqa: E402
    build_call_count_query,
    build_call_listing_query,
    build_lead_count_query,
    build_lead_listing_query,
    map_call_listing_row,
    map_lead_listing_row,
)


def _compile(statement) -> str:
    return str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def test_build_call_listing_query_applies_sql_filters_ordering_and_pagination():
    statement = build_call_listing_query(
        tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        app_id="inside-sales",
        filters=InsideSalesCallFilters(
            date_from="2026-04-01 00:00:00",
            date_to="2026-04-08 23:59:59",
            agents=("Agent Amy", "Agent Bob"),
            prospect_id="pros-1",
            direction="inbound",
            status="Answered",
            duration_min=30,
            duration_max=600,
            has_recording=True,
            event_codes=(21, 22),
        ),
        page=2,
        page_size=25,
        scope="page",
    )
    sql = _compile(statement)

    assert "inside_sales_calls.tenant_id =" in sql
    assert "inside_sales_calls.app_id =" in sql
    assert "coalesce(inside_sales_calls.call_started_at, inside_sales_calls.created_on) >=" in sql
    assert "inside_sales_calls.agent_name_normalized IN ('agent amy', 'agent bob')" in sql
    assert "inside_sales_calls.prospect_id ILIKE '%%pros-1%%'" in sql
    assert "inside_sales_calls.direction = 'inbound'" in sql
    assert "inside_sales_calls.status_normalized = 'answered'" in sql
    assert "inside_sales_calls.duration_seconds >= 30" in sql
    assert "inside_sales_calls.duration_seconds <= 600" in sql
    assert "inside_sales_calls.has_recording IS true" in sql
    assert "inside_sales_calls.event_code IN (21, 22)" in sql
    assert "ORDER BY coalesce(inside_sales_calls.call_started_at, inside_sales_calls.created_on) DESC" in sql
    assert " LIMIT 25 OFFSET 25" in sql


def test_build_call_count_query_wraps_filtered_call_scope_without_pagination():
    statement = build_call_count_query(
        tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        app_id="inside-sales",
        filters=InsideSalesCallFilters(
            date_from="2026-04-01 00:00:00",
            date_to="2026-04-08 23:59:59",
            status="Answered",
        ),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "status_normalized = 'answered'" in sql
    assert " LIMIT " not in sql
    assert " OFFSET " not in sql


def test_build_lead_listing_query_applies_filters_and_created_on_sort():
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(
            date_from="2026-04-01 00:00:00",
            date_to="2026-04-08 23:59:59",
            agents=("Agent Amy",),
            stage=("New Lead", "Call Back"),
            mql_min=3,
            condition=("diabetes", "pcos"),
            city=("mumbai", "pune"),
            prospect_id="prospect-9",
        ),
        page=1,
        page_size=50,
    )
    sql = _compile(statement)

    assert "inside_sales_leads.created_on >=" in sql
    assert "inside_sales_leads.agent_name_normalized IN ('agent amy')" in sql
    assert "inside_sales_leads.prospect_stage_normalized IN ('new lead', 'call back')" in sql
    assert "inside_sales_leads.condition_normalized ILIKE '%%diabetes%%'" in sql
    assert "inside_sales_leads.city_normalized ILIKE '%%mumbai%%'" in sql
    assert "inside_sales_leads.prospect_id = 'prospect-9'" in sql
    assert "inside_sales_leads.mql_score >= 3" in sql
    assert "ORDER BY inside_sales_leads.created_on DESC, inside_sales_leads.prospect_id DESC" in sql


def test_build_lead_count_query_wraps_filtered_lead_scope():
    statement = build_lead_count_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(
            date_from="2026-04-01 00:00:00",
            date_to="2026-04-08 23:59:59",
            mql_min=5,
        ),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "inside_sales_leads.mql_score >= 5" in sql


def test_map_call_listing_row_preserves_existing_api_shape_with_eval_overlay():
    call = InsideSalesCallMirror(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        source_system="lsq",
        activity_id="activity-1",
        prospect_id="prospect-1",
        event_code=21,
        direction="inbound",
        duration_seconds=180,
        has_recording=True,
    )
    call.agent_name = "Agent Amy"
    call.agent_email = "amy@example.com"
    call.status = "Answered"
    call.recording_url = "https://example.com/recording.mp3"
    call.phone_number = "9999999999"
    call.display_number = "Lead Amy"
    call.call_notes = "Interested"
    call.call_session_id = "session-1"
    call.call_started_at = datetime(2026, 4, 8, 9, 0, tzinfo=timezone.utc)
    call.created_on = datetime(2026, 4, 8, 9, 5, tzinfo=timezone.utc)

    payload = map_call_listing_row(
        call,
        eval_count=2,
        eval_result={"evaluations": [{"output": {"overall_score": 84}}]},
    )

    assert payload["activityId"] == "activity-1"
    assert payload["callStartTime"] == "2026-04-08 09:00:00"
    assert payload["lastEvalScore"] == 84
    assert payload["evalCount"] == 2


def test_map_lead_listing_row_preserves_existing_api_shape():
    lead = InsideSalesLeadMirror(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        source_system="lsq",
        prospect_id="prospect-1",
        prospect_stage="New Lead",
        total_dials=5,
        mql_score=4,
        lead_age_days=7,
    )
    lead.first_name = "Lead"
    lead.last_name = "One"
    lead.phone = "9999999999"
    lead.agent_name = "Agent Amy"
    lead.connect_rate = 60.0
    lead.frt_seconds = 240
    lead.days_since_last_contact = 1
    lead.mql_signals = {"age": True}
    lead.created_on = datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc)
    lead.last_activity_on = datetime(2026, 4, 7, 9, 0, tzinfo=timezone.utc)

    payload = map_lead_listing_row(lead)

    assert payload["prospectId"] == "prospect-1"
    assert payload["createdOn"] == "2026-04-01 09:00:00"
    assert payload["lastActivityOn"] == "2026-04-07 09:00:00"
    assert payload["connectRate"] == 60.0
