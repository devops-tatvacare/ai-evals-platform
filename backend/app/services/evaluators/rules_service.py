"""Rules catalog service — load/save the published rule catalog from settings."""
import logging
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.application_setting import ApplicationSetting
from app.models.mixins.shareable import Visibility
from app.services.access_control import shared_visibility_clause
from app.services.settings_upsert import build_setting_upsert_stmt

logger = logging.getLogger(__name__)

DEFAULT_RULES_KEY = "rule-catalog"


def _extract_rules(setting_value: Any) -> list[dict[str, Any]]:
    if isinstance(setting_value, list):
        return setting_value
    if isinstance(setting_value, dict):
        nested_rules = setting_value.get("rules")
        if isinstance(nested_rules, list):
            return nested_rules
    return []


async def load_rules(
    db: AsyncSession,
    *,
    app_id: str,
    tenant_id,
    catalog_key: str = DEFAULT_RULES_KEY,
) -> list[dict[str, Any]]:
    """Load published rule catalog using settings resolution:
    1. Shared setting in the current tenant
    2. System default
    3. Empty list
    """
    # Step 1: Shared in current tenant
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == tenant_id,
            ApplicationSetting.app_id == app_id,
            ApplicationSetting.key == catalog_key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    setting = result.scalar_one_or_none()
    if setting:
        return _extract_rules(setting.value)

    # Step 2: System default
    result = await db.execute(
        select(ApplicationSetting).where(
            ApplicationSetting.tenant_id == SYSTEM_TENANT_ID,
            ApplicationSetting.app_id == app_id,
            ApplicationSetting.key == catalog_key,
            shared_visibility_clause(ApplicationSetting.visibility),
        )
    )
    setting = result.scalar_one_or_none()
    if setting:
        return _extract_rules(setting.value)

    return []


async def save_rules(
    db: AsyncSession,
    *,
    app_id: str,
    tenant_id,
    user_id,
    rules: list[dict[str, Any]],
) -> None:
    """Save the published rule catalog as a shared setting."""
    stmt = build_setting_upsert_stmt(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=DEFAULT_RULES_KEY,
        value=rules,
        visibility=Visibility.SHARED,
        updated_by=user_id,
        forked_from=None,
        shared_by=user_id,
    )
    await db.execute(stmt)
    await db.commit()
