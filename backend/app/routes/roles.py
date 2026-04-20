"""Role management routes — Owner only for mutations."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.app_scope import load_active_app_map
from app.auth.context import AuthContext, get_auth_context, require_owner
from app.auth.permission_catalog import serialize_permission_catalog
from app.auth.permissions import VALID_PERMISSIONS
from app.database import get_db
from app.models.role import Role, RoleAppAccess, RolePermission
from app.models.user import User
from app.models.invite_link import InviteLink
from app.models.audit_log import AuditLog
from app.schemas.role import RoleCreate, RoleUpdate
from app.services.audit import write_audit_log

router = APIRouter(prefix="/api/admin", tags=["admin-rbac"])


def _role_response(role: Role, user_count: int = 0) -> dict:
    return {
        "id": str(role.id),
        "name": role.name,
        "description": role.description,
        "isSystem": role.is_system,
        "appAccess": [ra.app.slug for ra in role.app_access],
        "permissions": [rp.permission for rp in role.permissions],
        "userCount": user_count,
        "createdAt": role.created_at.isoformat() if role.created_at else None,
        "updatedAt": role.updated_at.isoformat() if role.updated_at else None,
    }


@router.get("/roles")
async def list_roles(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List all roles for the tenant with user counts."""
    user_count_sq = (
        select(User.role_id, func.count(User.id).label("cnt"))
        .where(User.tenant_id == auth.tenant_id)
        .group_by(User.role_id)
        .subquery()
    )
    stmt = (
        select(Role, func.coalesce(user_count_sq.c.cnt, 0))
        .outerjoin(user_count_sq, Role.id == user_count_sq.c.role_id)
        .options(
            selectinload(Role.app_access).selectinload(RoleAppAccess.app),
            selectinload(Role.permissions),
        )
        .where(Role.tenant_id == auth.tenant_id)
        .order_by(Role.is_system.desc(), Role.name)
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [_role_response(role, count) for role, count in rows]


@router.get("/permission-catalog")
async def get_permission_catalog(
    auth: AuthContext = Depends(get_auth_context),
):
    """Expose the backend-owned permission catalog for admin consumers."""
    return serialize_permission_catalog()


@router.post("/roles", status_code=201)
async def create_role(
    body: RoleCreate,
    request: Request,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Create a custom role. Owner only."""
    invalid = set(body.permissions) - VALID_PERMISSIONS
    if invalid:
        raise HTTPException(400, f"Invalid permissions: {', '.join(sorted(invalid))}")

    app_map = await _get_app_map(db)
    invalid_apps = set(body.app_access) - set(app_map.keys())
    if invalid_apps:
        raise HTTPException(400, f"Invalid app slugs: {', '.join(sorted(invalid_apps))}")

    existing = await db.execute(
        select(Role).where(Role.tenant_id == auth.tenant_id, Role.name == body.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Role '{body.name}' already exists")

    role = Role(tenant_id=auth.tenant_id, name=body.name, description=body.description)
    db.add(role)
    await db.flush()

    for slug in body.app_access:
        db.add(RoleAppAccess(role_id=role.id, app_id=app_map[slug]))
    for perm in body.permissions:
        db.add(RolePermission(role_id=role.id, permission=perm))

    await write_audit_log(
        db, tenant_id=auth.tenant_id, actor_id=auth.user_id,
        action="role.created", entity_type="role", entity_id=role.id,
        after_state={"name": body.name, "permissions": body.permissions, "app_access": body.app_access},
        request=request,
    )
    await db.commit()

    return await _get_role_detail(db, role.id, auth.tenant_id)


@router.get("/roles/{role_id}")
async def get_role(
    role_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Get role detail with permissions and app access."""
    return await _get_role_detail(db, role_id, auth.tenant_id)


@router.put("/roles/{role_id}")
async def update_role(
    role_id: uuid.UUID,
    body: RoleUpdate,
    request: Request,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Update a custom role. Owner only. Cannot update system roles."""
    role = await _get_role_or_404(db, role_id, auth.tenant_id)
    if role.is_system:
        raise HTTPException(403, "Cannot modify system roles")

    before = {"name": role.name, "permissions": [rp.permission for rp in role.permissions],
              "app_access": [ra.app.slug for ra in role.app_access]}

    if body.name is not None:
        existing = await db.execute(
            select(Role).where(Role.tenant_id == auth.tenant_id, Role.name == body.name, Role.id != role_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, f"Role '{body.name}' already exists")
        role.name = body.name

    if body.description is not None:
        role.description = body.description

    app_map = await _get_app_map(db)

    if body.app_access is not None:
        invalid_apps = set(body.app_access) - set(app_map.keys())
        if invalid_apps:
            raise HTTPException(400, f"Invalid app slugs: {', '.join(sorted(invalid_apps))}")
        await db.execute(delete(RoleAppAccess).where(RoleAppAccess.role_id == role_id))
        for slug in body.app_access:
            db.add(RoleAppAccess(role_id=role_id, app_id=app_map[slug]))

    if body.permissions is not None:
        invalid = set(body.permissions) - VALID_PERMISSIONS
        if invalid:
            raise HTTPException(400, f"Invalid permissions: {', '.join(sorted(invalid))}")
        await db.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
        for perm in body.permissions:
            db.add(RolePermission(role_id=role_id, permission=perm))

    after = {"name": role.name, "permissions": body.permissions or before["permissions"],
             "app_access": body.app_access or before["app_access"]}

    await write_audit_log(
        db, tenant_id=auth.tenant_id, actor_id=auth.user_id,
        action="role.updated", entity_type="role", entity_id=role_id,
        before_state=before, after_state=after, request=request,
    )
    await db.commit()
    return await _get_role_detail(db, role_id, auth.tenant_id)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    request: Request,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Delete a custom role. Blocked if users or invite links reference it."""
    role = await _get_role_or_404(db, role_id, auth.tenant_id)
    if role.is_system:
        raise HTTPException(403, "Cannot delete system roles")

    user_count = await db.execute(
        select(func.count(User.id)).where(User.role_id == role_id, User.tenant_id == auth.tenant_id)
    )
    if user_count.scalar_one() > 0:
        raise HTTPException(409, "Cannot delete role — users are still assigned to it")

    usable_link_count = await db.execute(
        select(func.count(InviteLink.id)).where(
            InviteLink.role_id == role_id,
            InviteLink.tenant_id == auth.tenant_id,
            InviteLink.usable_filter(),
        )
    )
    if usable_link_count.scalar_one() > 0:
        raise HTTPException(409, "Cannot delete role — active invite links reference it")

    before = {"name": role.name, "permissions": [rp.permission for rp in role.permissions],
              "app_access": [ra.app.slug for ra in role.app_access]}

    await write_audit_log(
        db, tenant_id=auth.tenant_id, actor_id=auth.user_id,
        action="role.deleted", entity_type="role", entity_id=role_id,
        before_state=before, request=request,
    )
    # Hard-delete dead invite links (revoked / expired / exhausted) so the
    # NO ACTION FK on invite_links.role_id doesn't block the role delete.
    await db.execute(
        delete(InviteLink).where(
            InviteLink.role_id == role_id,
            InviteLink.tenant_id == auth.tenant_id,
        )
    )
    await db.delete(role)
    await db.commit()


# ── Audit log endpoint ──────────────────────────────────────────────────

@router.get("/audit-log")
async def list_audit_log(
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action_filter: str | None = Query(None, alias="action"),
):
    """Paginated audit log for the tenant. Owner only."""
    stmt = (
        select(AuditLog, User.email)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .where(AuditLog.tenant_id == auth.tenant_id)
    )
    if action_filter:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action_filter}%"))
    stmt = stmt.order_by(AuditLog.created_at.desc())

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    rows = result.all()

    return {
        "items": [
            {
                "id": str(entry.id),
                "actorId": str(entry.actor_id),
                "actorEmail": email,
                "action": entry.action,
                "entityType": entry.entity_type,
                "entityId": str(entry.entity_id),
                "beforeState": entry.before_state,
                "afterState": entry.after_state,
                "ipAddress": entry.ip_address,
                "createdAt": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry, email in rows
        ],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


# ── Helpers ──────────────────────────────────────────────────────────────

async def _get_app_map(db: AsyncSession) -> dict[str, uuid.UUID]:
    """Get {slug: id} mapping for all active apps."""
    return {slug: app.id for slug, app in (await load_active_app_map(db)).items()}


async def _get_role_or_404(db: AsyncSession, role_id: uuid.UUID, tenant_id: uuid.UUID | None = None) -> Role:
    stmt = (
        select(Role)
        .options(
            selectinload(Role.app_access).selectinload(RoleAppAccess.app),
            selectinload(Role.permissions),
        )
        .where(Role.id == role_id)
    )
    if tenant_id:
        stmt = stmt.where(Role.tenant_id == tenant_id)
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(404, "Role not found")
    return role


async def _get_role_detail(db: AsyncSession, role_id: uuid.UUID, tenant_id: uuid.UUID | None = None) -> dict:
    role = await _get_role_or_404(db, role_id, tenant_id)
    user_count = await db.execute(
        select(func.count(User.id)).where(User.role_id == role_id)
    )
    return _role_response(role, user_count.scalar_one())
