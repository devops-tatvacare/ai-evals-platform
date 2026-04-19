"""AuthContext dataclass and FastAPI dependencies for route-level auth."""
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.utils import decode_access_token
from app.auth.permissions import load_role_permissions
from app.database import get_db


bearer_scheme = HTTPBearer()


@dataclass(frozen=True)
class AuthContext:
    """Injected into every authenticated route."""
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role_id: uuid.UUID
    is_owner: bool
    permissions: frozenset[str]
    app_access: frozenset[str]


async def get_auth_context(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    """Extract and validate auth context from Bearer token, load permissions."""
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    role_id = uuid.UUID(payload["rid"])
    role, permissions, app_slugs = await load_role_permissions(db, role_id)

    return AuthContext(
        user_id=uuid.UUID(payload["sub"]),
        tenant_id=uuid.UUID(payload["tid"]),
        email=payload["email"],
        role_id=role_id,
        is_owner=(role.is_system and role.name == "Owner"),
        permissions=frozenset(permissions),
        app_access=frozenset(app_slugs),
    )


async def require_owner(
    auth: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    """Require Owner role."""
    if not auth.is_owner:
        raise HTTPException(status_code=403, detail="Owner access required")
    return auth


def is_super_admin(auth: AuthContext) -> bool:
    """Super-admin = Owner role on the system tenant."""
    from app.constants import SYSTEM_TENANT_ID
    return auth.is_owner and auth.tenant_id == SYSTEM_TENANT_ID


async def require_super_admin(
    auth: AuthContext = Depends(get_auth_context),
) -> AuthContext:
    """Require Owner of ``SYSTEM_TENANT_ID`` (super-admin).

    Used for global pricing mutations and models.dev refresh (cost §9.2).
    """
    if not is_super_admin(auth):
        raise HTTPException(status_code=403, detail="Super-admin access required")
    return auth
