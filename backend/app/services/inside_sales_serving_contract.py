"""Canonical serving contract for source-backed Inside Sales collections.

Phase 1 formalizes the serving boundary before mirror tables or sync jobs land.
The contract is intentionally backend-owned so later phases can swap execution
paths without changing route semantics ad hoc across the stack.
"""

from __future__ import annotations

from dataclasses import fields as dataclass_fields
from enum import Enum
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.inside_sales import (
    AgentListResponse,
    CallListResponse,
    LeadDetailFullResponse,
    LeadDetailResponse,
    LeadListResponse,
)
from app.services.inside_sales_dataset_resolver import (
    InsideSalesCallFilters,
    InsideSalesLeadFilters,
)


class CollectionSurfaceKind(str, Enum):
    ROUTE = "route"
    SERVICE = "service"


class CollectionSurfaceRole(str, Enum):
    SERVING_LIST = "serving_list"
    SERVING_OPTIONS = "serving_options"
    DETAIL_LOOKUP = "detail_lookup"
    DETAIL_DRILLDOWN = "detail_drilldown"
    CANONICAL_SELECTION = "canonical_selection"


class CollectionSurfaceContract(CamelModel):
    surface_id: str
    kind: CollectionSurfaceKind
    role: CollectionSurfaceRole
    collection_family: str | None = None
    method: str | None = None
    path: str | None = None
    stable_response_shapes: list[str] = Field(default_factory=list)
    consumers: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class CollectionServingSemantics(CamelModel):
    collection_family: Literal["calls", "leads"]
    record_identity: str
    filter_set: list[str] = Field(default_factory=list)
    sort_semantics: str
    pagination_semantics: str
    total_count_semantics: str
    freshness_semantics: str
    serving_endpoints: list[str] = Field(default_factory=list)
    canonical_selection_surfaces: list[str] = Field(default_factory=list)
    migration_notes: list[str] = Field(default_factory=list)


class AppCollectionServingContract(CamelModel):
    schema_version: Literal["v1"] = "v1"
    app_id: str
    source_of_ingestion: str
    current_source_of_serving: str
    target_source_of_serving: str
    source_of_evaluation: str
    selection_boundary: str
    collections: list[CollectionServingSemantics] = Field(default_factory=list)
    surfaces: list[CollectionSurfaceContract] = Field(default_factory=list)
    first_postgres_cutover_endpoints: list[str] = Field(default_factory=list)


def _filter_field_names(filter_type: type[object]) -> list[str]:
    return [field.name for field in dataclass_fields(filter_type)]


def _schema_names(*schema_types: type[CamelModel]) -> list[str]:
    return [schema_type.__name__ for schema_type in schema_types]


def _first_postgres_cutover_endpoints(
    surfaces: list[CollectionSurfaceContract],
) -> list[str]:
    serving_roles = {
        CollectionSurfaceRole.SERVING_LIST,
        CollectionSurfaceRole.SERVING_OPTIONS,
    }
    return [
        surface.path
        for surface in surfaces
        if surface.kind == CollectionSurfaceKind.ROUTE
        and surface.role in serving_roles
        and surface.path is not None
    ]


