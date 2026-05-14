"""CRM workspace PII masking (Phase 11E).

A "lead" in the CRM workspace is a real person — the list/detail rows the
``/inside-sales/leads`` and ``/calls`` surfaces return literally carry
prospects' names, phone numbers, emails, cities, and call notes. Not every
role with analytics access should see those raw values.

**The manifest is the source of truth for what is PII.** This module reads
the ``pii: true`` tags off the app's manifest catalog table — both
top-level structural columns (``dim_lead.first_name`` etc.) and per-key
``attribute_schemas`` entries (``fact_lead_activity.attributes.phone_number``
etc.) — and masks those values unless the caller's role is on the
allow-list in ``applications.config.crmWorkspace.piiVisibility`` (a closed
key set, invariant 18). The field NAMES are never hidden — only values.

Default-off: an app with no ``piiVisibility`` configured is treated as
"masking not set up yet" and rows pass through unmasked. Owner role
bypasses. Masking only takes effect once an operator declares the
visibility map. The ``piiVisibility`` map is keyed by the manifest field
name (snake_case) — the same name the manifest declares the ``pii`` tag on.
"""
from __future__ import annotations

from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.models.application import Application
from app.models.role import AccessRole
from app.schemas.app_config import AppConfig
from app.services.chat_engine.manifest import get_manifest

_MASK = "•••••••"


def _to_camel(snake: str) -> str:
    """``first_name`` -> ``firstName``. Matches ``CamelModel``'s wire keys."""
    head, *rest = snake.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _manifest_pii_fields(app_id: str, table_name: str) -> tuple[set[str], set[str]]:
    """Return ``(column_pii, attribute_pii)`` for one manifest catalog table.

    ``column_pii`` is the set of snake_case structural column names tagged
    ``pii: true``; ``attribute_pii`` is the set of snake_case keys tagged
    ``pii: true`` across every ``attribute_schemas`` discriminator bucket.
    Empty sets when the app/table is not in the manifest — masking then
    no-ops, and the boot validator surfaces the missing manifest entry."""
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        return set(), set()
    table = manifest.catalog_tables.get(table_name)
    if table is None:
        return set(), set()
    column_pii = {name for name, col in table.columns.items() if col.pii}
    attribute_pii: set[str] = set()
    for bucket in table.attribute_schemas.values():
        attribute_pii |= {key for key, spec in bucket.items() if spec.pii}
    return column_pii, attribute_pii


async def _pii_visibility_for_app(
    db: AsyncSession, app_id: str
) -> dict[str, list[str]]:
    """Load ``crmWorkspace.piiVisibility`` for an app. Empty dict if the
    app is missing or has no config (= masking not configured)."""
    app = await db.scalar(
        select(Application).where(Application.slug == app_id)
    )
    if app is None:
        return {}
    try:
        config = AppConfig.model_validate(app.config or {})
    except Exception:
        # A malformed app config must not break the serving path; treat
        # it as "no masking configured" and let the config validator
        # surface the real problem elsewhere.
        return {}
    return dict(config.crm_workspace.pii_visibility)


async def mask_crm_pii(
    rows: Sequence[dict[str, Any]],
    *,
    table_name: str,
    auth: AuthContext,
    db: AsyncSession,
    app_id: str,
) -> list[dict[str, Any]]:
    """Mask PII values in CRM workspace rows by the caller's role.

    ``table_name`` is the manifest catalog table the rows were projected
    from (``dim_lead`` for leads, ``fact_lead_activity`` for calls). PII
    field names are read off that table's manifest ``pii`` tags — both
    structural columns and ``attributes`` JSONB keys.

    A field is masked unless the caller holds a role listed for its
    (snake_case) manifest name in the app's ``piiVisibility`` map. No-op
    when ``piiVisibility`` is empty (masking not configured) or the caller
    is Owner. Returns new dicts; inputs are not mutated."""
    materialized = [dict(r) for r in rows]
    if auth.is_owner:
        return materialized

    pii_visibility = await _pii_visibility_for_app(db, app_id)
    if not pii_visibility:
        return materialized

    column_pii, attribute_pii = _manifest_pii_fields(app_id, table_name)
    if not column_pii and not attribute_pii:
        return materialized

    role = await db.get(AccessRole, auth.role_id)
    role_name = role.name if role is not None else None

    def _allowed(field: str) -> bool:
        return role_name in pii_visibility.get(field, [])

    # Structural columns: manifest names are snake_case, the DTO keys are
    # camelCase (CamelModel wire shape).
    column_mask = {
        _to_camel(name): name for name in column_pii if not _allowed(name)
    }
    attribute_mask = {name for name in attribute_pii if not _allowed(name)}

    for row in materialized:
        for camel_key in column_mask:
            if row.get(camel_key) not in (None, ""):
                row[camel_key] = _MASK
        bag = row.get("attributes")
        if isinstance(bag, dict):
            masked_bag = dict(bag)
            for key in attribute_mask:
                if masked_bag.get(key) not in (None, ""):
                    masked_bag[key] = _MASK
            row["attributes"] = masked_bag
    return materialized
