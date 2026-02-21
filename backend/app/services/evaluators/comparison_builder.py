"""Deep field-level comparison builder for API flow critique.

Replaces the coarse top-level-key JSON dump with a structured, pre-aligned
comparison. Array items are matched by a key field (e.g., medication name),
then individual sub-properties are compared. The LLM receives flat, concrete
per-field comparisons and only needs to judge clinical equivalence.

Path format: index-based for items in API data (rx.medications[0].dosage),
name-based only for judge-only items (rx.medications[Crocin]).
"""
import json
from dataclasses import dataclass


@dataclass
class ComparisonEntry:
    """One field-level comparison line for prompt injection."""
    field_path: str       # "rx.medications[0].dosage"
    api_value: str        # Stringified value from API
    judge_value: str      # Stringified value from Judge
    match_hint: str       # "match" | "mismatch" | "api_only" | "judge_only"
    item_name: str = ""   # Key-field value for array items (for LLM context)


# ═══════════════════════════════════════════════════════════════
# Field configuration — defines how each rx key is compared
# ═══════════════════════════════════════════════════════════════

# Array fields: match items by key, then compare sub-fields
ARRAY_FIELD_CONFIG = {
    "medications": {
        "key": "name",
        "fields": ["dosage", "frequency", "duration", "quantity", "schedule", "notes"],
    },
    "symptoms": {
        "key": "name",
        "fields": ["notes", "duration", "severity"],
    },
    "diagnosis": {
        "key": "name",
        "fields": ["notes", "since", "status"],
    },
    "medicalHistory": {
        "key": "name",
        "fields": ["type", "notes", "duration", "relation"],
    },
    "labResults": {
        "key": "testname",
        "fields": ["value"],
    },
    "labInvestigation": {
        "key": "testname",
        "fields": [],
    },
}

# Object fields: compare each sub-key individually
OBJECT_FIELD_CONFIG = {
    "vitalsAndBodyComposition": [
        "bloodPressure", "pulse", "temperature", "weight",
        "height", "spo2", "respRate", "ofc",
    ],
}

# Scalar fields: direct compare
SCALAR_FIELDS = ["followUp"]

# String arrays: compare as ordered lists
STRING_ARRAY_FIELDS = ["advice"]


# ═══════════════════════════════════════════════════════════════
# Value stringification
# ═══════════════════════════════════════════════════════════════

def _stringify(val) -> str:
    """Convert any value to a stable string for comparison display."""
    if val is None:
        return "(empty)"
    if isinstance(val, str):
        return val.strip() if val.strip() else "(empty)"
    if isinstance(val, (list, dict)):
        if not val:
            return "(empty)"
        return json.dumps(val, ensure_ascii=False)
    return str(val)


def _normalize_key(val: str) -> str:
    """Normalize a key value for matching: lowercase, strip whitespace."""
    return val.strip().lower()


# ═══════════════════════════════════════════════════════════════
# Array field comparison
# ═══════════════════════════════════════════════════════════════

def _build_index(items: list, key_field: str) -> dict[str, tuple[int, dict]]:
    """Build index: {normalized_key: (array_position, item_dict)}."""
    index: dict[str, tuple[int, dict]] = {}
    for i, item in enumerate(items):
        if isinstance(item, dict):
            raw_key = item.get(key_field, "")
            if raw_key:
                index[_normalize_key(str(raw_key))] = (i, item)
    return index


def _compare_array_field(
    field_name: str,
    api_items: list,
    judge_items: list,
    key_field: str,
    sub_fields: list[str],
) -> list[ComparisonEntry]:
    """Match array items by key, then compare sub-fields.

    Uses API array index for paths when the item exists in API data.
    Falls back to name-based path for judge-only items.
    """
    entries: list[ComparisonEntry] = []

    api_index = _build_index(api_items, key_field)
    judge_index = _build_index(judge_items, key_field)

    all_keys = list(dict.fromkeys(
        list(api_index.keys()) + list(judge_index.keys())
    ))

    for norm_key in all_keys:
        api_entry = api_index.get(norm_key)
        judge_entry = judge_index.get(norm_key)

        api_idx = api_entry[0] if api_entry else None
        api_item = api_entry[1] if api_entry else None
        judge_item = judge_entry[1] if judge_entry else None

        # Display key from whichever side has it
        display_key = (
            (api_item or judge_item or {}).get(key_field, norm_key)
        )

        if api_item and judge_item:
            # Both have this item — compare sub-fields using API index
            if sub_fields:
                for sf in sub_fields:
                    api_val = _stringify(api_item.get(sf))
                    judge_val = _stringify(judge_item.get(sf))
                    hint = "match" if api_val == judge_val else "mismatch"
                    entries.append(ComparisonEntry(
                        field_path=f"rx.{field_name}[{api_idx}].{sf}",
                        api_value=api_val,
                        judge_value=judge_val,
                        match_hint=hint,
                        item_name=str(display_key),
                    ))
            else:
                # No sub-fields configured — just confirm presence
                entries.append(ComparisonEntry(
                    field_path=f"rx.{field_name}[{api_idx}]",
                    api_value=_stringify(api_item.get(key_field)),
                    judge_value=_stringify(judge_item.get(key_field)),
                    match_hint="match",
                    item_name=str(display_key),
                ))
        elif api_item:
            # API-only item — use API index
            entries.append(ComparisonEntry(
                field_path=f"rx.{field_name}[{api_idx}]",
                api_value=_stringify(display_key),
                judge_value="(not found)",
                match_hint="api_only",
                item_name=str(display_key),
            ))
        else:
            # Judge-only item — no API index, use name
            entries.append(ComparisonEntry(
                field_path=f"rx.{field_name}[{display_key}]",
                api_value="(not found)",
                judge_value=_stringify(display_key),
                match_hint="judge_only",
                item_name=str(display_key),
            ))

    return entries


