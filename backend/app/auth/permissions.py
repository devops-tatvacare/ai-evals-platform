"""Permission validation and RBAC dependency functions."""
import uuid
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.app_scope import require_registered_app_access
from app.auth.permission_catalog import VALID_PERMISSIONS
from app.database import get_db
from app.models.application import Application
from app.models.role import AccessRole, AccessRoleApplicationGrant, AccessRolePermission

if TYPE_CHECKING:
    from app.auth.context import AuthContext


async def load_role_permissions(
    db: AsyncSession, role_id: uuid.UUID
) -> tuple["AccessRole", list[str], list[str]]:
    """Load a role with its permissions and app access slugs in one query.

    Returns: (role, permission_strings, app_slugs)

    For the Owner system role, ``app_slugs`` is expanded at load time to
    every currently-active app. Owner is the tenant's top role and is
    expected to reach every registered app; representing that in
    ``app_access`` directly keeps ``AuthContext`` the single source of
    truth so downstream scope checks (e.g. ``ScopeGuard``) do not need
    an Owner-only bypass.
    """
    stmt = (
        select(AccessRole)
        .options(
            selectinload(AccessRole.permissions),
            selectinload(AccessRole.app_access).selectinload(AccessRoleApplicationGrant.app),
        )
        .where(AccessRole.id == role_id)
    )
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()
    if role is None:
        raise HTTPException(401, "AccessRole not found — token may be stale")

    perm_strings = [rp.permission for rp in role.permissions]
    app_slugs = [ra.app.slug for ra in role.app_access]

    if role.is_system and role.name == "Owner":
        active_apps = await db.execute(
            select(Application.slug).where(Application.is_active == True)
        )
        active_slugs = {slug for slug in active_apps.scalars().all() if slug}
        app_slugs = sorted(active_slugs.union(app_slugs))

    return role, perm_strings, app_slugs


def _validate_permission_ids(perms: tuple[str, ...]) -> tuple[str, ...]:
    invalid = sorted(set(perms) - VALID_PERMISSIONS)
    if invalid:
        raise ValueError(f'Invalid permissions: {", ".join(invalid)}')
    return perms


def missing_permissions(auth: 'AuthContext', *perms: str) -> tuple[str, ...]:
    validated = _validate_permission_ids(perms)
    if auth.is_owner:
        return ()
    return tuple(sorted(set(validated) - auth.permissions))


def ensure_permissions(auth: 'AuthContext', *perms: str) -> None:
    missing = missing_permissions(auth, *perms)
    if not missing:
        return
    if len(missing) == 1:
        raise HTTPException(403, f'Missing permission: {missing[0]}')
    raise HTTPException(403, f"Missing permissions: {', '.join(missing)}")


def ensure_any_permission(auth: 'AuthContext', *perms: str) -> None:
    validated = _validate_permission_ids(perms)
    if auth.is_owner:
        return
    if any(permission in auth.permissions for permission in validated):
        return
    raise HTTPException(403, f"Requires one of: {', '.join(validated)}")


def require_permission(*perms: str):
    """FastAPI dependency: require one or more permissions. Owner bypasses."""
    from app.auth.context import get_auth_context, AuthContext
    _validate_permission_ids(perms)

    async def _checker(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        ensure_permissions(auth, *perms)
        return auth

    return Depends(_checker)


def require_any_permission(*perms: str):
    """FastAPI dependency: require at least one of the permissions. Owner bypasses."""
    from app.auth.context import get_auth_context, AuthContext
    _validate_permission_ids(perms)

    async def _checker(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        ensure_any_permission(auth, *perms)
        return auth

    return Depends(_checker)


def require_app_access(app_id_param: str = "app_id"):
    """FastAPI dependency: require registry-backed access to the app in query/path params."""
    return require_registered_app_access(app_id_param)
