"""Inside Sales serving contract coverage."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.inside_sales_serving_contract import (
    CollectionSurfaceKind,
    CollectionSurfaceRole,
    INSIDE_SALES_COLLECTION_SERVING_CONTRACT,
    get_inside_sales_collection_contract,
    get_inside_sales_surface_contract,
    list_inside_sales_serving_endpoints,
)


def test_inside_sales_contract_declares_phase_one_serving_boundary():
    contract = INSIDE_SALES_COLLECTION_SERVING_CONTRACT

    assert contract.app_id == "inside-sales"
    assert contract.source_of_ingestion == "LeadSquared"
    assert contract.target_source_of_serving == "PostgreSQL mirrored collections"
    assert set(contract.first_postgres_cutover_endpoints) == {
        "/api/inside-sales/calls",
        "/api/inside-sales/leads",
        "/api/inside-sales/agents",
    }


def test_calls_contract_keeps_serving_and_selection_roles_separate():
    calls = get_inside_sales_collection_contract("calls")
    calls_route = get_inside_sales_surface_contract("/api/inside-sales/calls", method="GET")
    selection_surface = get_inside_sales_surface_contract("inside_sales.calls.selection")

    assert calls.record_identity == "activity_id"
    assert calls.filter_set == [
        "date_from",
        "date_to",
        "agents",
        "prospect_id",
        "direction",
        "status",
        "duration_min",
        "duration_max",
        "has_recording",
        "event_codes",
    ]
    assert "inside_sales.calls.selection" in calls.canonical_selection_surfaces
    assert any("scope=all" in note for note in calls.migration_notes)
    assert calls_route.kind == CollectionSurfaceKind.ROUTE
    assert calls_route.role == CollectionSurfaceRole.SERVING_LIST
    assert calls_route.stable_response_shapes == ["CallListResponse"]
    assert selection_surface.role == CollectionSurfaceRole.CANONICAL_SELECTION


def test_leads_contract_records_current_ordering_and_detail_surfaces():
    leads = get_inside_sales_collection_contract("leads")
    lead_list_route = get_inside_sales_surface_contract("/api/inside-sales/leads", method="GET")
    lead_lookup_route = get_inside_sales_surface_contract(
        "/api/inside-sales/leads/{prospect_id}",
        method="GET",
    )
    lead_detail_route = get_inside_sales_surface_contract(
        "/api/inside-sales/leads/{prospect_id}/detail",
        method="GET",
    )

    assert leads.record_identity == "prospect_id"
    assert "upstream order" in leads.sort_semantics
    assert "exact filtered total" in leads.total_count_semantics.lower()
    assert lead_list_route.role == CollectionSurfaceRole.SERVING_LIST
    assert lead_lookup_route.role == CollectionSurfaceRole.DETAIL_LOOKUP
    assert lead_detail_route.role == CollectionSurfaceRole.DETAIL_DRILLDOWN


def test_serving_endpoint_helper_only_lists_phase_one_serving_routes():
    assert list_inside_sales_serving_endpoints() == (
        "/api/inside-sales/calls",
        "/api/inside-sales/leads",
        "/api/inside-sales/agents",
    )
