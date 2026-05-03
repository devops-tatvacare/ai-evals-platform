"""Phase 11 — normalize legacy workflow definitions to the canonical shape.

This is the single place where pre-Phase-11 saved definitions get rewritten
into the Phase 11 canonical contract:

  - persisted edge ``label`` -> ``output_id``
  - source-node ``next_node_id`` removed (engine reads from outgoing edge)
  - ``logic.split`` branches given stable ``id``s; edges rewritten to use
    those ids when they previously routed by label
  - ``logic.split`` ``default_branch`` (label) -> ``default_branch_id``
  - ``logic.wait`` legacy duration / until_datetime promoted to ``mode='duration'``
    / ``mode='until_datetime'`` (handler validators tolerate the same coercion;
    this layer makes the persisted shape canonical so the validator and
    builder see one form)
  - ``logic.merge.dedupe`` -> ``merge_policy`` + ``payload_policy``
  - ``filter.consent_gate.require_explicit_optin`` -> ``consent_policy`` enum
  - ``source.cohort_query`` ``source_table`` + ``id_column`` -> ``source_ref``
    where the source catalog has a matching entry
  - ``source.cohort_query`` ``payload_columns`` -> ``payload_fields``
  - retry-capable dispatch node legacy ``failed`` outgoing edges ->
    ``exhausted`` (Phase 11 §6.6) — only when the descriptor declares
    ``supports_attempt_policy``; mutation nodes keep ``failed`` edges
    untouched
  - ``core.webhook_out`` legacy ``body_template`` (string) ->
    structured ``body`` (Phase 11 §6.6); when the legacy template parses
    as JSON each ``"{{name}}"`` whole-string leaf becomes
    ``{"$payload": "name"}``. Templates that don't parse as JSON are
    preserved as a string body — the validator surfaces them so an
    operator can re-author them safely.

The normalizer is **lossless** for valid legacy definitions. If a transform
cannot be applied losslessly (e.g. a split edge references a label not
present in the branches list), the normalizer leaves the definition
untouched and the validator surfaces a structured error at publish time —
silently reinterpreting a broken definition is worse than failing loudly.

Idempotent: running ``normalize_definition`` on an already-canonical
definition is a no-op (modulo dict ordering).

Used by:
  - ``versions.publish_version`` — pre-publish normalization
  - ``traversal.RunExecutor`` — at-runtime read of older saved definitions
  - the seed loader — rewrites system seed JSON to canonical on load
"""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from app.services.orchestration.request_body_contract import migrate_legacy_body_template
from app.services.orchestration.source_catalog import reverse_lookup_by_table


# Retry-capable dispatch node types that adopted ``success`` / ``exhausted``
# outputs in Phase 11 (Commit 2). Legacy edges with ``output_id='failed'``
# from these node types are rewritten to ``output_id='exhausted'``.
_RETRY_CAPABLE_NODE_TYPES: frozenset[str] = frozenset({
    "core.webhook_out",
    "crm.send_wati",
    "crm.place_bolna_call",
    "crm.send_sms",
    "clinical.schedule_lab",
    "clinical.assign_care_team_task",
    "clinical.send_pro_assessment",
    "clinical.escalation_uptier",
})


_BRANCH_ID_SAFE_RE = re.compile(r"[^a-zA-Z0-9_]+")


def _slugify_branch_id(label: str, taken: set[str]) -> str:
    """Produce a stable id from a branch label, deduped against ``taken``.

    The id mirrors the label closely so legacy edges referencing the label
    can be deterministically rewritten — no hashing or random suffixes.
    """
    base = _BRANCH_ID_SAFE_RE.sub("_", label.strip()) or "branch"
    if base[0].isdigit():
        base = f"b_{base}"
    candidate = base
    n = 1
    while candidate in taken:
        n += 1
        candidate = f"{base}_{n}"
    taken.add(candidate)
    return candidate


def _normalize_split_node(node: dict[str, Any], edges: list[dict[str, Any]]) -> None:
    """Rewrite a logic.split node + its outgoing edges in place."""
    cfg = node.setdefault("config", {})
    branches = cfg.get("branches") or []
    if not branches:
        return

    # Skip if every branch already has an id and edges reference branch ids.
    if all(isinstance(b, dict) and b.get("id") for b in branches):
        # Coerce legacy default_branch (label) -> default_branch_id (id) if needed.
        if "default_branch" in cfg and "default_branch_id" not in cfg:
            label = cfg.pop("default_branch")
            for b in branches:
                if b.get("label") == label or b.get("id") == label:
                    cfg["default_branch_id"] = b["id"]
                    break
        return

    # Assign ids based on labels; map old label -> new id for edge rewrite.
    taken: set[str] = set()
    label_to_id: dict[str, str] = {}
    for b in branches:
        if not isinstance(b, dict):
            continue
        label = b.get("label") or b.get("id") or "branch"
        bid = b.get("id") or _slugify_branch_id(label, taken)
        b["id"] = bid
        b.setdefault("label", label)
        label_to_id[label] = bid

    if "default_branch" in cfg and "default_branch_id" not in cfg:
        old = cfg.pop("default_branch")
        cfg["default_branch_id"] = label_to_id.get(old, old)

    # Rewrite outgoing edges that previously routed by label.
    for e in edges:
        if e.get("source") != node.get("id"):
            continue
        # Edges already in canonical form (output_id present) are left alone.
        if e.get("output_id"):
            continue
        old = e.get("label")
        if old and old in label_to_id:
            e["output_id"] = label_to_id[old]


