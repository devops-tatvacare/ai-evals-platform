"""CRM schema endpoint (Phase 11D).

``GET /api/analytics/crm-schema/{app_id}/{table_name}`` returns one
manifest ``CatalogTable`` as JSON — the structural columns plus the
composed ``attribute_schemas`` (for ``fact_lead_signal`` these are
DB-projected from ``analytics.signal_definition`` at manifest-load;
invariant 21 / §7.4). The schema-driven CRM workspace UI reads column
metadata from here instead of a hardcoded TypeScript file.

PII-tagged key NAMES are returned (the renderer needs them to know what
to mask); PII-tagged key VALUES are masked downstream in the list/detail
APIs per ``applications.config.crmWorkspace.piiVisibility``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import get_db
from app.schemas.base import CamelModel
from app.services.chat_engine.manifest import (
    AttributeKeySchema,
    CatalogTable,
    ManifestColumn,
    get_manifest,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class CrmSchemaColumn(CamelModel):
    role: str
    data_type: str | None = None
    semantic_type: str | None = None
    description: str | None = None
    synonyms: list[str] = []
    allowed_values: list[str | int | float | bool] = []
    measure_kind: str | None = None
    unit: str | None = None
    nullable: bool | None = None
    pii: bool = False


class CrmSchemaAttributeKey(CamelModel):
    data_type: str
    semantic_type: str | None = None
    description: str | None = None
    unit: str | None = None
    allowed_values: list[str | int | float | bool] = []
    synonyms: list[str] = []
    nullable: bool = True
    pii: bool = False


class CrmSchemaResponse(CamelModel):
    app_id: str
    table_name: str
    columns: dict[str, CrmSchemaColumn]
    # Outer key is the discriminator value (activity_type / signal_type /
    # to_stage; ``_default`` for tables with no discriminator).
    attribute_schemas: dict[str, dict[str, CrmSchemaAttributeKey]]


def _column(col: ManifestColumn) -> CrmSchemaColumn:
    return CrmSchemaColumn(
        role=col.role,
        data_type=col.data_type,
        semantic_type=col.semantic_type,
        description=col.description,
        synonyms=list(col.synonyms),
        allowed_values=list(col.allowed_values),
        measure_kind=col.measure_kind,
        unit=col.unit,
        nullable=col.nullable,
        pii=col.pii,
    )


def _attribute_key(key: AttributeKeySchema) -> CrmSchemaAttributeKey:
    return CrmSchemaAttributeKey(
        data_type=key.data_type,
        semantic_type=key.semantic_type,
        description=key.description,
        unit=key.unit,
        allowed_values=list(key.allowed_values),
        synonyms=list(key.synonyms),
        nullable=key.nullable,
        pii=key.pii,
    )


def _table_to_response(
    app_id: str, table_name: str, table: CatalogTable
) -> CrmSchemaResponse:
    return CrmSchemaResponse(
        app_id=app_id,
        table_name=table_name,
        columns={name: _column(col) for name, col in table.columns.items()},
        attribute_schemas={
            disc: {k: _attribute_key(v) for k, v in keys.items()}
            for disc, keys in table.attribute_schemas.items()
        },
    )


@router.get(
    "/crm-schema/{app_id}/{table_name}", response_model=CrmSchemaResponse
)
async def get_crm_schema(
    app_id: str,
    table_name: str,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> CrmSchemaResponse:
    """Return the manifest catalog entry for one CRM workspace table."""
    await ensure_registered_app_access(db, auth, app_id)
    try:
        manifest = get_manifest(app_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"No manifest for app {app_id!r}"
        )
    table = manifest.catalog_tables.get(table_name)
    if table is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Table {table_name!r} is not a declared catalog table for "
                f"app {app_id!r}"
            ),
        )
    return _table_to_response(app_id, table_name, table)
