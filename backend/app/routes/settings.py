"""Settings API routes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.setting import Setting
from app.schemas.setting import SettingCreate, SettingUpdate, SettingResponse

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=list[SettingResponse])
async def list_settings(
    app_id: str = Query(None),
    key: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """List settings, optionally filtered by app_id and/or key."""
    query = select(Setting)
    
    if app_id is not None:  # Allow empty string
        query = query.where(Setting.app_id == app_id)
    if key:
        query = query.where(Setting.key == key)
    
    result = await db.execute(query)
    settings = result.scalars().all()
    return [_to_response(s) for s in settings]


@router.get("/{setting_id}", response_model=SettingResponse)
async def get_setting(
    setting_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single setting by ID."""
    result = await db.execute(
        select(Setting).where(Setting.id == setting_id)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return _to_response(setting)


@router.put("", response_model=SettingResponse)
async def upsert_setting(
    body: SettingCreate,
    db: AsyncSession = Depends(get_db),
):
    """Upsert a setting (insert or update if exists)."""
    stmt = pg_insert(Setting).values(
        app_id=body.app_id,
        key=body.key,
        value=body.value,
        user_id="default"
    ).on_conflict_do_update(
        constraint="uq_setting",
        set_={"value": body.value, "updated_at": func.now()}
    ).returning(Setting)
    
    result = await db.execute(stmt)
    await db.commit()
    setting = result.scalar_one()
    return _to_response(setting)


@router.delete("/{setting_id}")
async def delete_setting(
    setting_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a setting."""
    result = await db.execute(select(Setting).where(Setting.id == setting_id))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    
    await db.delete(setting)
    await db.commit()
    return {"deleted": True, "id": setting_id}


def _to_response(setting: Setting) -> dict:
    """Convert SQLAlchemy model to response dict."""
    return {
        "id": setting.id,
        "app_id": setting.app_id,
        "key": setting.key,
        "value": setting.value,
        "updated_at": setting.updated_at,
        "user_id": setting.user_id,
    }
