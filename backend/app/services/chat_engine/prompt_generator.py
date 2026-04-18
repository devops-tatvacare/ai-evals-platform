"""Render the system-prompt TOOLS block from the app manifest.

Kept deliberately short: the prose is identical across apps, only the
per-app vocabulary (catalog tables, data-surface keys) is interpolated.
"""
from __future__ import annotations

from app.services.chat_engine.manifest import get_manifest


def render_tools_section(*, app_id: str) -> str:
    m = get_manifest(app_id)
    tables = sorted(m.catalog_tables.keys())
    surfaces = [s.key for s in m.data_surfaces]
    return (
        "TOOLS:\n\n"
        f"Catalog tables available to you: {', '.join(tables)}.\n"
        f"Data surfaces available: {', '.join(surfaces)}.\n\n"
        "1. catalog_inspect(table, column?) — live schema for one declared catalog table.\n"
        "2. catalog_relations(table) — foreign-key paths between declared catalog tables.\n"
        "3. catalog_values(table, column, search?, limit?) — distinct values for one column.\n"
        "4. catalog_sample(table, column?, limit?) — sample rows; required for JSONB structure.\n"
        "5. discover() — dimensions, metrics, data volume, declared surface keys. Call first.\n"
        "6. lookup(dimension, search?, limit?) — resolve a partial entity name.\n"
        "7. resolve_entity(entity_type, search) — resolve a partial ID or name to canonical value.\n"
        "8. get_surface_records(surface_key, ...) — raw evidence by surface key (one of those listed above).\n"
        "9. data_check(table, filters?) — row availability on a declared catalog table.\n"
        "10. data_query(question) — structured analytics; returns rows, column roles, chart suggestion.\n"
        "11. Blueprint tools — blueprint_blocks / blueprint_compose / blueprint_save / blueprint_list.\n"
    )
