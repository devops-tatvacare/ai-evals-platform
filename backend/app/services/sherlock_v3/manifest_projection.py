"""Sherlock v3 manifest projection (Phase 1A).

Given an ``AppManifest`` plus a deterministic ``IntentClass``, decide
which catalog tables the ``data_specialist`` is allowed to see — and
return a ``GroundingContext`` that the prompt builder + telemetry both
consume.

Why projection lives here, not in the prompt builder:
    The prompt builder used to receive the *full* unfiltered schema,
    every table flat. The LLM picked tables by noun-match, which is
    why aggregate questions hit ``platform.evaluation_runs`` instead of
    ``analytics.agg_evaluation_run``. Projection runs in pure Python
    BEFORE the agent is constructed (Plan §1.2 — no ``ctx.scratch``
    side channel) and the resulting context is the single grounding
    surface for both the prompt and the routing telemetry.

Layer policy per intent class:

    aggregate    -> {analytics_aggregate, identity}
    fact_grain   -> {analytics_fact, identity}
    identity     -> {identity, transactional}
    detail       -> {transactional, identity}
    mixed        -> all five layers (graceful degradation — never
                    starve the LLM when classification is uncertain)

A catalog table whose ``layer`` is unset (``None``) is treated as
always-allowed. This keeps half-tagged manifests from silently dropping
tables and makes the projection additive: tag a layer when you want
filtering, leave it off to opt out per-table.

Plan: docs/plans/2026-05-10-sherlock-grounded-routing.md §Phase 1.1.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.chat_engine.manifest import AppManifest, TableLayer
from app.services.sherlock_v3.intent_classifier import IntentClass


# Layer policy per intent. Frozensets so the runtime cannot mutate them
# in place — projection must stay deterministic across turns.
_ALL_LAYERS: frozenset[TableLayer] = frozenset({
    "analytics_aggregate", "analytics_fact",
    "transactional", "data_surface", "identity",
})

_LAYERS_BY_INTENT: dict[IntentClass, frozenset[TableLayer]] = {
    "aggregate": frozenset({"analytics_aggregate", "identity"}),
    "fact_grain": frozenset({"analytics_fact", "identity"}),
    "identity": frozenset({"identity", "transactional"}),
    "detail": frozenset({"transactional", "identity"}),
    "mixed": _ALL_LAYERS,
}


@dataclass(frozen=True)
class VerifiedExampleRef:
    """One retrieved verified-query reference rendered into the prompt
    + surfaced in routing telemetry. Mirrors the public surface of
    ``verified_queries.RetrievedQuery`` so the projection layer stays
    free of a circular import.
    """
    id: str  # uuid as string for telemetry-friendliness
    question: str
    sql: str
    score: float
    source: str


@dataclass(frozen=True)
class GroundingContext:
    """Per-turn grounding payload handed to the data_specialist.

    Frozen because it is computed once per turn in ``runtime.run_turn``
    and read (not mutated) by the prompt builder + the ``submit_sql``
    telemetry. ``intent_class`` and ``projected_tables`` are the
    routing-truth fields; downstream callers must not synthesize their
    own intent.
    """

    app_id: str
    user_message: str
    intent_class: IntentClass
    allowed_layers: frozenset[TableLayer]

    # Sorted catalog table names (lower-case) that survived projection.
    projected_tables: tuple[str, ...]

    # ``schema_context`` shape filtered down to ``projected_tables`` —
    # ready to drop into ``data_specialist_prompt.build_data_specialist_prompt``.
    projected_schema: dict[str, Any]

    # Role-hint strings (``<table>.<column> is …``) filtered to the
    # surviving tables.
    projected_role_hints: tuple[str, ...]

    # Sorted list to render under "Allowed tables:" in the prompt.
    allowed_tables_hint: tuple[str, ...]

    # Telemetry — recorded per ``submit_sql`` attempt so the audit set
    # can measure projection effects without re-running the classifier.
    original_table_count: int
    projected_table_count: int

    # Phase 2A: verified question→SQL examples retrieved from
    # ``platform.sherlock_verified_queries`` for this turn. Empty when
    # the retriever returned nothing or DB lookup failed (the prompt
    # builder degrades to "(none for this app yet)").
    verified_examples: tuple[VerifiedExampleRef, ...] = ()

    # Phase 3: residual instruction block (app-default markdown +
    # optional tenant override). Empty string when both tiers are empty
    # — the prompt builder skips the INSTRUCTIONS heading entirely.
    instructions_block: str = ''

    def telemetry_dict(self) -> dict[str, Any]:
        """Serializable view of the grounding decision for log lines."""
        return {
            "intent_class": self.intent_class,
            "allowed_layers": sorted(self.allowed_layers),
            "projected_tables": list(self.projected_tables),
            "original_table_count": self.original_table_count,
            "projected_table_count": self.projected_table_count,
            "verified_example_ids": [v.id for v in self.verified_examples],
            "instructions_present": bool(self.instructions_block),
            "instructions_chars": len(self.instructions_block),
        }


def _layers_for_intent(intent_class: IntentClass) -> frozenset[TableLayer]:
    return _LAYERS_BY_INTENT.get(intent_class, _ALL_LAYERS)


def _is_allowed(table_layer: TableLayer | None, allowed: frozenset[TableLayer]) -> bool:
    """Untagged (``None``) tables pass through; tagged tables are filtered."""
    if table_layer is None:
        return True
    return table_layer in allowed


def project_for_intent(
    *,
    app_id: str,
    user_message: str,
    intent_class: IntentClass,
    manifest: AppManifest,
    schema_context: dict[str, Any],
    full_allowed_tables: list[str],
    full_role_hints: list[str],
) -> GroundingContext:
    """Project a manifest + full schema_context down to one intent class.

    ``schema_context`` and ``full_allowed_tables`` / ``full_role_hints``
    are produced upstream by ``sql_agent._build_schema_context`` /
    ``_allowed_tables`` / ``_column_role_hints`` against the live
    semantic model. Projection only filters; it never invents tables
    or columns the upstream layer did not already expose.
    """
    allowed_layers = _layers_for_intent(intent_class)

    # Build the "kept" set from manifest layer tags. Match against the
    # lower-case table name — schema_context keys preserve case but
    # ``_allowed_tables`` lowercases them, so we normalize both sides.
    kept_table_names: set[str] = set()
    for table_name, table in manifest.catalog_tables.items():
        if _is_allowed(table.layer, allowed_layers):
            kept_table_names.add(table_name.lower())

    # ── filter schema_context['tables'] ──────────────────────────────
    src_tables = schema_context.get("tables") or {}
    if not isinstance(src_tables, dict):
        src_tables = {}
    original_table_count = len(src_tables)

    projected_tables_dict: dict[str, Any] = {}
    for raw_name, payload in src_tables.items():
        if str(raw_name).lower() in kept_table_names:
            projected_tables_dict[raw_name] = payload

    # ── filter available_tables / allowed_tables_hint ────────────────
    src_available = schema_context.get("available_tables") or full_allowed_tables
    if not isinstance(src_available, list):
        src_available = list(full_allowed_tables)

    allowed_tables_hint = tuple(sorted({
        str(t).lower() for t in src_available if str(t).lower() in kept_table_names
    }))

    # Defensive fallback: if the manifest matched zero tables for this
    # intent (e.g. an app whose manifest is entirely untagged for a
    # layer), restore the unprojected schema. This protects the prompt
    # from going blank on a config gap. The asymmetric case where the
    # manifest matches a table but the semantic_model doesn't carry it
    # in ``tables{}`` (only in ``available_tables``) is intentional —
    # ``allowed_tables_hint`` still names that table so the LLM knows
    # it exists.
    if not kept_table_names:
        projected_tables_dict = dict(src_tables)
        allowed_tables_hint = tuple(sorted(str(t).lower() for t in src_available))
        kept_table_names = {str(t).lower() for t in src_available}

    projected_table_names = tuple(sorted(kept_table_names))

    # ── filter role hints by "<table>." prefix ───────────────────────
    projected_role_hints = tuple(
        h for h in full_role_hints
        if isinstance(h, str)
        and "." in h
        and h.split(".", 1)[0].lower() in kept_table_names
    )

    # ── re-pack schema_context into a projected mirror ───────────────
    projected_schema = {
        "tables": projected_tables_dict,
        "relations": schema_context.get("relations", []),
        "json_structures": schema_context.get("json_structures", {}),
        "available_tables": list(allowed_tables_hint),
    }

    return GroundingContext(
        app_id=app_id,
        user_message=user_message,
        intent_class=intent_class,
        allowed_layers=allowed_layers,
        projected_tables=projected_table_names,
        projected_schema=projected_schema,
        projected_role_hints=projected_role_hints,
        allowed_tables_hint=allowed_tables_hint,
        original_table_count=original_table_count,
        projected_table_count=len(projected_tables_dict),
    )


__all__ = ["GroundingContext", "project_for_intent"]