def _build_inside_sales_contract() -> AppCollectionServingContract:
    surfaces = [
        CollectionSurfaceContract(
            surface_id="inside_sales.calls.route",
            kind=CollectionSurfaceKind.ROUTE,
            role=CollectionSurfaceRole.SERVING_LIST,
            collection_family="calls",
            method="GET",
            path="/api/inside-sales/calls",
            stable_response_shapes=_schema_names(CallListResponse),
            consumers=[
                "src/services/api/insideSales.ts::fetchCalls",
                "src/stores/insideSalesStore.ts::loadCalls",
                "src/features/insideSales/pages/InsideSalesListing.tsx",
                "src/features/insideSales/components/SelectCallsStep.tsx",
            ],
            notes=[
                "Interactive listing contract is scope=page with filter-before-pagination semantics.",
                "scope=all is a temporary bridge for selection workflows and must not define the long-term serving boundary.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.leads.route",
            kind=CollectionSurfaceKind.ROUTE,
            role=CollectionSurfaceRole.SERVING_LIST,
            collection_family="leads",
            method="GET",
            path="/api/inside-sales/leads",
            stable_response_shapes=_schema_names(LeadListResponse),
            consumers=[
                "src/services/api/insideSales.ts::fetchLeads",
                "src/stores/insideSalesStore.ts::loadLeads",
                "src/features/insideSales/pages/InsideSalesListing.tsx",
            ],
            notes=[
                "Interactive listing contract stays filter-before-pagination with exact filtered totals.",
                "No client-selectable sort exists today; current order must remain explicit during migration.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.agents.route",
            kind=CollectionSurfaceKind.ROUTE,
            role=CollectionSurfaceRole.SERVING_OPTIONS,
            collection_family="calls",
            method="GET",
            path="/api/inside-sales/agents",
            stable_response_shapes=_schema_names(AgentListResponse),
            consumers=[
                "src/features/insideSales/components/CallFilterPanel.tsx",
                "src/features/insideSales/components/SelectCallsStep.tsx",
            ],
            notes=[
                "Serves date-scoped filter options for the calls collection.",
                "Should cut over with the collection-serving path instead of remaining a hidden live dependency.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.lead_lookup.route",
            kind=CollectionSurfaceKind.ROUTE,
            role=CollectionSurfaceRole.DETAIL_LOOKUP,
            collection_family="leads",
            method="GET",
            path="/api/inside-sales/leads/{prospect_id}",
            stable_response_shapes=_schema_names(LeadDetailResponse),
            consumers=[
                "src/features/insideSales/pages/InsideSalesCallDetail.tsx",
            ],
            notes=[
                "Supplemental lead lookup with explicit refresh support.",
                "Not part of the collection-serving cutover contract.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.lead_detail.route",
            kind=CollectionSurfaceKind.ROUTE,
            role=CollectionSurfaceRole.DETAIL_DRILLDOWN,
            collection_family="leads",
            method="GET",
            path="/api/inside-sales/leads/{prospect_id}/detail",
            stable_response_shapes=_schema_names(LeadDetailFullResponse),
            consumers=[
                "src/services/api/insideSales.ts::fetchLeadDetail",
                "src/features/insideSales/pages/InsideSalesLeadDetail.tsx",
            ],
            notes=[
                "Lead drilldown remains separate from collection-serving work.",
                "Any future mirror-backed detail flow should preserve eval-history linkage by stable prospect and activity identifiers.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.calls.dataset_page",
            kind=CollectionSurfaceKind.SERVICE,
            role=CollectionSurfaceRole.SERVING_LIST,
            collection_family="calls",
            consumers=[
                "backend/app/routes/inside_sales.py::list_calls",
            ],
            notes=[
                "Current implementation resolves the full upstream dataset, then filters, counts, and paginates locally.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.leads.dataset_page",
            kind=CollectionSurfaceKind.SERVICE,
            role=CollectionSurfaceRole.SERVING_LIST,
            collection_family="leads",
            consumers=[
                "backend/app/routes/inside_sales.py::list_leads",
            ],
            notes=[
                "Current implementation resolves the full upstream dataset before local filtering and pagination.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.calls.agent_options",
            kind=CollectionSurfaceKind.SERVICE,
            role=CollectionSurfaceRole.SERVING_OPTIONS,
            collection_family="calls",
            consumers=[
                "backend/app/routes/inside_sales.py::list_agents",
            ],
            notes=[
                "Current implementation walks the live upstream calls dataset to derive agent options.",
            ],
        ),
        CollectionSurfaceContract(
            surface_id="inside_sales.calls.selection",
            kind=CollectionSurfaceKind.SERVICE,
            role=CollectionSurfaceRole.CANONICAL_SELECTION,
            collection_family="calls",
            consumers=[
                "backend/app/services/evaluators/inside_sales_runner.py",
            ],
            notes=[
                "Canonical full-resolution selection for evaluate-inside-sales.",
                "Must remain isolated from interactive serving even while routes still share live resolvers.",
            ],
        ),
    ]

    return AppCollectionServingContract(
        app_id="inside-sales",
        source_of_ingestion="LeadSquared",
        current_source_of_serving="LeadSquared live request-time resolution",
        target_source_of_serving="PostgreSQL mirrored collections",
        source_of_evaluation="EvalRun and ThreadEvaluation",
        selection_boundary=(
            "Full-dataset canonical selection stays in dedicated services and job flows; "
            "interactive list routes must not depend on that heavy path after cutover."
        ),
        collections=[
            CollectionServingSemantics(
                collection_family="calls",
                record_identity="activity_id",
                filter_set=_filter_field_names(InsideSalesCallFilters),
                sort_semantics=(
                    "Newest-first by callStartTime, falling back to createdOn when callStartTime is absent."
                ),
                pagination_semantics=(
                    "Resolve filters before pagination; scope=page returns one page, while scope=all is a temporary "
                    "full-resolution bridge for selection workflows."
                ),
                total_count_semantics=(
                    "Exact filtered total over the resolved dataset."
                ),
                freshness_semantics=(
                    "Currently live from the upstream source at request time; after mirror cutover this contract becomes "
                    "mirror-backed with explicit freshness metadata instead of hidden live fetches."
                ),
                serving_endpoints=[
                    "/api/inside-sales/calls",
                    "/api/inside-sales/agents",
                ],
                canonical_selection_surfaces=[
                    "inside_sales.calls.selection",
                ],
                migration_notes=[
                    "Keep CallListResponse stable during the serving-source cutover.",
                    "Preserve filter-before-pagination and exact total semantics when moving counts into SQL.",
                    "Remove scope=all from normal list-serving responsibility once selection flows are fully isolated.",
                ],
            ),
            CollectionServingSemantics(
                collection_family="leads",
                record_identity="prospect_id",
                filter_set=_filter_field_names(InsideSalesLeadFilters),
                sort_semantics=(
                    "Current behavior preserves resolver/upstream order; no client-selectable lead sort is advertised yet, "
                    "so any future SQL ordering must be introduced intentionally."
                ),
                pagination_semantics=(
                    "Resolve filters before pagination and return exact filtered totals for the interactive list."
                ),
                total_count_semantics=(
                    "Exact filtered total over the resolved dataset."
                ),
                freshness_semantics=(
                    "Currently live from the upstream source at request time; after mirror cutover this contract becomes "
                    "mirror-backed with explicit freshness metadata instead of hidden live fetches."
                ),
                serving_endpoints=[
                    "/api/inside-sales/leads",
                ],
                canonical_selection_surfaces=[],
                migration_notes=[
                    "Keep LeadListResponse stable during the serving-source cutover.",
                    "Treat lead detail and refresh flows as separate from collection-serving semantics.",
                    "Make any default SQL sort explicit before changing user-visible lead ordering.",
                ],
            ),
        ],
        surfaces=surfaces,
        first_postgres_cutover_endpoints=_first_postgres_cutover_endpoints(surfaces),
    )


INSIDE_SALES_COLLECTION_SERVING_CONTRACT = _build_inside_sales_contract()


def get_inside_sales_collection_contract(
    collection_family: Literal["calls", "leads"],
) -> CollectionServingSemantics:
    for contract in INSIDE_SALES_COLLECTION_SERVING_CONTRACT.collections:
        if contract.collection_family == collection_family:
            return contract
    raise KeyError(f"Unknown Inside Sales collection family: {collection_family}")


def get_inside_sales_surface_contract(
    surface_id_or_path: str,
    *,
    method: str | None = None,
) -> CollectionSurfaceContract:
    normalized_method = method.upper() if method else None
    for surface in INSIDE_SALES_COLLECTION_SERVING_CONTRACT.surfaces:
        if surface.surface_id == surface_id_or_path:
            return surface
        if surface.path == surface_id_or_path and (
            normalized_method is None or surface.method == normalized_method
        ):
            return surface
    raise KeyError(f"Unknown Inside Sales surface: {surface_id_or_path}")


def list_inside_sales_serving_endpoints() -> tuple[str, ...]:
    return tuple(INSIDE_SALES_COLLECTION_SERVING_CONTRACT.first_postgres_cutover_endpoints)
