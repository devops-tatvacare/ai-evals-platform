"""Render the system-prompt TOOLS block from registered capability packs.

Phase 4 §660: the per-tool description strings come from each pack's
``describe_tools(app_id)`` output — Harness Core never reaches into a pack's
manifest. The header still interpolates per-app vocabulary (catalog tables,
data-surface keys) from the manifest because that context is Harness Core's
to emit.
"""
from __future__ import annotations

from app.services.chat_engine.capability_pack import (
    CAPABILITY_PACK_REGISTRY,
    ensure_packs_registered,
)
from app.services.chat_engine.manifest import get_manifest


def _first_sentence(description: str) -> str:
    """Collapse a multi-line description to a single line for the TOOLS block."""
    text = description.strip().replace('\n', ' ')
    return ' '.join(text.split())


def render_tools_section(*, app_id: str) -> str:
    ensure_packs_registered()

    m = get_manifest(app_id)
    tables = sorted(m.catalog_tables.keys())
    surfaces = [s.key for s in m.data_surfaces]

    lines: list[str] = [
        'TOOLS:',
        '',
        f"Catalog tables available to you: {', '.join(tables)}.",
        f"Data surfaces available: {', '.join(surfaces)}.",
        '',
    ]

    index = 1
    for pack_id in sorted(CAPABILITY_PACK_REGISTRY):
        pack = CAPABILITY_PACK_REGISTRY[pack_id]
        described = pack.describe_tools(app_id)
        for tool_name, description in described.items():
            lines.append(f'{index}. {tool_name} — {_first_sentence(description)}')
            index += 1

    return '\n'.join(lines) + '\n'
