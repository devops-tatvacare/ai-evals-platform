"""Signal derivation framework — strategy interface + shared types.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

A *strategy* is generic code; a *definition* (``analytics.signal_definition``)
is tenant business config. Each strategy plugin turns a definition + rows
from a normalized source surface into ``DerivedSignal`` objects; the
``derive-signals`` Transform job stamps them into ``analytics.fact_lead_signal``.

Strategies read ONLY normalized fact/dim surfaces — never ``raw_payload``,
never a mirror (invariant 21). The strategy never touches the DB or the
manifest directly; the orchestrator owns I/O.
"""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class DerivedSignal:
    """One derived signal about one lead — the strategy's unit of output.

    Effectively "a ``FactLeadSignal`` row minus the ids the caller stamps"
    (``tenant_id`` / ``app_id`` / ``signal_definition_id``). The framework
    dedup key is ``(tenant_id, app_id, lead_id, signal_type, detected_at,
    ordinal)``; ``detected_at`` is source-state-derived so a re-run over
    unchanged state collapses to one row, and ``ordinal`` lets one source
    legitimately emit multiple signals of the same ``signal_type``
    (``rule`` rows use ``ordinal=0``; LLM rows use the array index).

    ``eval_run_id`` / ``thread_evaluation_id`` / ``sync_run_id`` /
    ``source_activity_id`` are optional lineage the LLM strategies carry —
    the dedup key no longer keys off them (Phase 11B), but they remain
    useful join / rollback handles.
    """

    lead_id: str
    signal_type: str
    detected_at: datetime
    signal_value: str | None = None
    signal_value_numeric: Decimal | None = None
    signal_at: datetime | None = None
    confidence: Decimal | None = None
    supporting_quote: str | None = None
    ordinal: int = 0
    attributes: dict[str, Any] = field(default_factory=dict)
    # Optional lineage (LLM strategies set these; ``rule`` leaves them None).
    source_activity_id: str | None = None
    eval_run_id: uuid.UUID | None = None
    thread_evaluation_id: int | None = None
    sync_run_id: uuid.UUID | None = None


@dataclass(frozen=True)
class StrategyContext:
    """Ambient context the caller hands a strategy.

    ``rule`` ignores everything but the scoping ids. ``llm_profile``
    reaches for ``llm_provider`` and ``sync_run_id`` (its rollback handle).
    ``llm_transcript`` reaches for ``eval_run`` (the ``EvaluationRun``
    whose thread results are the source rows). No DB session is exposed —
    the caller loads source rows and persists output; strategies stay
    pure-ish (``rule`` is fully pure; the LLM strategies do provider I/O
    only).
    """

    tenant_id: uuid.UUID
    app_id: str
    llm_provider: Any | None = None
    eval_run: Any | None = None
    sync_run_id: uuid.UUID | None = None


class SignalStrategyError(ValueError):
    """Raised when a definition body is structurally invalid for a strategy."""


class SignalStrategy(ABC):
    """Base class for the three strategy plugins (``rule`` / ``llm_profile``
    / ``llm_transcript``). Registered by ``key`` in the registry."""

    #: Strategy key — must match ``signal_definition.strategy``.
    key: str

    @abstractmethod
    def validate(self, definition: Mapping[str, Any]) -> None:
        """Raise ``SignalStrategyError`` if the definition body is invalid.

        Run at definition write time (admin screen) and at boot before the
        first Transform pass — fail loud, never silently skip.
        """

    @abstractmethod
    def attribute_schemas(
        self, definition: Mapping[str, Any]
    ) -> dict[str, dict[str, Any]]:
        """Return ``{signal_type: {jsonb_key: AttributeKeySchema-shaped dict}}``.

        The manifest projection composes ``fact_lead_signal.attribute_schemas``
        from every enabled definition's output here (invariant 21, §7.4).
        A signal_type with no JSONB keys returns an empty dict.
        """

    @abstractmethod
    async def derive(
        self,
        *,
        definition: Mapping[str, Any],
        source_rows: Sequence[Any],
        ctx: StrategyContext,
    ) -> list[DerivedSignal]:
        """Produce derived signals from a batch of source rows.

        ``source_rows`` shape is strategy-specific: ``rule`` / ``llm_profile``
        get ``dim_lead``-shaped mappings; ``llm_transcript`` gets
        ``EvaluationRunThreadResult`` objects. Pure for ``rule`` and
        ``llm_transcript``; ``llm_profile`` does provider I/O via ``ctx``.
        """
