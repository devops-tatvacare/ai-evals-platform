"""Substitute manifest-derived vocabulary into tool specs.

Tools in tool_definitions.py can embed the tokens:
    {{catalog_tables}} — comma-separated declared catalog table names
    {{surface_keys}}   — comma-separated declared data-surface keys

These are substituted at resolve_tools() time using the app's manifest so the
agent only ever sees the real per-app vocabulary.
"""
from __future__ import annotations

import copy
from typing import Any

from app.services.chat_engine.manifest import get_manifest


def _substitute(text: str, *, catalog_tables: str, surface_keys: str) -> str:
    return (
        text
        .replace("{{catalog_tables}}", catalog_tables)
        .replace("{{surface_keys}}", surface_keys)
    )


def fill_tool_description(tool_spec: dict[str, Any], *, app_id: str) -> dict[str, Any]:
    """Return a deep copy of `tool_spec` with manifest tokens substituted."""
    manifest = get_manifest(app_id)
    catalog_tables = ", ".join(sorted(manifest.catalog_tables.keys()))
    surface_keys = ", ".join(s.key for s in manifest.data_surfaces)

    filled = copy.deepcopy(tool_spec)
    if isinstance(filled.get("description"), str):
        filled["description"] = _substitute(
            filled["description"],
            catalog_tables=catalog_tables,
            surface_keys=surface_keys,
        )
    props = filled.get("inputSchema", {}).get("properties", {})
    for prop in props.values():
        if isinstance(prop, dict) and isinstance(prop.get("description"), str):
            prop["description"] = _substitute(
                prop["description"],
                catalog_tables=catalog_tables,
                surface_keys=surface_keys,
            )
    return filled
