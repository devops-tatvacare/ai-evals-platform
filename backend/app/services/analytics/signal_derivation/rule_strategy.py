"""Signal derivation framework — the ``rule`` strategy plugin.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

Deterministic, field-bound rules over a normalized source surface. This
plugin replaces the hardcoded ``compute_mql_score`` — ``mql`` becomes a
seeded ``rule`` definition, not Python.

Definition body shape::

    {
      "signals": [
        {"signal_type": "mql_age",
         "field": "attributes_at_first_seen.age_group",
         "predicate": "in_set",
         "args": {"values": ["31-40", ...]},
         "description": "..."},
        ...
      ],
      "score": {"signal_type": "mql_score", "kind": "count_true"}
    }

``field`` is a dotted path resolved against a source row: either a bare
column (``city``) or one JSONB key (``attributes_at_first_seen.age_group``).
Only normalized surfaces — never ``raw_payload`` (invariant 21).

Each declared signal emits one ``DerivedSignal`` per source row, with
``signal_value`` ``"true"``/``"false"`` and ``signal_value_numeric``
``1``/``0`` so the roll-up score is a plain SUM downstream. ``detected_at``
is the source row's ``first_seen_at`` — stable, so a re-run over unchanged
state collapses to one row per ``(lead, signal_type)``.
"""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Mapping, Sequence

from app.services.analytics.signal_derivation.base import (
    DerivedSignal,
    SignalStrategy,
    SignalStrategyError,
    StrategyContext,
)

# Predicate vocabulary — deliberately small. These four cover every MQL
# signal; the admin field-picker (Phase 11C) offers exactly this set.
_PREDICATES = ("in_set", "contains_any", "numeric_gte", "present_and_not_contains")

_NUMERIC_TOKEN = re.compile(r"(\d+\.?\d*)")


def _norm(value: Any) -> str:
    """Source value → stripped lowercase string. None/blank → empty string."""
    if value is None:
        return ""
    return str(value).strip().lower()


def _resolve_field(row: Mapping[str, Any], field: str) -> Any:
    """Resolve a dotted ``field`` path against a source row.

    Accepts a bare column (``city``) or one JSONB key
    (``attributes_at_first_seen.age_group``). Deeper paths are rejected at
    validate() time, so this only ever sees 1- or 2-segment paths.
    """
    parts = field.split(".")
    cursor: Any = row.get(parts[0])
    for segment in parts[1:]:
        if not isinstance(cursor, Mapping):
            return None
        cursor = cursor.get(segment)
    return cursor


def _eval_predicate(predicate: str, args: Mapping[str, Any], raw_value: Any) -> bool:
    """Apply one predicate. Null/blank source values always yield False —
    never inferred (matches the prior compute_mql_score contract)."""
    value = _norm(raw_value)
    if predicate == "in_set":
        allowed = {_norm(v) for v in args.get("values", [])}
        return bool(value) and value in allowed
    if predicate == "contains_any":
        needles = [_norm(v) for v in args.get("values", []) if _norm(v)]
        return bool(value) and any(n in value for n in needles)
    if predicate == "numeric_gte":
        if not value:
            return False
        match = _NUMERIC_TOKEN.search(value)
        if not match:
            return False
        try:
            return float(match.group(1)) >= float(args["threshold"])
        except (ValueError, KeyError, TypeError):
            return False
    if predicate == "present_and_not_contains":
        excluded = [_norm(v) for v in args.get("exclude", []) if _norm(v)]
        return bool(value) and not any(e in value for e in excluded)
    # Unreachable — validate() rejects unknown predicates.
    raise SignalStrategyError(f"unknown predicate {predicate!r}")


class RuleStrategy(SignalStrategy):
    """Deterministic field-bound rule evaluation. Pure — no I/O."""

    key = "rule"

    def validate(self, definition: Mapping[str, Any]) -> None:
        signals = definition.get("signals")
        if not isinstance(signals, list) or not signals:
            raise SignalStrategyError(
                "rule definition.signals must be a non-empty list"
            )
        seen: set[str] = set()
        for i, sig in enumerate(signals):
            if not isinstance(sig, Mapping):
                raise SignalStrategyError(f"signals[{i}] must be an object")
            signal_type = sig.get("signal_type")
            if not signal_type or not isinstance(signal_type, str):
                raise SignalStrategyError(
                    f"signals[{i}].signal_type must be a non-empty string"
                )
            if signal_type in seen:
                raise SignalStrategyError(
                    f"duplicate signal_type {signal_type!r} in definition"
                )
            seen.add(signal_type)
            field = sig.get("field")
            if not field or not isinstance(field, str) or field.count(".") > 1:
                raise SignalStrategyError(
                    f"signals[{i}].field must be a 1- or 2-segment dotted path"
                )
            predicate = sig.get("predicate")
            if predicate not in _PREDICATES:
                raise SignalStrategyError(
                    f"signals[{i}].predicate must be one of {_PREDICATES}"
                )
            if not isinstance(sig.get("args", {}), Mapping):
                raise SignalStrategyError(f"signals[{i}].args must be an object")
        score = definition.get("score")
        if score is not None:
            if not isinstance(score, Mapping):
                raise SignalStrategyError("definition.score must be an object")
            if not score.get("signal_type"):
                raise SignalStrategyError("score.signal_type is required")
            if score.get("kind") != "count_true":
                raise SignalStrategyError("score.kind must be 'count_true'")
            if score["signal_type"] in seen:
                raise SignalStrategyError(
                    f"score.signal_type {score['signal_type']!r} collides "
                    f"with a declared signal"
                )

    def attribute_schemas(
        self, definition: Mapping[str, Any]
    ) -> dict[str, dict[str, Any]]:
        # Rule signals carry their value structurally (signal_value /
        # signal_value_numeric); the JSONB attributes bag is empty. Each
        # signal_type is still declared so the manifest projection knows
        # the discriminator values exist.
        schemas: dict[str, dict[str, Any]] = {}
        for sig in definition.get("signals", []):
            schemas[sig["signal_type"]] = {}
        score = definition.get("score")
        if score is not None:
            schemas[score["signal_type"]] = {}
        return schemas

    async def derive(
        self,
        *,
        definition: Mapping[str, Any],
        source_rows: Sequence[Any],
        ctx: StrategyContext,
    ) -> list[DerivedSignal]:
        signals_spec = definition.get("signals", [])
        score_spec = definition.get("score")
        out: list[DerivedSignal] = []

        for row in source_rows:
            lead_id = row.get("lead_id")
            detected_at = row.get("first_seen_at")
            if not lead_id or not isinstance(detected_at, datetime):
                # A source row without lead identity / first_seen_at can't
                # be keyed into fact_lead_signal — skip rather than guess.
                continue

            true_count = 0
            for sig in signals_spec:
                raw_value = _resolve_field(row, sig["field"])
                hit = _eval_predicate(
                    sig["predicate"], sig.get("args", {}), raw_value
                )
                if hit:
                    true_count += 1
                out.append(
                    DerivedSignal(
                        lead_id=str(lead_id),
                        signal_type=sig["signal_type"],
                        detected_at=detected_at,
                        signal_value="true" if hit else "false",
                        signal_value_numeric=Decimal(1 if hit else 0),
                    )
                )

            if score_spec is not None:
                out.append(
                    DerivedSignal(
                        lead_id=str(lead_id),
                        signal_type=score_spec["signal_type"],
                        detected_at=detected_at,
                        signal_value=str(true_count),
                        signal_value_numeric=Decimal(true_count),
                    )
                )

        return out