def _normalize_wait_node(node: dict[str, Any]) -> None:
    cfg = node.setdefault("config", {})
    if "mode" in cfg:
        return
    if cfg.get("duration_hours") is not None:
        cfg["mode"] = "duration"
    elif cfg.get("until_datetime") is not None:
        cfg["mode"] = "until_datetime"


def _normalize_merge_node(node: dict[str, Any]) -> None:
    cfg = node.setdefault("config", {})
    if "merge_policy" in cfg or "payload_policy" in cfg:
        cfg.setdefault("payload_policy", "last_wins")
        return
    if "dedupe" in cfg:
        cfg["merge_policy"] = "dedupe" if cfg.pop("dedupe") else "last_wins"
        cfg["payload_policy"] = "last_wins"


def _normalize_consent_gate_node(node: dict[str, Any]) -> None:
    cfg = node.setdefault("config", {})
    if "consent_policy" in cfg:
        return
    if "require_explicit_optin" in cfg:
        cfg["consent_policy"] = (
            "explicit_optin" if cfg.pop("require_explicit_optin") else "permissive"
        )


def _normalize_cohort_query_node(node: dict[str, Any]) -> None:
    cfg = node.setdefault("config", {})
    # ``next_node_id`` is graph-derived under Phase 11 — drop from authoring config.
    cfg.pop("next_node_id", None)
    # Promote legacy payload_columns to payload_fields.
    if cfg.get("payload_columns") and not cfg.get("payload_fields"):
        cfg["payload_fields"] = list(cfg.pop("payload_columns"))
    # Promote legacy source_table + id_column to source_ref where the catalog matches.
    # Phase 12: dataset.<uuid> source_refs have no legacy ``source_table`` form
    # and are not in ``_CATALOG`` — explicitly skip the rewrite path so a
    # reverse_lookup_by_table miss does not overwrite a valid value.
    source_ref = cfg.get("source_ref")
    if source_ref:
        return
    table = cfg.get("source_table")
    if not table:
        return
    entry = reverse_lookup_by_table(table)
    if entry is None:
        return  # leave back-compat fields in place; validator may still allow them
    cfg["source_ref"] = entry.source_ref
    cfg.pop("source_table", None)
    cfg.pop("id_column", None)


def _normalize_event_trigger_node(node: dict[str, Any]) -> None:
    cfg = node.setdefault("config", {})
    cfg.pop("next_node_id", None)


def _normalize_webhook_out_node(node: dict[str, Any]) -> None:
    """Lift legacy ``body_template`` (string) into structured ``body``.

    If both keys are present, ``body`` wins (it is the canonical key)
    and ``body_template`` is dropped. If only ``body_template`` is set,
    we run :func:`migrate_legacy_body_template` and store the result
    on ``body``.
    """
    cfg = node.setdefault("config", {})
    if "body" in cfg:
        cfg.pop("body_template", None)
        return
    legacy = cfg.pop("body_template", None)
    if legacy is None:
        return
    cfg["body"] = migrate_legacy_body_template(legacy if isinstance(legacy, str) else "")


_PER_TYPE_NORMALIZERS = {
    "source.cohort_query":  _normalize_cohort_query_node,
    "source.event_trigger": _normalize_event_trigger_node,
    "logic.wait":           _normalize_wait_node,
    "logic.merge":          _normalize_merge_node,
    "filter.consent_gate":  _normalize_consent_gate_node,
    "core.webhook_out":     _normalize_webhook_out_node,
}


def normalize_definition(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized deep copy of ``raw``. Idempotent on canonical input."""
    definition = deepcopy(raw or {})
    nodes: list[dict[str, Any]] = list(definition.get("nodes") or [])
    edges: list[dict[str, Any]] = list(definition.get("edges") or [])

    # Step 1: per-type config rewrites that don't touch edges.
    for node in nodes:
        node_type = node.get("type")
        normalizer = _PER_TYPE_NORMALIZERS.get(node_type or "")
        if normalizer is not None:
            normalizer(node)

    # Step 2: split nodes — assign branch ids and rewrite their outgoing
    # edges from labels to ids. Done after step 1 so any other config
    # tidying is already in place.
    for node in nodes:
        if node.get("type") == "logic.split":
            _normalize_split_node(node, edges)

    # Step 3: edges — rewrite legacy ``label`` to ``output_id`` for any edge
    # that doesn't already carry it. (Step 2 may have set output_id on some
    # split-edges; everything else falls through to here.)
    for e in edges:
        if not e.get("output_id"):
            label = e.get("label")
            if label is not None:
                e["output_id"] = label

    # Step 4: retry-capable dispatch nodes — migrate ``failed`` -> ``exhausted``.
    # Mutation nodes (lsq_*, emr_write) keep ``failed`` so this is safe to run
    # over every edge in the graph.
    nodes_by_id = {n["id"]: n for n in nodes if isinstance(n, dict) and n.get("id")}
    for e in edges:
        if e.get("output_id") != "failed":
            continue
        src = nodes_by_id.get(e.get("source"))
        if src is None:
            continue
        if src.get("type") in _RETRY_CAPABLE_NODE_TYPES:
            e["output_id"] = "exhausted"

    definition["nodes"] = nodes
    definition["edges"] = edges
    return definition


__all__ = ["normalize_definition"]
