"""Settings API routes."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.permissions import require_permission
from app.constants import SYSTEM_TENANT_ID, SYSTEM_USER_ID
from app.database import get_db
from app.models.mixins.shareable import Visibility
from app.models.application_setting import ApplicationSetting
from app.schemas.setting import SettingCreate, SettingResponse
from app.services.asset_policy import is_private_only_asset_key
from app.services.access_control import is_shared_visibility, shared_visibility_clause
from app.services.settings_upsert import build_setting_upsert_stmt

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _resolved_settings(rows: list[ApplicationSetting], auth: AuthContext) -> list[ApplicationSetting]:
    winners: dict[str, ApplicationSetting] = {}
    for row in rows:
        current = winners.get(row.key)
        if current is None:
            winners[row.key] = row
            continue

        current_priority = _setting_priority(current, auth)
        row_priority = _setting_priority(row, auth)
        if row_priority < current_priority:
            winners[row.key] = row
    return list(winners.values())


def _setting_priority(row: ApplicationSetting, auth: AuthContext) -> int:
    if row.tenant_id == auth.tenant_id and row.user_id == auth.user_id:
        return 0
    if row.tenant_id == auth.tenant_id and is_shared_visibility(row.visibility):
        return 1
    if (
        row.tenant_id == SYSTEM_TENANT_ID
        and row.user_id == SYSTEM_USER_ID
        and is_shared_visibility(row.visibility)
    ):
        return 2
    return 3


@router.get("", response_model=list[SettingResponse])
async def list_settings(
    app_id: str = Query(None),
    key: str = Query(None),
    include_all: bool = Query(False),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List settings visible to the current user.

    Default behavior returns resolved winners by key using: private -> shared -> system.
    Pass include_all=true to return all visible rows for management views.
    """
    resolved_app_id = app_id if app_id is not None else ""
    if is_private_only_asset_key('settings', key):
        query = select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.user_id == auth.user_id,
            ApplicationSetting.app_id == "",
            ApplicationSetting.key == key,
            ApplicationSetting.visibility == Visibility.PRIVATE,
        )
    else:
        priority = case(
            (
                (ApplicationSetting.tenant_id == auth.tenant_id) & (ApplicationSetting.user_id == auth.user_id),
                0,
            ),
            (
                (ApplicationSetting.tenant_id == auth.tenant_id) & shared_visibility_clause(ApplicationSetting.visibility),
                1,
            ),
            (
                (ApplicationSetting.tenant_id == SYSTEM_TENANT_ID)
                & (ApplicationSetting.user_id == SYSTEM_USER_ID)
                & shared_visibility_clause(ApplicationSetting.visibility),
                2,
            ),
            else_=3,
        )
        query = (
            select(ApplicationSetting)
            .where(
                ApplicationSetting.app_id == resolved_app_id,
                (
                    ((ApplicationSetting.tenant_id == auth.tenant_id) & (ApplicationSetting.user_id == auth.user_id))
                    | ((ApplicationSetting.tenant_id == auth.tenant_id) & shared_visibility_clause(ApplicationSetting.visibility))
                    | (
                        (ApplicationSetting.tenant_id == SYSTEM_TENANT_ID)
                        & (ApplicationSetting.user_id == SYSTEM_USER_ID)
                        & shared_visibility_clause(ApplicationSetting.visibility)
                    )
                ),
            )
            .order_by(ApplicationSetting.key, priority, ApplicationSetting.updated_at.desc())
        )
    if key:
        query = query.where(ApplicationSetting.key == key)

    result = await db.execute(query)
    rows = result.scalars().all()
    if include_all or is_private_only_asset_key('settings', key):
        return rows
    return _resolved_settings(rows, auth)


@router.get("/resolve", response_model=Optional[SettingResponse])
async def resolve_setting(
    app_id: str = Query(...),
    key: str = Query(...),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Resolve a single setting using the priority chain: private -> shared -> system default."""
    resolved_app_id = app_id or ""

    if is_private_only_asset_key('settings', key):
        result = await db.execute(
            select(ApplicationSetting).where(
                ApplicationSetting.tenant_id == auth.tenant_id,
                ApplicationSetting.user_id == auth.user_id,
                ApplicationSetting.app_id == "",
                ApplicationSetting.key == key,
                ApplicationSetting.visibility == Visibility.PRIVATE,
            )
        )
        return result.scalar_one_or_none()

    # Step 1: User's private override
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.user_id == auth.user_id,
            ApplicationSetting.app_id == resolved_app_id,
            ApplicationSetting.key == key,
            ApplicationSetting.visibility == Visibility.PRIVATE,
        )
    )
    setting = result.scalar_one_or_none()
    if setting:
        return setting

    # Step 2: Shared in current tenant
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.app_id == resolved_app_id,
            ApplicationSetting.key == key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    setting = result.scalar_one_or_none()
    if setting:
        return setting

    # Step 3: System default
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == SYSTEM_TENANT_ID,
            ApplicationSetting.app_id == resolved_app_id,
            ApplicationSetting.key == key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    return result.scalar_one_or_none()


@router.get("/{setting_id}", response_model=SettingResponse)
async def get_setting(
    setting_id: int,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Get a single setting by ID."""
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.id == setting_id,
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.user_id == auth.user_id,
        )
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.put("", response_model=SettingResponse)
async def upsert_setting(
    body: SettingCreate,
    auth: AuthContext = require_permission('configuration:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Upsert a setting using the correct scope-aware uniqueness target."""
    stmt = build_setting_upsert_stmt(
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        app_id=body.app_id,
        key=body.key,
        value=body.value,
        visibility=body.visibility,
        updated_by=auth.user_id,
        forked_from=body.forked_from,
        shared_by=auth.user_id if body.visibility == Visibility.SHARED else None,
    )

    result = await db.execute(stmt)
    await db.commit()
    setting = result.scalar_one()
    return setting


@router.delete("")
async def delete_setting_by_key(
    key: str = Query(...),
    app_id: str = Query(None),
    auth: AuthContext = require_permission('configuration:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Delete a setting by key + app_id for the current user."""
    resolved_app_id = app_id if app_id is not None else ""
    result = await db.execute(
        select(ApplicationSetting)
        .where(
            ApplicationSetting.key == key,
            ApplicationSetting.app_id == resolved_app_id,
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.user_id == auth.user_id,
        )
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    await db.delete(setting)
    await db.commit()
    return {"deleted": True, "key": key, "appId": resolved_app_id}


@router.delete("/{setting_id}")
async def delete_setting(
    setting_id: int,
    auth: AuthContext = require_permission('configuration:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Delete a setting by ID."""
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.id == setting_id,
            ApplicationSetting.tenant_id == auth.tenant_id,
            ApplicationSetting.user_id == auth.user_id,
        )
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    await db.delete(setting)
    await db.commit()
    return {"deleted": True, "id": setting_id}
