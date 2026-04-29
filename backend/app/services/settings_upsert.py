"""Helpers for correct private/shared setting upserts."""

from typing import Any

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.mixins.shareable import Visibility
from app.models.application_setting import ApplicationSetting


def build_setting_upsert_stmt(
    *,
    tenant_id,
    user_id,
    app_id: str | None,
    key: str,
    value: Any,
    visibility: Visibility,
    updated_by,
    forked_from: int | None,
    shared_by=None,
):
    """Build a PostgreSQL upsert statement aligned with the setting scope.

    Shared rows conflict on `(tenant_id, app_id, key, visibility='shared')`.
    Private rows conflict on `(tenant_id, app_id, key, user_id, visibility='private')`.
    """

    visibility = Visibility.normalize(visibility)
    if visibility is None:
        raise ValueError("visibility is required for setting upserts")

    resolved_app_id = app_id or ""
    values = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "app_id": resolved_app_id,
        "key": key,
        "value": value,
        "visibility": visibility,
        "updated_by": updated_by,
        "forked_from": forked_from,
    }
    set_values = {
        "value": value,
        "updated_at": func.now(),
        "updated_by": updated_by,
        "forked_from": forked_from,
    }

    if visibility == Visibility.SHARED:
        effective_shared_by = shared_by or updated_by
        values["shared_by"] = effective_shared_by
        values["shared_at"] = func.now()
        set_values["shared_by"] = effective_shared_by
        set_values["shared_at"] = func.now()
        return (
            pg_insert(ApplicationSetting)
            .values(**values)
            .on_conflict_do_update(
                index_elements=[
                    ApplicationSetting.tenant_id,
                    ApplicationSetting.app_id,
                    ApplicationSetting.key,
                    ApplicationSetting.visibility,
                ],
                index_where=text("visibility = 'SHARED'"),
                set_=set_values,
            )
            .returning(ApplicationSetting)
        )

    return (
        pg_insert(ApplicationSetting)
        .values(**values)
        .on_conflict_do_update(
                index_elements=[
                    ApplicationSetting.tenant_id,
                    ApplicationSetting.app_id,
                    ApplicationSetting.key,
                    ApplicationSetting.user_id,
                    ApplicationSetting.visibility,
                ],
                index_where=text("visibility = 'PRIVATE'"),
                set_=set_values,
            )
            .returning(ApplicationSetting)
    )
