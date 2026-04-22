"""Shared DTOs for Inside Sales dataset resolution.

Before PR 5, this module owned the LSQ-backed resolvers that fetched call and
lead records synchronously from LeadSquared. PR 5 moved every read onto the
Postgres source-serving layer (`inside_sales_source_resolver`); PR 6 deleted
the LSQ fetch path. What remains is the shared type contract — filter and
result dataclasses plus `normalize_match_value` — so both the source resolver
and the serving contract speak the same language.

Do NOT re-add LSQ-fetching functions here. If a new read path is needed, add
it alongside the source resolver.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


CallDatasetScope = Literal["page", "all"]
CallSelectionMode = Literal["all", "sample", "specific"]


@dataclass(frozen=True)
class ResolvedDatasetPage:
    records: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


@dataclass(frozen=True)
class ResolvedCallSelection:
    records: list[dict[str, Any]]
    skipped_evaluated: int
    skipped_no_recording: int


@dataclass(frozen=True)
class InsideSalesCallFilters:
    date_from: str
    date_to: str
    agents: tuple[str, ...] = ()
    prospect_id: str | None = None
    direction: str | None = None
    status: str | None = None
    duration_min: int | None = None
    duration_max: int | None = None
    has_recording: bool | None = None
    event_codes: tuple[int, ...] | None = None


@dataclass(frozen=True)
class InsideSalesLeadFilters:
    date_from: str
    date_to: str
    agents: tuple[str, ...] = ()
    stage: tuple[str, ...] = ()
    mql_min: int | None = None
    condition: tuple[str, ...] = ()
    city: tuple[str, ...] = ()
    prospect_id: str | None = None
    q: str | None = None


def normalize_match_value(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())
