"""Auth routes — login, refresh, logout, me, password change."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context
from app.auth.utils import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.config import settings

limiter = Limiter(key_func=get_remote_address)
from app.database import get_db
from app.models.invite_link import IdentityInviteLink, InviteSignupMethod, InviteStatus
from app.models.invite_link_use import IdentityInviteLinkUse
from app.models.tenant import Tenant
from app.models.tenant_config import TenantConfiguration
from app.models.user import IdentityRefreshToken, User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, SignupRequest
from app.services.invite_links import (
    compute_invite_status,
    hash_ip,
    refresh_invite_status,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _check_allowed_domains(email: str, tenant_id, db: AsyncSession) -> None:
    """Raise 403 if the tenant restricts email domains and this email doesn't match."""
    from app.services.tenant_policy import (
        is_email_domain_allowed,
        load_tenant_allowed_domains,
    )

    allowed = await load_tenant_allowed_domains(db, tenant_id)
    if not allowed:
        return
    if is_email_domain_allowed(email, allowed):
        return
    raise HTTPException(
        403,
        detail=f"Email domain not allowed. Permitted domains: {', '.join(allowed)}",
    )


async def _user_response(user: User, tenant: Tenant, db: AsyncSession) -> dict:
    """Build user response dict with RBAC fields."""
    from app.auth.permissions import load_role_permissions
    role, permissions, app_slugs = await load_role_permissions(db, user.role_id)
    return {
        "id": str(user.id),
        "email": user.email,
        "displayName": user.display_name,
        "tenantId": str(user.tenant_id),
        "tenantName": tenant.name,
        "roleId": str(user.role_id),
        "roleName": role.name,
        "isOwner": role.is_system and role.name == "Owner",
        "permissions": permissions,
        "appAccess": app_slugs,
    }


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    """Set the httpOnly refresh-token cookie."""
    response.set_cookie(
        key="refresh_token",
        value=raw_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth/refresh",
    )


@router.post("/login")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    # 1. Find user by email (case-insensitive)
    user = await db.scalar(
        select(User).where(func.lower(User.email) == func.lower(body.email))
    )
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(403, detail="Account disabled")

    # 2. Check tenant is active
    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(403, detail="Tenant disabled")

    # 2b. Check allowed email domains
    await _check_allowed_domains(user.email, tenant.id, db)

    # 3. Create access token
    access_token = create_access_token(user.id, user.tenant_id, user.email, user.role_id)

    # 4. Create refresh token, store hash in DB
    raw_refresh, refresh_hash = create_refresh_token()
    db.add(IdentityRefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await db.commit()

    # 5. Set refresh token as httpOnly cookie
    _set_refresh_cookie(response, raw_refresh)

    # 6. Return access token + user profile
    return {
        "accessToken": access_token,
        "user": await _user_response(user, tenant, db),
    }


@router.post("/refresh")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    raw_token = request.cookies.get("refresh_token")
    if not raw_token:
        raise HTTPException(401, detail="No refresh token")

    token_hash = hash_refresh_token(raw_token)

    # Find and validate stored token
    stored = await db.scalar(
        select(IdentityRefreshToken).where(IdentityRefreshToken.token_hash == token_hash)
    )
    if not stored or stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, detail="Invalid or expired refresh token")

    # Load user
    user = await db.get(User, stored.user_id)
    if not user or not user.is_active:
        raise HTTPException(403, detail="Account disabled")

    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(403, detail="Tenant disabled")

    # Token rotation: delete old, create new
    await db.delete(stored)
    raw_refresh, refresh_hash = create_refresh_token()
    db.add(IdentityRefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await db.commit()

    # New access token
    access_token = create_access_token(user.id, user.tenant_id, user.email, user.role_id)

    # Set new refresh cookie
    _set_refresh_cookie(response, raw_refresh)

    return {"accessToken": access_token}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    raw_token = request.cookies.get("refresh_token")
    if raw_token:
        token_hash = hash_refresh_token(raw_token)
        await db.execute(
            delete(IdentityRefreshToken).where(IdentityRefreshToken.token_hash == token_hash)
        )
        await db.commit()

    response.delete_cookie("refresh_token", path="/api/auth/refresh")
    return {"status": "ok"}


@router.get("/me")
async def get_me(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, auth.user_id)
    if not user:
        raise HTTPException(404, detail="User not found")
    tenant = await db.get(Tenant, auth.tenant_id)
    if not tenant:
        raise HTTPException(404, detail="Tenant not found")
    return await _user_response(user, tenant, db)


def _validate_password_strength(password: str) -> str | None:
    """Return an error message if password is weak, or None if strong."""
    if len(password) < 8:
        return "Password must be at least 8 characters"
    import re
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return "Password must contain at least one number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must contain at least one special character"
    return None


@router.put("/me/password")
async def change_password(
    body: ChangePasswordRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, auth.user_id)
    if not user:
        raise HTTPException(404, detail="User not found")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, detail="Current password incorrect")
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(400, detail="New password must be different from current password")

    strength_error = _validate_password_strength(body.new_password)
    if strength_error:
        raise HTTPException(400, detail=strength_error)

    user.password_hash = hash_password(body.new_password)

    # Revoke all refresh tokens (force re-login on other devices)
    await db.execute(
        delete(IdentityRefreshToken).where(IdentityRefreshToken.user_id == user.id)
    )
    await db.commit()
    return {"status": "ok"}


