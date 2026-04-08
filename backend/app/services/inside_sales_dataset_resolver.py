"""Canonical dataset resolution for Inside Sales lead and call collections."""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from typing import Any, Literal, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eval_run import EvalRun, ThreadEvaluation
from app.services.lsq_client import (
    compute_lead_metrics,
    compute_mql_score,
    fetch_call_activities,
    fetch_leads,
    normalize_activity,
    normalize_lead,
)


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


def normalize_match_value(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _normalize_match_set(values: Sequence[str]) -> set[str]:
    return {
        normalized
        for normalized in (normalize_match_value(value) for value in values)
        if normalized
    }


def _slice_records(records: list[dict[str, Any]], page: int, page_size: int, scope: CallDatasetScope) -> ResolvedDatasetPage:
    total = len(records)
    if scope == "all":
        return ResolvedDatasetPage(
            records=records,
            total=total,
            page=1,
            page_size=total if total > 0 else page_size,
        )

    start = max(page - 1, 0) * page_size
    end = start + page_size
    return ResolvedDatasetPage(
        records=records[start:end],
        total=total,
        page=page,
        page_size=page_size,
    )


def _sort_call_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        records,
        key=lambda record: record.get("callStartTime") or record.get("createdOn") or "",
        reverse=True,
    )


def _build_agent_name_list(records: list[dict[str, Any]]) -> list[str]:
    by_key: dict[str, str] = {}
    for record in records:
        agent_name = (record.get("agentName") or "").strip()
        normalized = normalize_match_value(agent_name)
        if normalized and normalized not in by_key:
            by_key[normalized] = agent_name
    return sorted(by_key.values(), key=str.casefold)


async def _fetch_all_call_records(filters: InsideSalesCallFilters) -> list[dict[str, Any]]:
    page = 1
    page_size = 100
    records: list[dict[str, Any]] = []

    while True:
        result = await fetch_call_activities(
            date_from=filters.date_from,
            date_to=filters.date_to,
            event_codes=list(filters.event_codes) if filters.event_codes else None,
            page=page,
            page_size=page_size,
        )
        activities = result.get("activities", [])
        if not activities:
            break

        records.extend(normalize_activity(activity) for activity in activities)
        if len(activities) < page_size:
            break
        page += 1

    return _sort_call_records(records)


def _apply_call_filters(records: list[dict[str, Any]], filters: InsideSalesCallFilters) -> list[dict[str, Any]]:
    filtered = records

    agent_names = _normalize_match_set(filters.agents)
    if agent_names:
        filtered = [
            record
            for record in filtered
            if normalize_match_value(record.get("agentName")) in agent_names
        ]

    if filters.prospect_id:
        needle = filters.prospect_id.strip().lower()
        filtered = [
            record
            for record in filtered
            if needle in (record.get("prospectId") or "").lower()
        ]

    if filters.direction:
        filtered = [
            record
            for record in filtered
            if record.get("direction") == filters.direction
        ]

    if filters.status:
        status = filters.status.strip().lower()
        filtered = [
            record
            for record in filtered
            if (record.get("status") or "").lower() == status
        ]

    if filters.duration_min is not None:
        filtered = [
            record
            for record in filtered
            if (record.get("durationSeconds") or 0) >= filters.duration_min
        ]

    if filters.duration_max is not None:
        filtered = [
            record
            for record in filtered
            if (record.get("durationSeconds") or 0) <= filters.duration_max
        ]

    if filters.has_recording is True:
        filtered = [record for record in filtered if record.get("recordingUrl")]

    return filtered


async def resolve_call_dataset_page(
    filters: InsideSalesCallFilters,
    *,
    page: int,
    page_size: int,
    scope: CallDatasetScope = "page",
) -> ResolvedDatasetPage:
    records = await _fetch_all_call_records(filters)
    filtered = _apply_call_filters(records, filters)
    return _slice_records(filtered, page, page_size, scope)


async def list_call_agent_names(*, date_from: str, date_to: str) -> list[str]:
    records = await _fetch_all_call_records(
        InsideSalesCallFilters(date_from=date_from, date_to=date_to),
    )
    return _build_agent_name_list(records)


