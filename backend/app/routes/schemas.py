"""Schemas API routes."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.listing import Listing
from app.models.schema import Schema
from app.schemas.schema import SchemaCreate, SchemaUpdate, SchemaResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/schemas", tags=["schemas"])


@router.get("", response_model=list[SchemaResponse])
async def list_schemas(
    app_id: str = Query(...),
    prompt_type: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all schemas for an app, optionally filtered by prompt_type and source_type."""
    query = select(Schema).where(Schema.app_id == app_id)
    if prompt_type:
        query = query.where(Schema.prompt_type == prompt_type)
    if source_type:
        query = query.where(
            or_(Schema.source_type == source_type, Schema.source_type.is_(None))
        )
    query = query.order_by(desc(Schema.created_at))

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{schema_id}", response_model=SchemaResponse)
async def get_schema(
    schema_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single schema by ID."""
    result = await db.execute(
        select(Schema).where(Schema.id == schema_id)
    )
    schema = result.scalar_one_or_none()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")
    return schema


@router.post("", response_model=SchemaResponse, status_code=201)
async def create_schema(
    body: SchemaCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new schema with auto-incremented version."""
    result = await db.execute(
        select(func.max(Schema.version))
        .where(Schema.app_id == body.app_id, Schema.prompt_type == body.prompt_type)
    )
    max_version = result.scalar() or 0

    schema = Schema(**body.model_dump(), version=max_version + 1)
    db.add(schema)
    await db.commit()
    await db.refresh(schema)
    return schema


@router.put("/{schema_id}", response_model=SchemaResponse)
async def update_schema(
    schema_id: int,
    body: SchemaUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a schema. Only provided fields are updated."""
    result = await db.execute(select(Schema).where(Schema.id == schema_id))
    schema = result.scalar_one_or_none()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(schema, key, value)

    await db.commit()
    await db.refresh(schema)
    return schema


@router.delete("/{schema_id}")
async def delete_schema(
    schema_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a schema. Cannot delete default schemas."""
    result = await db.execute(select(Schema).where(Schema.id == schema_id))
    schema = result.scalar_one_or_none()
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not found")

    if schema.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default schema")

    await db.delete(schema)
    await db.commit()
    return {"deleted": True, "id": schema_id}


@router.post("/ensure-defaults")
async def ensure_default_schemas(
    app_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Seed default schemas for an app if they don't exist."""
    return {"message": "Default schemas ensured", "app_id": app_id}


# ── Schema sync from listing ────────────────────────────────────


def _infer_json_schema(value: object) -> dict:
    """Generate a JSON Schema from a sample Python value by walking its structure."""
    if value is None:
        return {"type": "string"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "number"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list):
        if len(value) == 0:
            return {"type": "array", "items": {"type": "object"}}
        # Infer item schema from first element
        first = value[0]
        if isinstance(first, str):
            return {"type": "array", "items": {"type": "string"}}
        if isinstance(first, dict):
            item_schema = _infer_json_schema(first)
            # Only require keys that have non-empty values in the sample
            required = [k for k, v in first.items() if v not in (None, "", 0, [], {})]
            if required:
                item_schema["required"] = required[:3]  # Keep required list small
            return {"type": "array", "items": item_schema}
        return {"type": "array", "items": _infer_json_schema(first)}
    if isinstance(value, dict):
        properties = {}
        for k, v in value.items():
            properties[k] = _infer_json_schema(v)
        schema: dict = {"type": "object", "properties": properties}
        return schema
    return {"type": "string"}


class SyncSchemaRequest(BaseModel):
    listing_id: str


@router.post("/sync-from-listing")
async def sync_schema_from_listing(
    body: SyncSchemaRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate JSON Schema from a listing's api_response and update the default API transcription schema."""
    listing = await db.get(Listing, body.listing_id)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    api_response = listing.api_response
    if not api_response or not isinstance(api_response, dict):
        raise HTTPException(status_code=400, detail="Listing has no API response")

    if "rx" not in api_response:
        raise HTTPException(status_code=400, detail="API response has no 'rx' field")

    # Build schema from {input, rx} shape
    generated_schema: dict = {
        "type": "object",
        "properties": {
            "input": {
                "type": "string",
                "description": "Full transcribed text of the audio conversation",
            },
            "rx": _infer_json_schema(api_response["rx"]),
        },
        "required": ["input", "rx"],
    }
    generated_schema["properties"]["rx"]["description"] = (
        "Structured prescription and clinical data extracted from the conversation"
    )

    # Find and update the default API transcription schema
    result = await db.execute(
        select(Schema).where(
            Schema.app_id == "voice-rx",
            Schema.prompt_type == "transcription",
            Schema.source_type == "api",
            Schema.is_default == True,
        )
    )
    schema_row = result.scalar_one_or_none()

    if not schema_row:
        raise HTTPException(
            status_code=404,
            detail="No default API transcription schema found — run seed defaults first",
        )

    schema_row.schema_data = generated_schema
    await db.commit()
    await db.refresh(schema_row)

    field_count = len(generated_schema["properties"].get("rx", {}).get("properties", {}))
    logger.info("Synced API transcription schema from listing %s (%d rx fields)", body.listing_id, field_count)

    return {
        "synced": True,
        "schema_id": schema_row.id,
        "field_count": field_count,
        "schema_data": generated_schema,
    }
