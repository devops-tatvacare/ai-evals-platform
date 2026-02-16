"""Schemas API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.schema import Schema
from app.schemas.schema import SchemaCreate, SchemaUpdate, SchemaResponse

router = APIRouter(prefix="/api/schemas", tags=["schemas"])


@router.get("", response_model=list[SchemaResponse])
async def list_schemas(
    app_id: str = Query(...),
    prompt_type: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List all schemas for an app, optionally filtered by prompt_type."""
    query = select(Schema).where(Schema.app_id == app_id)
    if prompt_type:
        query = query.where(Schema.prompt_type == prompt_type)
    query = query.order_by(desc(Schema.created_at))
    
    result = await db.execute(query)
    schemas = result.scalars().all()
    return [_to_response(s) for s in schemas]


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
    return _to_response(schema)


@router.post("", response_model=SchemaResponse, status_code=201)
async def create_schema(
    body: SchemaCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new schema with auto-incremented version."""
    # Get current max version for this app_id + prompt_type
    result = await db.execute(
        select(func.max(Schema.version))
        .where(Schema.app_id == body.app_id, Schema.prompt_type == body.prompt_type)
    )
    max_version = result.scalar() or 0
    
    schema = Schema(**body.model_dump(), version=max_version + 1)
    db.add(schema)
    await db.commit()
    await db.refresh(schema)
    return _to_response(schema)


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
    return _to_response(schema)


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
    # This is a placeholder - in a real implementation, you would define
    # default schemas for each prompt_type and insert them if missing
    return {"message": "Default schemas ensured", "app_id": app_id}


def _to_response(schema: Schema) -> dict:
    """Convert SQLAlchemy model to response dict."""
    return {
        "id": schema.id,
        "app_id": schema.app_id,
        "prompt_type": schema.prompt_type,
        "version": schema.version,
        "name": schema.name,
        "schema_data": schema.schema_data,
        "description": schema.description,
        "is_default": schema.is_default,
        "created_at": schema.created_at,
        "updated_at": schema.updated_at,
        "user_id": schema.user_id,
    }