# ── Invite Link Signup ──────────────────────────────────────────────────────


async def _validate_invite(token: str, db: AsyncSession) -> tuple[IdentityInviteLink | None, Tenant | None]:
    """Validate an invite token. Returns (invite, tenant) or (None, None)."""
    token_hash = hash_refresh_token(token)
    invite = await db.scalar(
        select(IdentityInviteLink).where(IdentityInviteLink.token_hash == token_hash)
    )
    if not invite:
        return None, None
    previous_status = invite.status
    current_status = refresh_invite_status(invite)
    if current_status != previous_status:
        await db.commit()
    if current_status != InviteStatus.active:
        return None, None

    tenant = await db.get(Tenant, invite.tenant_id)
    if not tenant or not tenant.is_active:
        return None, None

    return invite, tenant


@router.get("/validate-invite")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def validate_invite(
    request: Request,  # required by slowapi for IP keying
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Check if an invite token is valid (public endpoint).

    Rate-limited per IP — same setting as ``/login`` and ``/signup``. Token
    brute-force is infeasible at 256 bits; this prevents log-flood DoS.
    """
    invite, tenant = await _validate_invite(token, db)
    if not invite or not tenant:
        return {"valid": False}

    # Include allowed domains so frontend can hint at restrictions
    config = await db.scalar(
        select(TenantConfiguration).where(TenantConfiguration.tenant_id == tenant.id)
    )
    allowed_domains = config.allowed_domains if config and config.allowed_domains else []

    from app.models.role import AccessRole
    role = await db.get(AccessRole, invite.role_id)

    return {
        "valid": True,
        "tenantName": tenant.name,
        "roleId": str(invite.role_id),
        "roleName": role.name if role else None,
        "expiresAt": invite.expires_at.isoformat(),
        "allowedDomains": allowed_domains,
    }


@router.post("/signup")
@limiter.limit(settings.AUTH_RATE_LIMIT)
async def signup(
    request: Request,
    body: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Create a new user account via invite link (public endpoint)."""
    # 1. Validate invite (with row lock to prevent race on uses_count)
    token_hash = hash_refresh_token(body.token)
    invite = await db.scalar(
        select(IdentityInviteLink)
        .where(IdentityInviteLink.token_hash == token_hash)
        .with_for_update()
    )
    if not invite:
        raise HTTPException(400, detail="Invalid or expired invite link")
    previous_status = invite.status
    current_status = refresh_invite_status(invite)
    if current_status != InviteStatus.active:
        if current_status != previous_status:
            await db.commit()
        raise HTTPException(400, detail="Invalid or expired invite link")

    # 1a. Reject SSO invites — the password signup path can't redeem them.
    #     Today the create route hard-rejects ``sso``; this is the safety
    #     net for when SSO ships and the column starts seeing real values.
    if invite.signup_method != InviteSignupMethod.password:
        raise HTTPException(
            400,
            detail="This invite is for SSO. Sign in with your provider.",
        )

    tenant = await db.get(Tenant, invite.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(400, detail="Invalid or expired invite link")

    # 1b. Check allowed email domains
    await _check_allowed_domains(body.email, tenant.id, db)

    # 2. Validate password strength
    strength_error = _validate_password_strength(body.password)
    if strength_error:
        raise HTTPException(400, detail=strength_error)

    # 3. Check duplicate email within tenant
    existing = await db.scalar(
        select(User).where(
            User.tenant_id == invite.tenant_id,
            func.lower(User.email) == func.lower(body.email),
        )
    )
    if existing:
        raise HTTPException(400, detail="An account with this email already exists. Please sign in instead.")

    # 4. Create user
    user = User(
        tenant_id=invite.tenant_id,
        email=body.email.strip().lower(),
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
        role_id=invite.role_id,
    )
    db.add(user)

    # 5. Increment invite usage and persist the new lifecycle state.
    invite.uses_count += 1

    await db.flush()

    # 5a. Provision admin-required notification subscriptions on signup so
    # required-for-all defaults reach users created after the admin flipped them.
    from app.services.mail.onboarding import provision_required_subscriptions_for_user
    await provision_required_subscriptions_for_user(
        db,
        tenant_id=user.tenant_id,
        user_id=user.id,
        user_email=user.email,
    )

    # 5b. Recompute status inside the same FOR UPDATE window so an invite
    #     that just hit ``max_uses`` flips ACTIVE → EXHAUSTED on the row.
    invite.status = compute_invite_status(
        is_revoked=invite.is_revoked,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        uses_count=invite.uses_count,
        now=datetime.now(timezone.utc),
    )

    # 5c. Forensic audit row: who redeemed this invite, from where.
    client_ip = request.client.host if request.client else None
    db.add(IdentityInviteLinkUse(
        invite_link_id=invite.id,
        user_id=user.id,
        user_email_snapshot=user.email,
        ip_hash=hash_ip(client_ip, invite.tenant_id),
    ))

    # 6. Create tokens (same as login)
    access_token = create_access_token(user.id, user.tenant_id, user.email, user.role_id)
    raw_refresh, refresh_hash = create_refresh_token()
    db.add(IdentityRefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
    ))

    await db.commit()

    # 7. Set refresh cookie and return
    _set_refresh_cookie(response, raw_refresh)
    return {
        "accessToken": access_token,
        "user": await _user_response(user, tenant, db),
    }
