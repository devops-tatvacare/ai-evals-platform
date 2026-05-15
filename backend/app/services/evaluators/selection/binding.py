"""Dataset binding — declarative wiring from spec field → SQL column / JSONB path.

A binding owns one (table, base-predicate, predicate-builder, projection)
tuple. The resolver consumes the binding to build SQL; the runner shell
consumes it to turn rows into `EvaluableCall`. Adding a new dataset = register
a new binding, no changes to the resolver or shell.

Bindings here are app-agnostic by class name. The inside-sales call binding
lives in this file because it is the only call dataset today; it is named for
the table it points at, not for the app that uses it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Integer as _SAInteger, ColumnElement, func, or_

from app.models.analytics_lead_facts import FactLeadActivity
from app.services.evaluators.selection.record import EvaluableCall
from app.services.evaluators.selection.spec import EvaluationSelectionSpec


@dataclass(frozen=True)
class BindContext:
    """Tenant + app scope passed to every predicate builder."""

    tenant_id: Any
    app_id: str


@dataclass(frozen=True)
class DatasetBinding:
    """Declarative binding from selection spec to SQL.

    `key` — registry pointer that App.config references.
    `table` — SQLAlchemy model class.
    `base_predicate(ctx)` — always-on clauses (tenant, app, type discriminator).
    `predicate_builder(ctx, spec)` — clauses derived from the spec.
    `id_column` — column matched by `selected_ids` and emitted as the per-row
        external id (also stored as `evaluation_run_thread_results.thread_id`).
    `random_order_expression` — order-by used in `mode='sample'`.
    `row_to_record` — projects one ORM row into an EvaluableCall.
    """

    key: str
    table: type
    base_predicate: Callable[[BindContext], list[ColumnElement[bool]]]
    predicate_builder: Callable[
        [BindContext, EvaluationSelectionSpec], list[ColumnElement[bool]]
    ]
    id_column: Any
    random_order_expression: Any
    row_to_record: Callable[[Any], EvaluableCall]


# ── helpers for the JSONB attribute bag ────────────────────────────────


def _attr(column: Any, key: str) -> Any:
    return column.op("->>")(key)


def _attr_int(column: Any, key: str) -> Any:
    return func.nullif(column.op("->>")(key), "").cast(_SAInteger)


# ── concrete binding: analytics.fact_lead_activity rows where activity_type='call' ──


def _fact_lead_activity_call_base_predicate(
    ctx: BindContext,
) -> list[ColumnElement[bool]]:
    return [
        FactLeadActivity.tenant_id == ctx.tenant_id,
        FactLeadActivity.app_id == ctx.app_id,
        FactLeadActivity.activity_type == "call",
    ]


def _fact_lead_activity_call_predicates(
    ctx: BindContext,  # noqa: ARG001 — ctx unused; kept for signature uniformity
    spec: EvaluationSelectionSpec,
) -> list[ColumnElement[bool]]:
    attrs = FactLeadActivity.attributes
    out: list[ColumnElement[bool]] = []

    if spec.agents:
        normalized = tuple(
            " ".join(a.strip().lower().split()) for a in spec.agents if a and a.strip()
        )
        if normalized:
            out.append(func.lower(FactLeadActivity.actor_label).in_(normalized))

    if spec.lead_ids:
        cleaned = tuple(lid.strip() for lid in spec.lead_ids if lid and lid.strip())
        if cleaned:
            out.append(FactLeadActivity.lead_id.in_(cleaned))

    if spec.direction is not None:
        out.append(func.lower(_attr(attrs, "direction")) == spec.direction.lower())

    if spec.status is not None and spec.status.strip():
        out.append(func.lower(_attr(attrs, "status")) == spec.status.strip().lower())

    if spec.event_codes:
        out.append(FactLeadActivity.source_event_code.in_(spec.event_codes))

    if spec.duration_min_seconds is not None:
        out.append(_attr_int(attrs, "duration_seconds") >= spec.duration_min_seconds)
    if spec.duration_max_seconds is not None:
        out.append(_attr_int(attrs, "duration_seconds") <= spec.duration_max_seconds)

    if spec.has_recording == "only":
        out.append(_attr(attrs, "recording_url").isnot(None))
        out.append(_attr(attrs, "recording_url") != "")
    elif spec.has_recording == "exclude":
        out.append(
            or_(
                _attr(attrs, "recording_url").is_(None),
                _attr(attrs, "recording_url") == "",
            )
        )

    return out


def _fact_lead_activity_call_row_to_record(row: FactLeadActivity) -> EvaluableCall:
    attrs: dict[str, Any] = dict(row.attributes or {})
    duration_raw = attrs.get("duration_seconds")
    duration = 0
    if duration_raw not in (None, ""):
        try:
            duration = int(duration_raw)
        except (TypeError, ValueError):
            duration = 0
    return EvaluableCall(
        activity_id=row.source_activity_id,
        lead_id=row.lead_id,
        rep_label=row.actor_label,
        rep_external_id=row.actor_id,
        rep_email=attrs.get("rep_email") or None,
        occurred_at=row.occurred_at,
        direction=attrs.get("direction") or None,
        status=attrs.get("status") or None,
        duration_seconds=duration,
        recording_url=attrs.get("recording_url") or None,
        event_code=row.source_event_code,
        phone_number=attrs.get("phone_number") or None,
        display_number=attrs.get("display_number") or None,
        notes=attrs.get("call_notes") or None,
        session_id=attrs.get("call_session_id") or None,
        raw_attributes=attrs,
    )


FACT_LEAD_ACTIVITY_CALL_BINDING = DatasetBinding(
    key="fact_lead_activity_call",
    table=FactLeadActivity,
    base_predicate=_fact_lead_activity_call_base_predicate,
    predicate_builder=_fact_lead_activity_call_predicates,
    id_column=FactLeadActivity.source_activity_id,
    random_order_expression=func.random(),
    row_to_record=_fact_lead_activity_call_row_to_record,
)


__all__ = [
    "BindContext",
    "DatasetBinding",
    "FACT_LEAD_ACTIVITY_CALL_BINDING",
]
