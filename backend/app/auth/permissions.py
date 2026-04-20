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
from app.models.role import Role, RoleAppAccess, RolePermission

if TYPE_CHECKING:
    from app.auth.context import AuthContext


async def load_role_permissions(
    db: AsyncSession, role_id: uuid.UUID
) -> tuple["Role", list[str], list[str]]:
    """Load a role with its permissions and app access slugs in one query.

    Returns: (role, permission_strings, app_slugs)
    """
    stmt = (
        select(Role)
        .options(
            selectinload(Role.permissions),
            selectinload(Role.app_access).selectinload(RoleAppAccess.app),
        )
        .where(Role.id == role_id)
    )
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()
    if role is None:
        raise HTTPException(401, "Role not found — token may be stale")

    perm_strings = [rp.permission for rp in role.permissions]
    app_slugs = [ra.app.slug for ra in role.app_access]
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


def require_app_access(app_id_param: str = "app_id"):
    """FastAPI dependency: require registry-backed access to the app in query/path params."""
    return require_registered_app_access(app_id_param)
