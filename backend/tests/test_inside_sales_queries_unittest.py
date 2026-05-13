import uuid
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from app.models.source_records import CrmCallRecord, CrmLeadRecord  # noqa: E402
from app.services.inside_sales_dataset_resolver import InsideSalesCallFilters, InsideSalesLeadFilters  # noqa: E402
from app.services.inside_sales_queries import (  # noqa: E402
    INSIDE_SALES_STALE_AFTER,
    build_call_count_query,
    build_call_listing_query,
    build_lead_count_query,
    build_lead_listing_query,
    get_collection_freshness,
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
            agents=("Agent Amy", "Agent Bob"),
            lead_ids=("pros-1",),
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

    assert "analytics.crm_call_record.tenant_id =" in sql
    assert "analytics.crm_call_record.app_id =" in sql
    # No date_from / date_to clauses anymore — listing serves the full mirror.
    assert "call_started_at >=" not in sql
    assert "lower(analytics.crm_call_record.rep_name) IN ('agent amy', 'agent bob')" in sql
    assert "analytics.crm_call_record.lead_id ILIKE '%%pros-1%%'" in sql
    assert "analytics.crm_call_record.direction = 'inbound'" in sql
    assert "lower(analytics.crm_call_record.status) = 'answered'" in sql
    assert "analytics.crm_call_record.duration_seconds >= 30" in sql
    assert "analytics.crm_call_record.duration_seconds <= 600" in sql
    assert "analytics.crm_call_record.has_recording IS true" in sql
    assert "analytics.crm_call_record.event_code IN (21, 22)" in sql
    assert "ORDER BY coalesce(analytics.crm_call_record.call_started_at, analytics.crm_call_record.created_on) DESC" in sql
    assert " LIMIT 25 OFFSET 25" in sql


def test_build_call_count_query_wraps_filtered_call_scope_without_pagination():
    statement = build_call_count_query(
        tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        app_id="inside-sales",
        filters=InsideSalesCallFilters(status="Answered"),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "lower(analytics.crm_call_record.status) = 'answered'" in sql
    assert " LIMIT " not in sql
    assert " OFFSET " not in sql


def test_lead_listing_query_orders_by_created_on_desc():
    """Lead listing always orders newest-first by ``created_on``."""
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(),
        page=1,
        page_size=50,
    )
    sql = _compile(statement)
    assert "ORDER BY analytics.crm_lead_record.created_on DESC" in sql
    # No date_from / date_to clauses anymore.
    assert "analytics.crm_lead_record.created_on >=" not in sql


def test_build_lead_listing_query_applies_filters_against_raw_columns():
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(
            agents=("Agent Amy",),
            stage=("New Lead", "Call Back"),
            mql_min=3,
            condition=("diabetes", "pcos"),
            city=("mumbai", "pune"),
            lead_ids=("prospect-9",),
        ),
        page=1,
        page_size=50,
    )
    sql = _compile(statement)

    # Post-Phase-9: domain-field filters route through JSONB key access
    # on raw_payload (typed cols dropped). PII fields (city, lead_id) and
    # the numeric mql_min comparator are still SQL-shaped — just cast
    # through the JSONB path.
    assert "lower(analytics.crm_lead_record.raw_payload ->> 'rep_name') IN ('agent amy')" in sql
    assert "lower(analytics.crm_lead_record.raw_payload ->> 'prospect_stage') IN ('new lead', 'call back')" in sql
    assert "(analytics.crm_lead_record.raw_payload ->> 'condition') ILIKE '%%diabetes%%'" in sql
    assert "analytics.crm_lead_record.city ILIKE '%%mumbai%%'" in sql
    assert "analytics.crm_lead_record.lead_id ILIKE '%%prospect-9%%'" in sql
    assert "coalesce(CAST(nullif(analytics.crm_lead_record.raw_payload ->> 'mql_score', '') AS INTEGER), 0) >= 3" in sql
    assert "ORDER BY analytics.crm_lead_record.created_on DESC, analytics.crm_lead_record.lead_id DESC" in sql


def test_build_lead_query_applies_q_concat_ilike_across_name_and_phone():
    """`q` should ilike-match a concat of first_name, last_name, phone."""
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(q="  rohit  "),
        page=1,
        page_size=25,
    )
    sql = _compile(statement)

    assert "concat(" in sql
    assert "analytics.crm_lead_record.first_name" in sql
    assert "analytics.crm_lead_record.last_name" in sql
    assert "analytics.crm_lead_record.phone" in sql
    assert "ILIKE '%%rohit%%'" in sql


