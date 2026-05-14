import uuid
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from app.models.analytics_lead_facts import DimLead, FactLeadActivity  # noqa: E402
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
    # Phase 11E: calls listing reads analytics.fact_lead_activity
    # (activity_type='call'). Structural filters hit typed columns; the
    # call-specific payload filters route through the attributes JSONB.
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

    assert "FROM analytics.fact_lead_activity" in sql
    assert "analytics.fact_lead_activity.tenant_id =" in sql
    assert "analytics.fact_lead_activity.app_id =" in sql
    assert "analytics.fact_lead_activity.activity_type = 'call'" in sql
    assert "lower(analytics.fact_lead_activity.actor_label) IN ('agent amy', 'agent bob')" in sql
    assert "analytics.fact_lead_activity.lead_id ILIKE '%%pros-1%%'" in sql
    assert "(analytics.fact_lead_activity.attributes ->> 'direction') = 'inbound'" in sql
    assert "lower(analytics.fact_lead_activity.attributes ->> 'status') = 'answered'" in sql
    assert "CAST(nullif(analytics.fact_lead_activity.attributes ->> 'duration_seconds', '') AS INTEGER) >= 30" in sql
    assert "CAST(nullif(analytics.fact_lead_activity.attributes ->> 'duration_seconds', '') AS INTEGER) <= 600" in sql
    assert "(analytics.fact_lead_activity.attributes ->> 'has_recording') = 'true'" in sql
    assert "analytics.fact_lead_activity.source_event_code IN (21, 22)" in sql
    assert (
        "ORDER BY analytics.fact_lead_activity.occurred_at DESC NULLS LAST, "
        "analytics.fact_lead_activity.source_activity_id DESC" in sql
    )
    assert " LIMIT 25 OFFSET 25" in sql


def test_build_call_count_query_wraps_filtered_call_scope_without_pagination():
    statement = build_call_count_query(
        tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        app_id="inside-sales",
        filters=InsideSalesCallFilters(status="Answered"),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "FROM analytics.fact_lead_activity" in sql
    assert "lower(analytics.fact_lead_activity.attributes ->> 'status') = 'answered'" in sql
    assert " LIMIT " not in sql
    assert " OFFSET " not in sql


def test_lead_listing_query_orders_by_created_on_desc():
    """Lead listing reads analytics.dim_lead, ordered newest-first by
    ``lsq_created_on`` with ``lead_id`` as a stable tiebreak."""
    statement = build_lead_listing_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(),
        page=1,
        page_size=50,
    )
    sql = _compile(statement)
    assert "FROM analytics.dim_lead" in sql
    assert (
        "ORDER BY analytics.dim_lead.lsq_created_on DESC NULLS LAST, "
        "analytics.dim_lead.lead_id DESC" in sql
    )


def test_build_lead_listing_query_applies_filters_against_dim_columns():
    # Phase 11E: leads listing reads analytics.dim_lead. Identity + current
    # state come off typed columns; lead-profile fields route through the
    # attributes_at_first_seen JSONB; the mql_min threshold filters via a
    # fact_lead_signal subquery.
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

    assert "lower(analytics.dim_lead.assigned_rep_label) IN ('agent amy')" in sql
    assert "lower(analytics.dim_lead.latest_stage_observed) IN ('new lead', 'call back')" in sql
    assert "(analytics.dim_lead.attributes_at_first_seen ->> 'condition') ILIKE '%%diabetes%%'" in sql
    assert "(analytics.dim_lead.attributes_at_first_seen ->> 'condition') ILIKE '%%pcos%%'" in sql
    assert "analytics.dim_lead.city ILIKE '%%mumbai%%'" in sql
    assert "analytics.dim_lead.lead_id ILIKE '%%prospect-9%%'" in sql
    assert "analytics.dim_lead.lead_id IN (SELECT analytics.fact_lead_signal.lead_id" in sql
    assert "analytics.fact_lead_signal.signal_type = 'mql_score'" in sql
    assert "analytics.fact_lead_signal.signal_value_numeric >= 3" in sql
    assert (
        "ORDER BY analytics.dim_lead.lsq_created_on DESC NULLS LAST, "
        "analytics.dim_lead.lead_id DESC" in sql
    )


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
    assert "analytics.dim_lead.first_name" in sql
    assert "analytics.dim_lead.last_name" in sql
    assert "analytics.dim_lead.phone" in sql
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

    assert "analytics.dim_lead.lead_id ILIKE '%%abc123%%'" in sql
    assert "analytics.dim_lead.lead_id = 'abc123'" not in sql


