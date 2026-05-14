"""Signal derivation framework — the ``llm_profile`` strategy plugin.

Phase 11B of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

LLM extraction over a lead's **normalized profile** — one call per lead,
producing ``DerivedSignal`` objects. This is the former
``backfill_lead_signals_job`` extraction, moved into the registry and
**re-pointed to read ``dim_lead``** (the normalized serving surface),
never ``crm_lead_record`` / ``raw_payload`` (invariant 21).

Invoked by the operator-triggered ``backfill-lead-signals`` job, under that
job's existing cost-budget / dry-run / ``max_leads`` guards — not on an
unbounded schedule. ``ctx.llm_provider`` is a ``LoggingLLMWrapper`` so
every call records an ``analytics.fact_llm_generation`` row;
``ctx.sync_run_id`` is the run's rollback handle, stamped on every row.

``source_rows`` are ``dim_lead``-shaped mappings (one batch). The
extraction input is built from ``dim_lead`` columns + the normalized
``attributes_at_first_seen`` / ``attributes`` bags.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Sequence

_log = logging.getLogger(__name__)

from app.services.analytics.signal_derivation.base import (
    DerivedSignal,
    SignalStrategy,
    SignalStrategyError,
    StrategyContext,
)
from app.services.analytics.signal_taxonomy import coerce_signal_type

_SYSTEM_PROMPT = (
    "You extract structured sales-intelligence signals from a CRM lead "
    "profile. Return JSON matching the provided schema. Be conservative — "
    "only emit signals the profile directly supports."
)

# Strict JSON schema the LLM must return.
_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "signals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "signal_type": {"type": "string"},
                    "signal_value": {"type": ["string", "null"]},
                    "signal_value_numeric": {"type": ["number", "null"]},
                    "confidence": {"type": ["number", "null"]},
                    "supporting_quote": {"type": ["string", "null"]},
                    "signal_at": {"type": ["string", "null"]},
                },
                "required": ["signal_type"],
            },
        }
    },
    "required": ["signals"],
}


def _coerce_decimal(raw: Any) -> Decimal | None:
    if raw is None or raw == "" or isinstance(raw, bool):
        return None
    try:
        return Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _coerce_signal_at(raw: Any) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _detected_at_for(row: Mapping[str, Any]) -> datetime:
    """Source-state-derived observation timestamp for a dim_lead row.

    ``updated_at`` advances on every resync, so a re-extraction after the
    lead's normalized state changed emits a fresh observation row; a
    re-run over unchanged state collapses on the framework dedup key.
    Falls back to ``first_seen_at`` then the epoch sentinel.
    """
    raw = row.get("updated_at") or row.get("first_seen_at")
    if not isinstance(raw, datetime):
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)


def _build_extraction_input(row: Mapping[str, Any]) -> dict[str, Any]:
    """Assemble the prompt-input payload from a normalized ``dim_lead`` row.

    Reads only the normalized surface — never a mirror, never
    ``raw_payload`` (invariant 21). ``has_payload`` short-circuits leads
    with nothing signal-bearing.
    """
    attrs_first_seen = row.get("attributes_at_first_seen") or {}
    attrs = row.get("attributes") or {}
    profile = {
        "city": row.get("city"),
        "latest_stage": row.get("latest_stage_observed"),
        "assigned_rep": row.get("assigned_rep_label"),
    }
    profile = {k: v for k, v in profile.items() if v not in (None, "", 0)}
    has_payload = bool(profile) or bool(attrs_first_seen) or bool(attrs)
    return {
        "lead_id": row.get("lead_id"),
        "profile": profile,
        "attributes_at_first_seen": attrs_first_seen,
        "attributes": attrs,
        "has_payload": has_payload,
    }


def _build_prompt(extraction_input: dict[str, Any]) -> str:
    return (
        "Lead profile:\n"
        f"  lead_id: {extraction_input['lead_id']}\n"
        f"  profile: {json.dumps(extraction_input['profile'], default=str)}\n"
        f"  attributes_at_first_seen: "
        f"{json.dumps(extraction_input['attributes_at_first_seen'], default=str)}\n"
        f"  attributes: {json.dumps(extraction_input['attributes'], default=str)}\n"
        "\n"
        'Return JSON: {"signals": [{signal_type, signal_value?, '
        "signal_value_numeric?, confidence?, supporting_quote?, signal_at?}, ...]}"
    )


async def _call_llm(provider: Any, extraction_input: dict[str, Any]) -> list[dict[str, Any]]:
    """One LLM call per lead. ``provider`` MUST be a LoggingLLMWrapper so an
    ``analytics.fact_llm_generation`` row is recorded for every call."""
    response = await provider.generate_json(
        prompt=_build_prompt(extraction_input),
        system_prompt=_SYSTEM_PROMPT,
        json_schema=_RESPONSE_SCHEMA,
    )
    if not isinstance(response, dict):
        return []
    signals = response.get("signals") or []
    if not isinstance(signals, list):
        return []
    return [s for s in signals if isinstance(s, dict) and s.get("signal_type")]


class LlmProfileStrategy(SignalStrategy):
    """Per-lead LLM extraction over the normalized ``dim_lead`` profile."""

    key = "llm_profile"

    def validate(self, definition: Mapping[str, Any]) -> None:
        if not isinstance(definition, Mapping):
            raise SignalStrategyError(
                "llm_profile definition body must be an object"
            )

    def attribute_schemas(
        self, definition: Mapping[str, Any]
    ) -> dict[str, dict[str, Any]]:
        # LLM-extracted signals carry their payload structurally; no
        # per-signal_type JSONB keys are declared (the manifest's
        # ``_default`` covers them).
        return {}

    async def derive(
        self,
        *,
        definition: Mapping[str, Any],
        source_rows: Sequence[Any],
        ctx: StrategyContext,
    ) -> list[DerivedSignal]:
        if ctx.llm_provider is None:
            raise SignalStrategyError(
                "llm_profile.derive requires ctx.llm_provider"
            )
        out: list[DerivedSignal] = []
        for row in source_rows:
            lead_id = row.get("lead_id")
            if not lead_id:
                continue
            extraction_input = _build_extraction_input(row)
            if not extraction_input["has_payload"]:
                continue
            try:
                raw_signals = await _call_llm(ctx.llm_provider, extraction_input)
            except Exception:
                # One bad lead must not sink the batch — log and skip. The
                # job's retry-safety + the upsert dedup key cover a retry.
                _log.exception(
                    "llm_profile.derive lead extraction failed lead_id=%s",
                    lead_id,
                )
                continue
            detected_at = _detected_at_for(row)
            # Dedupe by signal_type within the lead: the framework key is
            # (lead_id, signal_type, detected_at, ordinal); emit a stable
            # ordinal so same-type signals from one extraction coexist.
            seen: set[str] = set()
            ordinal = 0
            for raw in raw_signals:
                raw_type = (raw.get("signal_type") or "").strip()
                if not raw_type:
                    continue
                attributes = raw.get("attributes") or {}
                if not isinstance(attributes, dict):
                    attributes = {"raw_attributes": attributes}
                signal_type, attributes = coerce_signal_type(
                    raw_type, attributes=attributes
                )
                if signal_type in seen:
                    continue
                seen.add(signal_type)
                out.append(
                    DerivedSignal(
                        lead_id=str(lead_id),
                        signal_type=signal_type,
                        detected_at=detected_at,
                        signal_value=_safe_str(raw.get("signal_value")),
                        signal_value_numeric=_coerce_decimal(
                            raw.get("signal_value_numeric")
                        ),
                        signal_at=_coerce_signal_at(raw.get("signal_at")),
                        confidence=_coerce_decimal(raw.get("confidence")),
                        supporting_quote=_safe_str(raw.get("supporting_quote")),
                        ordinal=ordinal,
                        attributes=attributes,
                        sync_run_id=ctx.sync_run_id,
                    )
                )
                ordinal += 1
        return out
