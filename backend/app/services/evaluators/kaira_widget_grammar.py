"""Kaira widget grammar — single source of truth for widget kinds, chunk types,
inline sentinel markers, and confirmation wire formats.

MUST stay in sync with the FE mirror at `src/services/kaira/widgetGrammar.ts`.
Adding a new widget = one entry in WIDGET_REGISTRY here + one entry there +
one renderer in src/features/evalRuns/components/widgets/index.ts.

Reviewer enforcement: any change to wire strings, chunk_types, or sentinel
markers must touch both files in the same commit.

Verified upstream contract (kaira-ai/api/routes.py @ uat 2026-05-08):
  - food_card single   → SSE chunk type="food_card", data={items, consumed_at, consumed_label}
  - food_card batch    → SSE chunk type="food_card", data={isBatch:true, sessions:[...]}
  - bp_card            → SSE chunk type="bp_card",   data={...}
  - vitals_card        → SSE chunk type="vitals_card", data={...}
  - confirmation grammars:
      meal (single+batch): "update_meal & log_meal - <json.dumps(list_of_sessions)>"
      bp:                  literal text "yes log this bp reading"
      vitals:              literal text "yes, save these"
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ─── Data classes ──────────────────────────────────────────────────────────

@dataclass
class KairaWidget:
    """Captured widget payload from a Kaira SSE chunk.

    `kind` is the registry key; for unknown chunk types `kind == raw_chunk_type`
    and `is_known == False` so callers can branch (auto-confirm vs forward-compat).
    """

    kind: str
    data: Dict[str, Any]
    raw_chunk_type: str
    is_known: bool = True

    def to_jsonable(self) -> Dict[str, Any]:
        return {"kind": self.kind, "data": self.data, "is_known": self.is_known}


@dataclass(frozen=True)
class WidgetSpec:
    """Registry row describing one widget kind."""

    kind: str
    chunk_types: Tuple[str, ...]
    sentinel_open: Optional[str]
    sentinel_close: Optional[str]
    confirm_wire_builder: Callable[[Dict[str, Any]], str]
    confirm_label: str
    confirm_verbs: Optional[Tuple[str, ...]] = None  # None for literal-text confirms
    is_batch_of: Optional[str] = None                # if set, this kind unwraps `data.sessions`


# ─── Wire builders ─────────────────────────────────────────────────────────

def _meal_single_wire(data: Dict[str, Any]) -> str:
    """`update_meal & log_meal - [<food_card>]` — single meal."""
    return f"update_meal & log_meal - {json.dumps([data])}"


def _meal_batch_wire(data: Dict[str, Any]) -> str:
    """`update_meal & log_meal - <sessions>` — batch unwraps data.sessions.

    The upstream `_parse_action_log_payload` validates each list element as
    ActionMealSession (items/consumed_at/consumed_label), so we strip the
    {isBatch, sessions} wrapper and send the bare sessions list.
    """
    sessions = data.get("sessions") or []
    if not isinstance(sessions, list):
        raise ValueError(f"food_card_batch.data.sessions must be list, got {type(sessions)}")
    return f"update_meal & log_meal - {json.dumps(sessions)}"


def _bp_wire(_data: Dict[str, Any]) -> str:
    return "yes log this bp reading"


def _vitals_wire(_data: Dict[str, Any]) -> str:
    return "yes, save these"


# ─── Registry ──────────────────────────────────────────────────────────────

WIDGET_REGISTRY: Dict[str, WidgetSpec] = {
    "food_card": WidgetSpec(
        kind="food_card",
        chunk_types=("food_card",),
        sentinel_open="___FOOD_CARD___",
        sentinel_close="___END___",
        confirm_wire_builder=_meal_single_wire,
        confirm_label="Yes log this meal",
        confirm_verbs=("update_meal", "log_meal"),
    ),
    "food_card_batch": WidgetSpec(
        kind="food_card_batch",
        # No own chunk_type — derived from food_card chunk where data.isBatch is True.
        chunk_types=(),
        sentinel_open="___MULTI_FOOD_CARD___",
        sentinel_close="___END___",
        confirm_wire_builder=_meal_batch_wire,
        confirm_label="Yes log all meals",
        confirm_verbs=("update_meal", "log_meal"),
        is_batch_of="food_card",
    ),
    "bp_card": WidgetSpec(
        kind="bp_card",
        chunk_types=("bp_card",),
        sentinel_open="___BP_CARD___",
        sentinel_close="___END___",
        confirm_wire_builder=_bp_wire,
        confirm_label="Yes log this BP reading",
        confirm_verbs=None,
    ),
    "vitals_card": WidgetSpec(
        kind="vitals_card",
        chunk_types=("vitals_card",),
        sentinel_open="___VITALS_CARD___",
        sentinel_close="___END___",
        confirm_wire_builder=_vitals_wire,
        confirm_label="Yes, save these",
        confirm_verbs=None,
    ),
}

# Strip-only: token-stream markers we remove but never produce a widget for.
# Used by the sentinel stripper in the platform's frontend so prose stays clean.
STRIP_ONLY_SENTINELS: List[Tuple[str, str]] = [
    ("___SESSION_STATE___", "___END_SS___"),
]


# ─── Lookup helpers ────────────────────────────────────────────────────────

def widget_from_chunk(chunk: Dict[str, Any]) -> Optional[KairaWidget]:
    """Build a KairaWidget from one SSE chunk, or None if the chunk is not a widget.

    Known control chunks (`classification`, `token`, `done`, `error`) return None.
    Unknown structured chunk types (anything ending in `_card` or carrying a `data`
    object that isn't recognized control) get a forward-compat KairaWidget with
    is_known=False, so callers can persist them and graders can flag them.
    """
    chunk_type = chunk.get("type")
    if not chunk_type or chunk_type in {"classification", "token", "done", "error"}:
        return None

    raw_data = chunk.get("data")
    raw_data_was_dict = isinstance(raw_data, dict)
    data = raw_data if raw_data_was_dict else {}
    if not raw_data_was_dict and raw_data is None:
        # Unknown chunk with no `data` payload — preserve raw chunk minus type
        data = {k: v for k, v in chunk.items() if k != "type"}

    if not isinstance(data, dict):
        # Defensive: upstream sent something we can't introspect
        return None

    # Known kind by chunk_type? Refuse known-kind widgets without a usable
    # `data` dict — auto-confirm would build a malformed wire string. Unknown
    # kinds still take the forward-compat path so the chunk is preserved for
    # forensics, but they don't auto-confirm anyway (is_known=False).
    for spec in WIDGET_REGISTRY.values():
        if chunk_type in spec.chunk_types:
            if not raw_data_was_dict:
                logger.warning(
                    "Known Kaira widget chunk type=%r arrived without a usable "
                    "`data` object — refusing to surface as a widget",
                    chunk_type,
                )
                return None
            # Promote food_card → food_card_batch when isBatch is set
            if spec.kind == "food_card" and data.get("isBatch") is True:
                return KairaWidget(
                    kind="food_card_batch",
                    data=data,
                    raw_chunk_type=chunk_type,
                    is_known=True,
                )
            return KairaWidget(
                kind=spec.kind,
                data=data,
                raw_chunk_type=chunk_type,
                is_known=True,
            )

    # Forward-compat: unknown chunk type, preserve for forensics + grading
    logger.warning(
        "Unknown Kaira widget chunk type=%r — forward-compat path engaged",
        chunk_type,
    )
    return KairaWidget(
        kind=chunk_type,
        data=data,
        raw_chunk_type=chunk_type,
        is_known=False,
    )


def confirm_message_for(widget: KairaWidget) -> Tuple[str, Dict[str, Any]]:
    """Return (wire_message, action_descriptor) for a widget.

    Raises ValueError if widget kind is not registered (unknown widgets cannot
    be auto-confirmed — caller must skip the confirm turn).
    """
    spec = WIDGET_REGISTRY.get(widget.kind)
    if spec is None:
        raise ValueError(
            f"Cannot build confirm message for unknown widget kind={widget.kind!r}; "
            "register a WidgetSpec first."
        )
    wire = spec.confirm_wire_builder(widget.data)
    descriptor: Dict[str, Any] = {
        "kind": widget.kind,
        "label": spec.confirm_label,
        "wire": wire,
    }
    if spec.confirm_verbs:
        descriptor["verbs"] = list(spec.confirm_verbs)
    descriptor["payload"] = widget.data
    return wire, descriptor


def all_sentinel_markers() -> List[Dict[str, Any]]:
    """All inline token-stream markers, both widget-bearing and strip-only.

    Returned as JSON-friendly dicts so the FE mirror can read the same shape.
    Keys:
      - kind: registry key, or "__strip_only__" for non-widget markers
      - open: opening marker
      - close: closing marker
      - is_widget: True for entries that carry a structured payload
    """
    out: List[Dict[str, Any]] = []
    for spec in WIDGET_REGISTRY.values():
        if spec.sentinel_open and spec.sentinel_close:
            out.append({
                "kind": spec.kind,
                "open": spec.sentinel_open,
                "close": spec.sentinel_close,
                "is_widget": True,
            })
    for open_m, close_m in STRIP_ONLY_SENTINELS:
        out.append({
            "kind": "__strip_only__",
            "open": open_m,
            "close": close_m,
            "is_widget": False,
        })
    return out


def is_known_kind(kind: str) -> bool:
    return kind in WIDGET_REGISTRY


# ─── Forward-compat: empty-default container so transcript.transport always
# has the field even on old records. Callers populate with widget.kind values.
@dataclass
class UnsupportedWidgetTrace:
    kinds: List[str] = field(default_factory=list)

    def add(self, kind: str) -> None:
        if kind not in self.kinds:
            self.kinds.append(kind)