def test_build_lead_count_query_wraps_filtered_lead_scope():
    statement = build_lead_count_query(
        tenant_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        app_id="inside-sales",
        filters=InsideSalesLeadFilters(mql_min=5),
    )
    sql = _compile(statement)

    assert "SELECT count(*) AS count_1" in sql
    assert "FROM analytics.dim_lead" in sql
    assert "analytics.dim_lead.lead_id IN (SELECT analytics.fact_lead_signal.lead_id" in sql
    assert "analytics.fact_lead_signal.signal_value_numeric >= 5" in sql


def test_map_call_listing_row_emits_structural_columns_plus_attributes_bag():
    # Phase 11E: map_call_listing_row projects a fact_lead_activity row into
    # the manifest {structural columns + attributes JSONB} shape. Typed
    # structural columns at the top level; the call-specific payload stays
    # in the `attributes` bag (no flattening into bespoke named fields).
    call = FactLeadActivity(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        lead_id="prospect-1",
        source_activity_id="activity-1",
        activity_type="call",
        source_event_code=21,
        occurred_at=datetime(2026, 4, 8, 9, 0, tzinfo=timezone.utc),
        actor_label="Agent Amy",
        attributes={
            "rep_email": "amy@example.com",
            "status": "Answered",
            "direction": "inbound",
            "duration_seconds": 180,
            "has_recording": "true",
            "recording_url": "https://example.com/recording.mp3",
            "phone_number": "9999999999",
            "display_number": "Lead Amy",
            "call_notes": "Interested",
            "call_session_id": "session-1",
        },
        created_at=datetime(2026, 4, 8, 9, 5, tzinfo=timezone.utc),
    )

    payload = map_call_listing_row(
        call,
        eval_count=2,
        eval_result={"evaluations": [{"output": {"overall_score": 84}}]},
    )

    # Structural columns.
    assert payload["activityId"] == "activity-1"
    assert payload["leadId"] == "prospect-1"
    assert payload["repName"] == "Agent Amy"
    assert payload["eventCode"] == 21
    assert payload["activityType"] == "call"
    assert payload["callStartTime"] == "2026-04-08 09:00:00"
    assert payload["lastEvalScore"] == 84
    assert payload["evalCount"] == 2
    # Call-specific payload stays in the attributes bag, verbatim.
    assert payload["attributes"]["direction"] == "inbound"
    assert payload["attributes"]["status"] == "Answered"
    assert payload["attributes"]["duration_seconds"] == 180
    assert payload["attributes"]["phone_number"] == "9999999999"
    # No bespoke flattened fields.
    assert "direction" not in payload
    assert "durationSeconds" not in payload


def test_map_lead_listing_row_emits_structural_columns_plus_attributes_bags():
    # Phase 11E: map_lead_listing_row projects a dim_lead row into the
    # manifest {structural columns + attributes JSONB} shape. Identity +
    # current-state are typed structural columns; the frozen lead-profile
    # snapshot is the attributesAtFirstSeen bag; the mutable current-state
    # bag is attributes; MQL is passed in via the ``mql`` arg.
    lead = DimLead(
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        lead_id="prospect-1",
        source="lsq",
        first_name="Lead",
        last_name="One",
        phone="9999999999",
        email="lead.one@example.com",
        city="Mumbai",
        latest_stage_observed="New Lead",
        assigned_rep_label="Agent Amy",
        lsq_created_on=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        first_seen_at=datetime(2026, 4, 1, 9, 0, tzinfo=timezone.utc),
        attributes_at_first_seen={
            "condition": "diabetes",
            "age_group": "45-54",
            "source": "Facebook",
        },
        attributes={"plan_name": "Gold"},
    )

    payload = map_lead_listing_row(
        lead,
        mql={"score": 4, "signals": {"age": True}},
    )

    # Structural columns.
    assert payload["leadId"] == "prospect-1"
    assert payload["firstName"] == "Lead"
    assert payload["phone"] == "9999999999"
    assert payload["email"] == "lead.one@example.com"
    assert payload["city"] == "Mumbai"
    assert payload["prospectStage"] == "New Lead"
    assert payload["repName"] == "Agent Amy"
    assert payload["source"] == "lsq"
    assert payload["createdOn"] == "2026-04-01 09:00:00"
    assert payload["mqlScore"] == 4
    assert payload["mqlSignals"] == {"age": True}
    # Lead-profile fields stay in the two JSONB bags, verbatim.
    assert payload["attributesAtFirstSeen"]["condition"] == "diabetes"
    assert payload["attributesAtFirstSeen"]["age_group"] == "45-54"
    assert payload["attributes"]["plan_name"] == "Gold"
    # No bespoke flattened fields.
    assert "condition" not in payload
    assert "planName" not in payload


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