async def resolve_call_selection(
    filters: InsideSalesCallFilters,
    *,
    selection_mode: CallSelectionMode,
    selected_call_ids: Sequence[str],
    sample_size: int,
    skip_evaluated: bool,
    min_duration_seconds: int | None,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    app_id: str = "inside-sales",
) -> ResolvedCallSelection:
    records = await _fetch_all_call_records(filters)
    filtered = _apply_call_filters(records, filters)

    selected_ids = {call_id for call_id in selected_call_ids if call_id}
    if selection_mode == "specific":
        filtered = [
            record
            for record in filtered
            if (record.get("activityId") or "") in selected_ids
        ]

    if min_duration_seconds is not None:
        filtered = [
            record
            for record in filtered
            if (record.get("durationSeconds") or 0) >= min_duration_seconds
        ]

    skipped_evaluated = 0
    if skip_evaluated and filtered:
        activity_ids = [record["activityId"] for record in filtered if record.get("activityId")]
        evaluated_ids = set(
            await db.scalars(
                select(ThreadEvaluation.thread_id)
                .join(EvalRun, ThreadEvaluation.run_id == EvalRun.id)
                .where(
                    EvalRun.tenant_id == tenant_id,
                    EvalRun.user_id == user_id,
                    EvalRun.app_id == app_id,
                    EvalRun.status == "completed",
                    ThreadEvaluation.thread_id.in_(activity_ids),
                )
            )
        )
        skipped_evaluated = len(
            [record for record in filtered if record.get("activityId") in evaluated_ids]
        )
        filtered = [
            record
            for record in filtered
            if record.get("activityId") not in evaluated_ids
        ]

    skipped_no_recording = len(
        [record for record in filtered if not record.get("recordingUrl")]
    )
    filtered = [record for record in filtered if record.get("recordingUrl")]

    if selection_mode == "sample" and len(filtered) > sample_size:
        filtered = random.sample(filtered, sample_size)
        filtered = _sort_call_records(filtered)

    return ResolvedCallSelection(
        records=filtered,
        skipped_evaluated=skipped_evaluated,
        skipped_no_recording=skipped_no_recording,
    )


async def _fetch_all_leads(filters: InsideSalesLeadFilters) -> list[dict[str, Any]]:
    page = 1
    page_size = 100
    raw_leads: list[dict[str, Any]] = []

    while True:
        result = await fetch_leads(
            date_from=filters.date_from,
            date_to=filters.date_to,
            page=page,
            page_size=page_size,
        )
        leads = result.get("leads", [])
        if not leads:
            break

        raw_leads.extend(leads)
        if not result.get("has_more"):
            break
        page += 1

    return raw_leads


def _build_lead_record(raw_lead: dict[str, Any]) -> dict[str, Any] | None:
    lead = normalize_lead(raw_lead)
    mql_score, mql_signals = compute_mql_score(raw_lead)
    metrics = compute_lead_metrics(
        created_on=lead["createdOn"],
        last_activity_on=lead["lastActivityOn"],
        rnr_count=lead["rnrCount"],
        answered_count=lead["answeredCount"],
        first_activity_on=lead["firstActivityOn"],
    )
    frt_seconds = metrics["frt_seconds"]
    if frt_seconds is not None and frt_seconds < 60:
        frt_seconds = None

    return {
        "prospectId": lead["prospectId"],
        "firstName": lead["firstName"],
        "lastName": lead["lastName"],
        "phone": lead["phone"],
        "prospectStage": lead["prospectStage"],
        "city": lead["city"],
        "ageGroup": lead["ageGroup"],
        "condition": lead["condition"],
        "hba1cBand": lead["hba1cBand"],
        "intentToPay": lead["intentToPay"],
        "agentName": lead["agentName"],
        "rnrCount": lead["rnrCount"],
        "answeredCount": lead["answeredCount"],
        "totalDials": metrics["total_dials"],
        "connectRate": metrics["connect_rate"],
        "frtSeconds": frt_seconds,
        "leadAgeDays": metrics["lead_age_days"],
        "daysSinceLastContact": metrics["days_since_last_contact"],
        "mqlScore": mql_score,
        "mqlSignals": mql_signals,
        "createdOn": lead["createdOn"],
        "lastActivityOn": lead["lastActivityOn"],
        "source": lead["source"],
        "sourceCampaign": lead["sourceCampaign"],
    }


def _apply_lead_filters(records: list[dict[str, Any]], filters: InsideSalesLeadFilters) -> list[dict[str, Any]]:
    filtered = records

    agent_names = _normalize_match_set(filters.agents)
    if agent_names:
        filtered = [
            record
            for record in filtered
            if normalize_match_value(record.get("agentName")) in agent_names
        ]

    stages = _normalize_match_set(filters.stage)
    if stages:
        filtered = [
            record
            for record in filtered
            if normalize_match_value(record.get("prospectStage")) in stages
        ]

    conditions = _normalize_match_set(filters.condition)
    if conditions:
        filtered = [
            record
            for record in filtered
            if any(condition in normalize_match_value(record.get("condition")) for condition in conditions)
        ]

    cities = _normalize_match_set(filters.city)
    if cities:
        filtered = [
            record
            for record in filtered
            if any(city in normalize_match_value(record.get("city")) for city in cities)
        ]

    if filters.prospect_id:
        prospect_id = filters.prospect_id.strip()
        filtered = [
            record
            for record in filtered
            if (record.get("prospectId") or "") == prospect_id
        ]

    if filters.mql_min is not None:
        filtered = [
            record
            for record in filtered
            if (record.get("mqlScore") or 0) >= filters.mql_min
        ]

    return filtered


async def resolve_lead_dataset_page(
    filters: InsideSalesLeadFilters,
    *,
    page: int,
    page_size: int,
) -> ResolvedDatasetPage:
    raw_leads = await _fetch_all_leads(filters)
    records = [_build_lead_record(raw_lead) for raw_lead in raw_leads]
    filtered = _apply_lead_filters(
        [record for record in records if record is not None],
        filters,
    )
    return _slice_records(filtered, page, page_size, "page")