def test_build_lead_query_skips_q_when_whitespace_only():
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(q="   "),
        page=1,
        page_size=25,
    )
    sql = _compile(statement)

    assert "concat(" not in sql


def test_build_lead_query_lead_id_substring_match():
    """Leads filter should substring-match lead_id, aligning with Calls behavior."""
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(lead_ids=("abc123",)),
        page=1,
        page_size=25,
    )
    sql = _compile(statement)

    assert "analytics.crm_lead_record.lead_id ILIKE '%%abc123%%'" in sql
    assert "analytics.crm_lead_record.lead_id = 'abc123'" not in sql


def test_build_lead_count_query_wraps_filtered_lead_scope():
    statement = build_lead_count_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(mql_min=5),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "coalesce(CAST(nullif(analytics.crm_lead_record.raw_payload ->> 'mql_score', '') AS INTEGER), 0) >= 5" in sql


def test_map_call_listing_row_preserves_existing_api_shape_with_eval_overlay():
    call = CrmCallRecord(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        source_system="lsq",
        activity_id="activity-1",
        lead_id="prospect-1",
        event_code=21,
        direction="inbound",
        duration_seconds=180,
        has_recording=True,
    )
    call.rep_name = "Agent Amy"
    call.rep_email = "amy@example.com"
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
    # Post-Phase-9: domain fields live in raw_payload; map_lead_listing_row
    # reads them via the ``bag`` accessor. PII (first_name/last_name/phone)
    # + city stay as typed cols.
    lead = CrmLeadRecord(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        source_system="lsq",
        lead_id="prospect-1",
        first_name="Lead",
        last_name="One",
        phone="9999999999",
        created_on=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        raw_payload={
            "prospect_stage": "New Lead",
            "rep_name": "Agent Amy",
            "total_dials": 5,
            "mql_score": 4,
            "lead_age_days": 7,
            "connect_rate": 60.0,
            "frt_seconds": 240,
            "days_since_last_contact": 1,
            "mql_signals": {"age": True},
            "last_activity_on": "2026-04-07T09:00:00+00:00",
        },
    )

    payload = map_lead_listing_row(lead)

    assert payload["leadId"] == "prospect-1"
    assert payload["createdOn"] == "2026-04-01 09:00:00"
    # lastActivityOn comes from raw_payload as an ISO string post-Phase-9;
    # the response builder formats it for display.
    assert payload["lastActivityOn"] is not None
    assert payload["connectRate"] == 60.0
    assert payload["mqlScore"] == 4
    assert payload["repName"] == "Agent Amy"


class _FakeFreshnessSession:
    """Fake AsyncSession matching the 2-scalar pattern of `get_collection_freshness`.

    Call 1: latest successful `LogCrmSourceSync` (full row, via completed-filter query)
    Call 2: a running `LogCrmSourceSync.id` or None
    """

    def __init__(self, latest_successful, running_sync_id=None):
        self._calls = [latest_successful, running_sync_id]

    async def scalar(self, _statement):
        if not self._calls:
            return None
        return self._calls.pop(0)


class InsideSalesFreshnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_collection_freshness_marks_recent_completed_sync_as_fresh(self):
        completed_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        session = _FakeFreshnessSession(
            latest_successful=SimpleNamespace(completed_at=completed_at),
            running_sync_id=uuid.uuid4(),
        )

        freshness = await get_collection_freshness(
            session,
            tenant_id=uuid.uuid4(),
            app_id='inside-sales',
            source_family='calls',
        )

        assert freshness['lastSyncedAt'] == completed_at
        assert freshness['syncInProgress'] is True
        assert freshness['stale'] is False

    async def test_get_collection_freshness_marks_missing_or_old_sync_as_stale(self):
        completed_at = datetime.now(timezone.utc) - INSIDE_SALES_STALE_AFTER - timedelta(minutes=1)
        session = _FakeFreshnessSession(
            latest_successful=SimpleNamespace(completed_at=completed_at),
            running_sync_id=None,
        )

        freshness = await get_collection_freshness(
            session,
            tenant_id=uuid.uuid4(),
            app_id='inside-sales',
            source_family='leads',
        )

        assert freshness['lastSyncedAt'] == completed_at
        assert freshness['syncInProgress'] is False
        assert freshness['stale'] is True