# ═══════════════════════════════════════════════════════════════
# Object / scalar / string-array comparison
# ═══════════════════════════════════════════════════════════════

def _compare_object_field(
    field_name: str,
    api_obj: dict,
    judge_obj: dict,
    sub_keys: list[str],
) -> list[ComparisonEntry]:
    """Compare each sub-key of an object field."""
    entries: list[ComparisonEntry] = []
    for sk in sub_keys:
        api_val = _stringify(api_obj.get(sk))
        judge_val = _stringify(judge_obj.get(sk))
        hint = "match" if api_val == judge_val else "mismatch"
        entries.append(ComparisonEntry(
            field_path=f"rx.{field_name}.{sk}",
            api_value=api_val,
            judge_value=judge_val,
            match_hint=hint,
        ))
    return entries


def _compare_scalar_field(
    field_name: str,
    api_val,
    judge_val,
) -> ComparisonEntry:
    """Direct comparison of a scalar field."""
    a = _stringify(api_val)
    j = _stringify(judge_val)
    hint = "match" if a == j else "mismatch"
    return ComparisonEntry(
        field_path=f"rx.{field_name}",
        api_value=a,
        judge_value=j,
        match_hint=hint,
    )


def _compare_string_array_field(
    field_name: str,
    api_items: list,
    judge_items: list,
) -> list[ComparisonEntry]:
    """Compare string arrays as ordered lists."""
    entries: list[ComparisonEntry] = []
    max_len = max(len(api_items), len(judge_items))
    for i in range(max_len):
        api_val = _stringify(api_items[i]) if i < len(api_items) else "(empty)"
        judge_val = _stringify(judge_items[i]) if i < len(judge_items) else "(empty)"
        hint = "match" if api_val == judge_val else "mismatch"
        entries.append(ComparisonEntry(
            field_path=f"rx.{field_name}[{i}]",
            api_value=api_val,
            judge_value=judge_val,
            match_hint=hint,
        ))
    return entries


# ═══════════════════════════════════════════════════════════════
# Main entry points
# ═══════════════════════════════════════════════════════════════

def build_deep_comparison(api_rx: dict, judge_rx: dict) -> list[ComparisonEntry]:
    """Main entry point. Returns flat list of per-field comparison entries."""
    entries: list[ComparisonEntry] = []

    # 1. Array fields
    for field_name, config in ARRAY_FIELD_CONFIG.items():
        api_items = api_rx.get(field_name, [])
        judge_items = judge_rx.get(field_name, [])
        if not isinstance(api_items, list):
            api_items = []
        if not isinstance(judge_items, list):
            judge_items = []
        if api_items or judge_items:
            entries.extend(_compare_array_field(
                field_name=field_name,
                api_items=api_items,
                judge_items=judge_items,
                key_field=config["key"],
                sub_fields=config["fields"],
            ))

    # 2. Object fields
    for field_name, sub_keys in OBJECT_FIELD_CONFIG.items():
        api_obj = api_rx.get(field_name, {})
        judge_obj = judge_rx.get(field_name, {})
        if not isinstance(api_obj, dict):
            api_obj = {}
        if not isinstance(judge_obj, dict):
            judge_obj = {}
        if api_obj or judge_obj:
            entries.extend(_compare_object_field(
                field_name=field_name,
                api_obj=api_obj,
                judge_obj=judge_obj,
                sub_keys=sub_keys,
            ))

    # 3. Scalar fields
    for field_name in SCALAR_FIELDS:
        api_val = api_rx.get(field_name)
        judge_val = judge_rx.get(field_name)
        if api_val is not None or judge_val is not None:
            entries.append(_compare_scalar_field(field_name, api_val, judge_val))

    # 4. String array fields
    for field_name in STRING_ARRAY_FIELDS:
        api_items = api_rx.get(field_name, [])
        judge_items = judge_rx.get(field_name, [])
        if not isinstance(api_items, list):
            api_items = []
        if not isinstance(judge_items, list):
            judge_items = []
        if api_items or judge_items:
            entries.extend(_compare_string_array_field(
                field_name=field_name,
                api_items=api_items,
                judge_items=judge_items,
            ))

    return entries


def format_comparison_for_prompt(entries: list[ComparisonEntry]) -> str:
    """Format entries into structured text for prompt injection.

    Output format per entry:
      [N] FIELD: rx.medications[0].dosage
          ITEM:  Amoxicillin
          API:   500mg
          JUDGE: 500 mg
          HINT:  match
    """
    if not entries:
        return "(no structured data fields to compare)"

    lines: list[str] = []
    for i, entry in enumerate(entries, 1):
        block = f"[{i}] FIELD: {entry.field_path}\n"
        if entry.item_name:
            block += f"    ITEM:  {entry.item_name}\n"
        block += (
            f"    API:   {entry.api_value}\n"
            f"    JUDGE: {entry.judge_value}\n"
            f"    HINT:  {entry.match_hint}"
        )
        lines.append(block)
    return "\n\n".join(lines)
