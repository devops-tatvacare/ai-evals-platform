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

    if app_id is not None:
        query = query.where(Setting.app_id == app_id)
    if key:
        query = query.where(Setting.key == key)

    result = await db.execute(query)
    return result.scalars().all()


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
    return setting


@router.put("", response_model=SettingResponse)
async def upsert_setting(
    body: SettingCreate,
    db: AsyncSession = Depends(get_db),
):
    """Upsert a setting (insert or update if exists)."""
    # Coerce None to empty string — NULL breaks the unique constraint
    app_id = body.app_id or ""

    stmt = pg_insert(Setting).values(
        app_id=app_id,
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
    return setting


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
