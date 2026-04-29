"""Helpers for app-registry validation and app-access enforcement."""

import json
import re
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.application import Application

if TYPE_CHECKING:
    from app.auth.context import AuthContext


def normalize_app_slug(app_slug: str | None) -> str | None:
    normalized = (app_slug or '').strip()
    return normalized or None


def _to_snake_case(param_name: str) -> str:
    normalized = re.sub(r'(?<!^)(?=[A-Z])', '_', param_name)
    return normalized.replace('-', '_').lower()


def _to_camel_case(param_name: str) -> str:
    parts = _to_snake_case(param_name).split('_')
    return parts[0] + ''.join(part.capitalize() for part in parts[1:])


def candidate_param_names(param_name: str) -> tuple[str, ...]:
    candidates: list[str] = []
    for candidate in (param_name, _to_snake_case(param_name), _to_camel_case(param_name)):
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return tuple(candidates)


async def extract_app_slug_from_request(request: Request, param_name: str) -> str | None:
    for candidate in candidate_param_names(param_name):
        value = request.query_params.get(candidate) or request.path_params.get(candidate)
        normalized = normalize_app_slug(value)
        if normalized is not None:
            return normalized

    content_type = request.headers.get('content-type', '')
    if 'application/json' not in content_type:
        return None

    try:
        payload = await request.json()
    except (json.JSONDecodeError, RuntimeError):
        return None

    if not isinstance(payload, dict):
        return None

    for candidate in candidate_param_names(param_name):
        value = payload.get(candidate)
        if isinstance(value, str):
            normalized = normalize_app_slug(value)
            if normalized is not None:
                return normalized

    return None


async def load_active_app_map(db: AsyncSession) -> dict[str, Application]:
    result = await db.execute(
        select(Application).where(Application.is_active == True).order_by(Application.slug)
    )
    return {app.slug: app for app in result.scalars().all()}


async def validate_registered_app_slug(
    db: AsyncSession,
    app_slug: str | None,
    *,
    required: bool = True,
    param_name: str = 'app_id',
) -> str | None:
    normalized = normalize_app_slug(app_slug)
    if normalized is None:
        if required:
            raise HTTPException(400, f'Missing required parameter: {param_name}')
        return None

    app_map = await load_active_app_map(db)
    if normalized not in app_map:
        raise HTTPException(404, 'App not found')
    return normalized


async def ensure_registered_app_access(
    db: AsyncSession,
    auth: 'AuthContext',
    app_slug: str | None,
    *,
    required: bool = True,
    param_name: str = 'app_id',
) -> str | None:
    """Enforce that ``auth`` can reach the requested app.

    ``auth.app_access`` is treated as the single source of truth. The
    Owner role is reflected there at auth-load time via
    :func:`app.auth.permissions.load_role_permissions`, so no Owner-only
    branch is needed here.
    """
    normalized = await validate_registered_app_slug(
        db,
        app_slug,
        required=required,
        param_name=param_name,
    )
    if normalized is None:
        return normalized
    if normalized not in auth.app_access:
        raise HTTPException(403, f'No access to app: {normalized}')
    return normalized


def require_registered_app_access(app_id_param: str = 'app_id'):
    from app.auth.context import AuthContext, get_auth_context

    async def _checker(
        request: Request,
        auth: AuthContext = Depends(get_auth_context),
        db: AsyncSession = Depends(get_db),
    ) -> AuthContext:
        app_slug = await extract_app_slug_from_request(request, app_id_param)
        await ensure_registered_app_access(
            db,
            auth,
            app_slug,
            required=True,
            param_name=app_id_param,
        )
        return auth

    return Depends(_checker)


def require_fixed_app_access(app_slug: str):
    from app.auth.context import AuthContext, get_auth_context

    async def _checker(
        auth: AuthContext = Depends(get_auth_context),
        db: AsyncSession = Depends(get_db),
    ) -> AuthContext:
        await ensure_registered_app_access(
            db,
            auth,
            app_slug,
            required=True,
            param_name='app_id',
        )
        return auth

    return Depends(_checker)
