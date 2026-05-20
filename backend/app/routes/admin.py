"""Admin API routes — database stats, selective data erasure, user management, tenant management, invite links."""
import logging
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import EmailStr
from sqlalchemy import select, func, delete, case, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext, get_auth_context, require_owner
from app.auth.permissions import ensure_any_permission, ensure_permissions, require_permission
from app.auth.utils import create_refresh_token, hash_password, hash_refresh_token
from app.database import get_db
from app.routes.auth import _check_allowed_domains
from app.models.invite_link import IdentityInviteLink, InviteSignupMethod, InviteStatus
from app.services import invite_links as invite_link_service
from app.models.evaluation_dataset import EvaluationDataset
from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult, EvaluationRunAdversarialResult, EvaluationRunApiCallLog
from app.models.chat import ChatSession, ChatMessage
from app.models.eval_template import EvaluationTemplate
from app.models.application_uploaded_file import ApplicationUploadedFile
from app.models.library_prompt_definition import LibraryPromptDefinition
from app.models.library_output_schema_definition import LibraryOutputSchemaDefinition
from app.models.evaluator import Evaluator
from app.models.job import BackgroundJob
from app.models.history import ApplicationEventHistory
from app.models.application_setting import ApplicationSetting
from app.models.mixins.shareable import Visibility
from app.models.application_tag import ApplicationTag
from app.models.user import User, IdentityRefreshToken
from app.models.role import AccessRole
from app.models.tenant import Tenant
from app.models.tenant_config import TenantConfiguration
from app.schemas.base import CamelModel
from app.services.audit import write_audit_log
from app.services.mail import (
    CallSite,
    MailNotConfigured,
    MailSendError,
    send_mail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_SHELL_PERMISSIONS = (
    'user:create',
    'user:edit',
    'user:deactivate',
    'user:delete',
    'user:reset_password',
    'invite_link:manage',
    'role:assign',
)

# ── Request schemas ───────────────────────────────────────────────────────────


class EraseRequest(CamelModel):
    app_id: Optional[str] = None
    targets: list[str] = []
    include_seed_data: bool = False


class CreateUserRequest(CamelModel):
    email: str
    password: str
    display_name: str
    role_id: str


class UpdateUserRequest(CamelModel):
    display_name: Optional[str] = None
    role_id: Optional[str] = None
    is_active: Optional[bool] = None


class UpdateTenantRequest(CamelModel):
    name: Optional[str] = None


# ── GET /api/admin/stats ──────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    app_id: Optional[str] = None,
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Return per-table record counts within tenant. Optionally filtered by app_id."""
    tables: dict = {}

    # Helper: count rows with tenant filter + optional app_id
    async def count_table(model, app_col=None):
        q = select(func.count()).select_from(model)
        if hasattr(model, "tenant_id"):
            q = q.where(model.tenant_id == auth.tenant_id)
        if app_id and app_col is not None:
            q = q.where(app_col == app_id)
        result = await db.execute(q)
        return result.scalar() or 0

    # Helper: count by app_id grouping within tenant
    async def count_by_app(model, app_col):
        q = select(app_col, func.count()).select_from(model).group_by(app_col)
        if hasattr(model, "tenant_id"):
            q = q.where(model.tenant_id == auth.tenant_id)
        result = await db.execute(q)
        return {row[0]: row[1] for row in result}

    # Helper: seed/user breakdown for seeded tables
    async def count_with_seed(model, app_col, is_seed_filter, app_filter=None):
        base = select(func.count()).select_from(model)
        if hasattr(model, "tenant_id"):
            base = base.where(model.tenant_id == auth.tenant_id)
        if app_filter is not None:
            base = base.where(app_col == app_filter)

        total = (await db.execute(base)).scalar() or 0
        seed = (await db.execute(base.where(is_seed_filter))).scalar() or 0
        return {"total": total, "seed": seed, "user": total - seed}

    # ── Tables with app_id column ──
    for name, model, col in [
        ("listings", EvaluationDataset, EvaluationDataset.app_id),
        ("eval_runs", EvaluationRun, EvaluationRun.app_id),
        ("chat_sessions", ChatSession, ChatSession.app_id),
        ("history", ApplicationEventHistory, ApplicationEventHistory.app_id),
        ("tags", ApplicationTag, ApplicationTag.app_id),
    ]:
        total = await count_table(model, col)
        entry: dict = {"total": total}
        if not app_id:
            entry["byApp"] = await count_by_app(model, col)
        tables[name] = entry

    # ── Cascade children (no app_id, count via parent join) ──
    for name, model in [
        ("thread_evaluations", EvaluationRunThreadResult),
        ("adversarial_evaluations", EvaluationRunAdversarialResult),
        ("api_logs", EvaluationRunApiCallLog),
        ("chat_messages", ChatMessage),
    ]:
        if app_id:
            # Join through parent to filter by app
            if model == ChatMessage:
                q = (select(func.count()).select_from(model)
                     .join(ChatSession, ChatMessage.session_id == ChatSession.id)
                     .where(ChatSession.app_id == app_id, ChatSession.tenant_id == auth.tenant_id))
            else:
                q = (select(func.count()).select_from(model)
                     .join(EvaluationRun, model.run_id == EvaluationRun.id)
                     .where(EvaluationRun.app_id == app_id, EvaluationRun.tenant_id == auth.tenant_id))
            total = (await db.execute(q)).scalar() or 0
        else:
            total = await count_table(model)
        tables[name] = {"total": total}

    # ── Seeded tables: prompts, schemas, evaluators ──
    from app.constants import SYSTEM_TENANT_ID
    if app_id:
        tables["eval_templates"] = await count_with_seed(
            EvaluationTemplate, EvaluationTemplate.app_id,
            (EvaluationTemplate.is_default == True) & (EvaluationTemplate.tenant_id == SYSTEM_TENANT_ID),
            app_filter=app_id,
        )
    else:
        tables["eval_templates"] = await count_with_seed(
            EvaluationTemplate, EvaluationTemplate.app_id,
            (EvaluationTemplate.is_default == True) & (EvaluationTemplate.tenant_id == SYSTEM_TENANT_ID),
        )
    tables["eval_templates"]["canonical"] = True
    if app_id:
        tables["prompts"] = await count_with_seed(
            LibraryPromptDefinition, LibraryPromptDefinition.app_id,
            (LibraryPromptDefinition.is_default == True) & (LibraryPromptDefinition.tenant_id == SYSTEM_TENANT_ID),
            app_filter=app_id,
        )
        tables["prompts"]["legacy"] = True
        tables["schemas"] = await count_with_seed(
            LibraryOutputSchemaDefinition, LibraryOutputSchemaDefinition.app_id,
            (LibraryOutputSchemaDefinition.is_default == True) & (LibraryOutputSchemaDefinition.tenant_id == SYSTEM_TENANT_ID),
            app_filter=app_id,
        )
        tables["schemas"]["legacy"] = True
        tables["evaluators"] = await count_with_seed(
            Evaluator, Evaluator.app_id,
            (Evaluator.seed_key != None) & (Evaluator.listing_id == None),
            app_filter=app_id,
        )
    else:
        tables["prompts"] = await count_with_seed(
            LibraryPromptDefinition, LibraryPromptDefinition.app_id,
            (LibraryPromptDefinition.is_default == True) & (LibraryPromptDefinition.tenant_id == SYSTEM_TENANT_ID),
        )
        tables["prompts"]["legacy"] = True
        tables["schemas"] = await count_with_seed(
            LibraryOutputSchemaDefinition, LibraryOutputSchemaDefinition.app_id,
            (LibraryOutputSchemaDefinition.is_default == True) & (LibraryOutputSchemaDefinition.tenant_id == SYSTEM_TENANT_ID),
        )
        tables["schemas"]["legacy"] = True
        tables["evaluators"] = await count_with_seed(
            Evaluator, Evaluator.app_id,
            (Evaluator.seed_key != None) & (Evaluator.listing_id == None),
        )

    # ── Tables without app_id ──
    tables["files"] = {"total": await count_table(ApplicationUploadedFile)}
    tables["jobs"] = {"total": await count_table(BackgroundJob)}
    tables["settings"] = {"total": await count_table(ApplicationSetting)}

    return {"tables": tables}


@router.get("/consistency/analytics")
async def get_analytics_consistency(
    app_id: Optional[str] = None,
    limit: int = 25,
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Return analytics run-fact consistency for eligible terminal runs."""
    from app.services.analytics.consistency import build_analytics_consistency_summary

    return await build_analytics_consistency_summary(
        db,
        tenant_id=auth.tenant_id,
        app_id=app_id,
        limit=max(1, min(limit, 100)),
    )


@router.post("/consistency/analytics/backfill")
async def backfill_missing_analytics(
    app_id: Optional[str] = None,
    limit: int = 100,
    auth: AuthContext = require_permission('configuration:edit'),
    db: AsyncSession = Depends(get_db),
):
    """Queue populate-analytics jobs for runs missing analytics facts."""
    from app.services.analytics.consistency import enqueue_missing_analytics_jobs

    payload = await enqueue_missing_analytics_jobs(
        db,
        tenant_id=auth.tenant_id,
        app_id=app_id,
        limit=max(1, min(limit, 500)),
    )
    await db.commit()
    return payload


@router.get("/job-queue")
async def get_job_queue_summary(
    app_id: Optional[str] = None,
    auth: AuthContext = require_permission('insights:view'),
    db: AsyncSession = Depends(get_db),
):
    """Return queue health summary for the current tenant."""
    from app.config import settings

    now = datetime.now(timezone.utc)
    filters = [BackgroundJob.tenant_id == auth.tenant_id]
    if app_id:
        filters.append(BackgroundJob.app_id == app_id)

    status_rows = await db.execute(
        select(BackgroundJob.status, func.count())
        .where(*filters)
        .group_by(BackgroundJob.status)
    )
    status_counts = {row[0]: row[1] for row in status_rows}

    queue_class_rows = await db.execute(
        select(
            BackgroundJob.queue_class,
            func.count().label("total"),
            func.sum(case((BackgroundJob.status == "queued", 1), else_=0)).label("queued"),
            func.sum(case((BackgroundJob.status == "running", 1), else_=0)).label("running"),
            func.sum(case((BackgroundJob.status == "retryable_failed", 1), else_=0)).label("retryable_failed"),
        )
        .where(*filters)
        .group_by(BackgroundJob.queue_class)
        .order_by(BackgroundJob.queue_class.asc())
    )

    app_rows = await db.execute(
        select(
            BackgroundJob.app_id,
            func.count().label("total"),
            func.sum(case((BackgroundJob.status == "queued", 1), else_=0)).label("queued"),
            func.sum(case((BackgroundJob.status == "running", 1), else_=0)).label("running"),
            func.sum(case((BackgroundJob.status == "retryable_failed", 1), else_=0)).label("retryable_failed"),
        )
        .where(*filters)
        .group_by(BackgroundJob.app_id)
        .order_by(desc("queued"), desc("running"), desc("total"))
        .limit(10)
    )

    job_type_rows = await db.execute(
        select(
            BackgroundJob.job_type,
            func.count().label("total"),
            func.sum(case((BackgroundJob.status == "queued", 1), else_=0)).label("queued"),
            func.sum(case((BackgroundJob.status == "running", 1), else_=0)).label("running"),
            func.sum(case((BackgroundJob.status == "retryable_failed", 1), else_=0)).label("retryable_failed"),
        )
        .where(*filters)
        .group_by(BackgroundJob.job_type)
        .order_by(desc("queued"), desc("running"), desc("total"))
        .limit(10)
    )

    oldest_waiting_row = await db.execute(
        select(BackgroundJob.created_at)
        .where(
            *filters,
            BackgroundJob.status.in_(["queued", "retryable_failed"]),
        )
        .order_by(BackgroundJob.created_at.asc())
        .limit(1)
    )
    oldest_waiting_created_at = oldest_waiting_row.scalar_one_or_none()

    retry_stats_row = await db.execute(
        select(
            func.sum(case((BackgroundJob.status == "retryable_failed", 1), else_=0)).label("scheduled_retries"),
            func.sum(case((BackgroundJob.dead_lettered_at.is_not(None), 1), else_=0)).label("dead_lettered"),
            func.coalesce(
                func.sum(case((BackgroundJob.attempt_count > 1, BackgroundJob.attempt_count - 1), else_=0)),
                0,
            ).label("retry_attempts"),
        )
        .where(*filters)
    )
    retry_stats = retry_stats_row.one()

    expired_lease_row = await db.execute(
        select(func.count())
        .where(
            *filters,
            BackgroundJob.status == "running",
            BackgroundJob.lease_expires_at.is_not(None),
            BackgroundJob.lease_expires_at < now,
        )
        .select_from(BackgroundJob)
    )
    expired_lease_count = expired_lease_row.scalar() or 0

    running_count = status_counts.get("running", 0)
    waiting_count = status_counts.get("queued", 0) + status_counts.get("retryable_failed", 0)

    return {
        "snapshotAt": now,
        "scope": {"tenantId": str(auth.tenant_id), "appId": app_id or None},
        "states": status_counts,
        "capacity": {
            "runningCount": running_count,
            "waitingCount": waiting_count,
            "maxConcurrentPerWorker": settings.JOB_MAX_CONCURRENT,
            "tenantCapPerWorker": settings.JOB_TENANT_MAX_CONCURRENT,
            "appCapPerWorker": settings.JOB_APP_MAX_CONCURRENT,
            "userCapPerWorker": settings.JOB_USER_MAX_CONCURRENT,
            "queueClassCapsPerWorker": {
                "interactive": settings.JOB_INTERACTIVE_MAX_CONCURRENT or settings.JOB_MAX_CONCURRENT,
                "standard": settings.JOB_STANDARD_MAX_CONCURRENT or settings.JOB_MAX_CONCURRENT,
                "bulk": settings.JOB_BULK_MAX_CONCURRENT or settings.JOB_MAX_CONCURRENT,
            },
        },
        "retries": {
            "scheduled": retry_stats.scheduled_retries or 0,
            "deadLettered": retry_stats.dead_lettered or 0,
            "retryAttempts": retry_stats.retry_attempts or 0,
        },
        "leases": {
            "expiredRunningCount": expired_lease_count,
        },
        "oldestWaitingAgeSeconds": (
            max(int((now - oldest_waiting_created_at).total_seconds()), 0)
            if oldest_waiting_created_at
            else 0
        ),
        "queueClasses": [
            {
                "queueClass": row.queue_class,
                "total": row.total,
                "queued": row.queued or 0,
                "running": row.running or 0,
                "retryableFailed": row.retryable_failed or 0,
            }
            for row in queue_class_rows
        ],
        "hotApps": [
            {
                "appId": row.app_id,
                "total": row.total,
                "queued": row.queued or 0,
                "running": row.running or 0,
                "retryableFailed": row.retryable_failed or 0,
            }
            for row in app_rows
        ],
        "hotJobTypes": [
            {
                "jobType": row.job_type,
                "total": row.total,
                "queued": row.queued or 0,
                "running": row.running or 0,
                "retryableFailed": row.retryable_failed or 0,
            }
            for row in job_type_rows
        ],
    }


# ── POST /api/admin/erase ────────────────────────────────────────────────────

@router.post("/erase")
async def erase_data(
    body: EraseRequest,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Selectively erase database records within tenant. Owner only."""
    deleted: dict[str, int] = {}
    app_id = body.app_id
    targets = set(body.targets)
    erase_all = len(targets) == 0  # empty targets = erase everything

    logger.warning(
        "Admin erase requested: tenant_id=%s app_id=%s targets=%s include_seed=%s",
        auth.tenant_id, app_id, targets, body.include_seed_data,
    )

    # ── 1. eval_runs (CASCADE → thread_evaluations, adversarial_evaluations, api_logs) ──
    if erase_all or "eval_runs" in targets:
        q = delete(EvaluationRun).where(EvaluationRun.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(EvaluationRun.app_id == app_id)
        result = await db.execute(q)
        deleted["eval_runs"] = result.rowcount
        logger.info("Deleted %d eval_runs (cascade cleans children)", result.rowcount)

    # ── 2. listings (CASCADE → remaining linked eval_runs) ──
    if erase_all or "listings" in targets:
        q = delete(EvaluationDataset).where(EvaluationDataset.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(EvaluationDataset.app_id == app_id)
        result = await db.execute(q)
        deleted["listings"] = result.rowcount

    # ── 3. chat_sessions (CASCADE → chat_messages + linked eval_runs) ──
    if erase_all or "chat_sessions" in targets:
        q = delete(ChatSession).where(ChatSession.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(ChatSession.app_id == app_id)
        result = await db.execute(q)
        deleted["chat_sessions"] = result.rowcount

    # ── 4. files (with blob cleanup) ──
    if erase_all or "files" in targets:
        from app.services.file_storage import file_storage

        # Fetch all file records within tenant
        file_q = select(ApplicationUploadedFile).where(ApplicationUploadedFile.tenant_id == auth.tenant_id)
        file_result = await db.execute(file_q)
        file_records = file_result.scalars().all()

        blob_errors = 0
        for rec in file_records:
            try:
                await file_storage.delete(rec.storage_path)
            except Exception as e:
                blob_errors += 1
                logger.warning("Failed to delete blob %s: %s", rec.storage_path, e)

        q = delete(ApplicationUploadedFile).where(ApplicationUploadedFile.tenant_id == auth.tenant_id)
        result = await db.execute(q)
        deleted["files"] = result.rowcount
        if blob_errors:
            deleted["files_blob_errors"] = blob_errors

    # ── 5. evaluators ──
    if erase_all or "evaluators" in targets:
        q = delete(Evaluator).where(Evaluator.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(Evaluator.app_id == app_id)
        if not body.include_seed_data:
            q = q.where(
                ~((Evaluator.seed_key != None) & (Evaluator.listing_id == None))
            )
        result = await db.execute(q)
        deleted["evaluators"] = result.rowcount

    # ── 6. prompts ──
    if erase_all or "prompts" in targets:
        q = delete(LibraryPromptDefinition).where(LibraryPromptDefinition.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(LibraryPromptDefinition.app_id == app_id)
        if not body.include_seed_data:
            from app.constants import SYSTEM_TENANT_ID
            q = q.where(LibraryPromptDefinition.tenant_id != SYSTEM_TENANT_ID)
        result = await db.execute(q)
        deleted["prompts"] = result.rowcount

    # ── 7. schemas ──
    if erase_all or "schemas" in targets:
        q = delete(LibraryOutputSchemaDefinition).where(LibraryOutputSchemaDefinition.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(LibraryOutputSchemaDefinition.app_id == app_id)
        if not body.include_seed_data:
            from app.constants import SYSTEM_TENANT_ID
            q = q.where(LibraryOutputSchemaDefinition.tenant_id != SYSTEM_TENANT_ID)
        result = await db.execute(q)
        deleted["schemas"] = result.rowcount

    # ── 8. settings ──
    if erase_all or "settings" in targets:
        q = delete(ApplicationSetting).where(ApplicationSetting.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(ApplicationSetting.app_id == app_id)
        result = await db.execute(q)
        deleted["settings"] = result.rowcount

    # ── 9. tags ──
    if erase_all or "tags" in targets:
        q = delete(ApplicationTag).where(ApplicationTag.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(ApplicationTag.app_id == app_id)
        result = await db.execute(q)
        deleted["tags"] = result.rowcount

    # ── 10. jobs ──
    if erase_all or "jobs" in targets:
        q = delete(BackgroundJob).where(BackgroundJob.tenant_id == auth.tenant_id)
        result = await db.execute(q)
        deleted["jobs"] = result.rowcount

    # ── 11. history ──
    if erase_all or "history" in targets:
        q = delete(ApplicationEventHistory).where(ApplicationEventHistory.tenant_id == auth.tenant_id)
        if app_id:
            q = q.where(ApplicationEventHistory.app_id == app_id)
        result = await db.execute(q)
        deleted["history"] = result.rowcount

    await db.commit()

    logger.warning("Admin erase complete: %s", deleted)
    return {"deleted": deleted}


# ── User Management ──────────────────────────────────────────────────────────

async def _resolve_tenant_role(
    db: AsyncSession, role_id: str, tenant_id: _uuid.UUID
) -> AccessRole:
    """Resolve a client-supplied role id to a role in this tenant.

    Raises 400 for a malformed id and 404 for one outside the tenant, so role
    assignment never 500s on bad input or silently binds another tenant's role.
    """
    try:
        parsed = _uuid.UUID(role_id)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Invalid role id")
    role = await db.scalar(
        select(AccessRole).where(AccessRole.id == parsed, AccessRole.tenant_id == tenant_id)
    )
    if not role:
        raise HTTPException(404, "Role not found")
    return role


@router.get("/users")
async def list_users(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """List all users in the tenant for admin-shell consumers."""
    ensure_any_permission(auth, *ADMIN_SHELL_PERMISSIONS)
    result = await db.execute(
        select(User).where(User.tenant_id == auth.tenant_id).order_by(User.created_at)
    )
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "displayName": u.display_name,
            "roleId": str(u.role_id),
            "roleName": u.role.name,
            "isOwner": u.role.is_system and u.role.name == "Owner",
            "isActive": u.is_active,
            "createdAt": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/users", status_code=201)
async def create_user(
    body: CreateUserRequest,
    request: Request,
    auth: AuthContext = require_permission('user:create'),
    db: AsyncSession = Depends(get_db),
):
    """Create a new user in the tenant."""
    from app.auth.utils import hash_password

    # Enforce tenant domain policy
    from app.routes.auth import _check_allowed_domains, _validate_password_strength
    await _check_allowed_domains(body.email, auth.tenant_id, db)

    # Validate password strength
    strength_error = _validate_password_strength(body.password)
    if strength_error:
        raise HTTPException(400, detail=strength_error)

    # Check duplicate email
    existing = await db.scalar(
        select(User).where(User.tenant_id == auth.tenant_id, User.email == body.email)
    )
    if existing:
        raise HTTPException(400, "A user with this email already exists in this tenant")

    role = await _resolve_tenant_role(db, body.role_id, auth.tenant_id)

    user = User(
        tenant_id=auth.tenant_id,
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        role_id=role.id,
    )
    db.add(user)
    await db.flush()

    from app.services.mail.onboarding import provision_required_subscriptions_for_user
    await provision_required_subscriptions_for_user(
        db,
        tenant_id=user.tenant_id,
        user_id=user.id,
        user_email=user.email,
    )

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="user:create",
        entity_type="user",
        entity_id=user.id,
        after_state={"email": user.email, "role_id": str(user.role_id)},
        request=request,
    )

    await db.commit()
    await db.refresh(user)
    return {
        "id": str(user.id),
        "email": user.email,
        "displayName": user.display_name,
        "roleId": str(user.role_id),
        "roleName": user.role.name,
        "isOwner": user.role.is_system and user.role.name == "Owner",
        "isActive": user.is_active,
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: _uuid.UUID,
    body: UpdateUserRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    """Update a user (name, role_id, is_active) within the tenant."""
    if not auth.is_owner:
        # Check what fields are being changed
        permitted_change_requested = False
        if body.role_id is not None:
            ensure_permissions(auth, 'role:assign')
            permitted_change_requested = True
        if body.display_name is not None:
            ensure_permissions(auth, 'user:edit')
            permitted_change_requested = True
        if body.is_active is not None:
            ensure_permissions(auth, 'user:deactivate')
            permitted_change_requested = True
        if not permitted_change_requested:
            raise HTTPException(403, "No permitted changes in request")

    user = await db.scalar(
        select(User).where(User.id == user_id, User.tenant_id == auth.tenant_id)
    )
    if not user:
        raise HTTPException(404, "User not found")

    before_state = {"role_id": str(user.role_id), "display_name": user.display_name, "is_active": user.is_active}

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role_id is not None:
        role = await _resolve_tenant_role(db, body.role_id, auth.tenant_id)
        user.role_id = role.id
    if body.is_active is not None:
        user.is_active = body.is_active

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="user:update",
        entity_type="user",
        entity_id=user.id,
        before_state=before_state,
        after_state={"role_id": str(user.role_id), "display_name": user.display_name, "is_active": user.is_active},
        request=request,
    )

    await db.commit()
    await db.refresh(user)
    return {
        "id": str(user.id),
        "email": user.email,
        "displayName": user.display_name,
        "roleId": str(user.role_id),
        "roleName": user.role.name,
        "isOwner": user.role.is_system and user.role.name == "Owner",
        "isActive": user.is_active,
    }


class AdminResetPasswordRequest(CamelModel):
    new_password: str


@router.put("/users/{user_id}/password")
async def admin_reset_password(
    user_id: _uuid.UUID,
    body: AdminResetPasswordRequest,
    request: Request,
    auth: AuthContext = require_permission('user:reset_password'),
    db: AsyncSession = Depends(get_db),
):
    """Reset a user's password (admin+). Revokes all their refresh tokens."""
    from app.routes.auth import _validate_password_strength

    strength_error = _validate_password_strength(body.new_password)
    if strength_error:
        raise HTTPException(400, detail=strength_error)

    user = await db.scalar(
        select(User).where(User.id == user_id, User.tenant_id == auth.tenant_id)
    )
    if not user:
        raise HTTPException(404, "User not found")

    # Non-owners cannot reset owner passwords
    if user.role.is_system and user.role.name == "Owner" and not auth.is_owner:
        raise HTTPException(403, detail="Only owners can reset owner passwords")

    # Prevent reusing the same password
    from app.auth.utils import verify_password as _verify
    if _verify(body.new_password, user.password_hash):
        raise HTTPException(400, detail="New password must be different from current password")

    user.password_hash = hash_password(body.new_password)

    # Revoke all refresh tokens to force re-login
    await db.execute(
        delete(IdentityRefreshToken).where(IdentityRefreshToken.user_id == user.id)
    )

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="user:reset_password",
        entity_type="user",
        entity_id=user.id,
        request=request,
    )

    await db.commit()
    return {"status": "ok", "id": str(user_id)}


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: _uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('user:deactivate'),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a user. Does not delete data."""
    user = await db.scalar(
        select(User).where(User.id == user_id, User.tenant_id == auth.tenant_id)
    )
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == auth.user_id:
        raise HTTPException(400, "Cannot deactivate yourself")

    user.is_active = False

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="user:deactivate",
        entity_type="user",
        entity_id=user.id,
        before_state={"is_active": True},
        after_state={"is_active": False},
        request=request,
    )

    await db.commit()
    return {"deactivated": True, "id": str(user_id)}


@router.delete("/users/{user_id}/permanent")
async def delete_user_permanently(
    user_id: _uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('user:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a user and their refresh tokens."""
    user = await db.scalar(
        select(User).where(User.id == user_id, User.tenant_id == auth.tenant_id)
    )
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == auth.user_id:
        raise HTTPException(400, "Cannot delete yourself")
    if user.role.is_system and user.role.name == "Owner":
        raise HTTPException(400, "Cannot delete the tenant owner")

    # Remove refresh tokens first
    await db.execute(
        delete(IdentityRefreshToken).where(IdentityRefreshToken.user_id == user.id)
    )

    await write_audit_log(
        db,
        tenant_id=auth.tenant_id,
        actor_id=auth.user_id,
        action="user:delete",
        entity_type="user",
        entity_id=user.id,
        before_state={"email": user.email, "display_name": user.display_name},
        after_state=None,
        request=request,
    )

    await db.delete(user)
    await db.commit()
    return {"deleted": True, "id": str(user_id)}


# ── Tenant Management ────────────────────────────────────────────────────────

@router.get("/tenant")
async def get_tenant(
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Get tenant details (owner only)."""
    tenant = await db.scalar(select(Tenant).where(Tenant.id == auth.tenant_id))
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "isActive": tenant.is_active,
        "createdAt": tenant.created_at.isoformat() if tenant.created_at else None,
    }


@router.patch("/tenant")
async def update_tenant(
    body: UpdateTenantRequest,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Update tenant name (owner only)."""
    tenant = await db.scalar(select(Tenant).where(Tenant.id == auth.tenant_id))
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    if body.name is not None:
        tenant.name = body.name

    await db.commit()
    await db.refresh(tenant)
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "isActive": tenant.is_active,
    }


# ── Invite Links ─────────────────────────────────────────────────────────────


class CreateInviteLinkRequest(CamelModel):
    label: Optional[str] = None
    role_id: str
    max_uses: Optional[int] = None
    expires_in_hours: int = 168  # 7 days
    # SSO seam — accepted at the schema level so the frontend can prepare,
    # but the create route hard-rejects ``sso`` until the SSO redemption
    # path lands. Persisted as the row's ``signup_method`` once allowed.
    signup_method: Literal['password', 'sso'] = 'password'
    # Optional auto-send: when set, the invite link is emailed to this
    # address via the mail subsystem. Send failure does not roll back invite.
    recipient_email: Optional[EmailStr] = None
    user_name: Optional[str] = None


_INVITE_CREATOR_FALLBACK = "(deleted user)"


def _resolve_creator_email(
    invite: IdentityInviteLink, live_email: Optional[str]
) -> str:
    """Live email → snapshot → stable fallback. Phase 1 keeps the existing
    ``createdByEmail`` field shape; the snapshot lets invite rows survive
    creator deletion now that ``created_by`` is ``ON DELETE SET NULL``."""
    if live_email:
        return live_email
    if invite.created_by_email_snapshot:
        return invite.created_by_email_snapshot
    return _INVITE_CREATOR_FALLBACK


async def _load_live_creator_email(
    db: AsyncSession,
    invite: IdentityInviteLink,
) -> Optional[str]:
    if not invite.created_by:
        return None
    return await db.scalar(
        select(User.email).where(User.id == invite.created_by)
    )


def _invite_response(invite: IdentityInviteLink, creator_email: str) -> dict:
    return {
        "id": str(invite.id),
        "label": invite.label,
        "roleId": str(invite.role_id),
        "maxUses": invite.max_uses,
        "usesCount": invite.uses_count,
        "expiresAt": invite.expires_at.isoformat(),
        "status": invite.status.value,
        "signupMethod": invite.signup_method.value,
        "revokedAt": invite.revoked_at.isoformat() if invite.revoked_at else None,
        "revokedBy": str(invite.revoked_by) if invite.revoked_by else None,
        "revokedByEmail": invite.revoked_by_email_snapshot,
        "createdAt": invite.created_at.isoformat() if invite.created_at else None,
        "createdBy": str(invite.created_by) if invite.created_by else None,
        "createdByEmail": creator_email,
    }


def _invite_base_url(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")

    from app.config import settings
    return settings.APP_BASE_URL.rstrip("/")


@router.post("/invite-links", status_code=201)
async def create_invite_link(
    body: CreateInviteLinkRequest,
    request: Request,
    auth: AuthContext = require_permission('invite_link:manage'),
    db: AsyncSession = Depends(get_db),
):
    """Generate an invite link for self-service signup (admin+)."""
    if body.expires_in_hours < 1 or body.expires_in_hours > 720:
        raise HTTPException(400, detail="Expiry must be between 1 and 720 hours")
    if body.max_uses is not None and body.max_uses < 1:
        raise HTTPException(400, detail="Max uses must be at least 1")
    if body.signup_method == 'sso':
        # The column accepts ``sso``, but the redemption path isn't wired
        # yet. Hard-reject so an admin can't issue an unredeemable invite.
        raise HTTPException(501, detail="SSO invites are not yet supported")

    role = await _resolve_tenant_role(db, body.role_id, auth.tenant_id)

    raw_token, token_hash = create_refresh_token()  # reuse same random+hash pattern

    invite = IdentityInviteLink(
        tenant_id=auth.tenant_id,
        created_by=auth.user_id,
        token_hash=token_hash,
        label=body.label,
        role_id=role.id,
        max_uses=body.max_uses,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours),
        status=InviteStatus.active,
        signup_method=InviteSignupMethod(body.signup_method),
        created_by_email_snapshot=auth.email,
    )
    db.add(invite)
    await db.flush()

    # Commit the invite first so the email send never references an
    # uncommitted row. The audit row is written after the email-status is
    # known, in its own commit — best-effort, never atomic with the invite.
    await db.commit()
    await db.refresh(invite)

    # Prefer the current frontend origin so local IP changes do not break generated links.
    base = _invite_base_url(request)
    invite_url = f"{base}/signup?invite={raw_token}"

    email_status = await _maybe_send_invite_email(
        db,
        tenant_id=auth.tenant_id,
        recipient_email=body.recipient_email,
        user_name=body.user_name,
        invite_url=invite_url,
        inviter_email=auth.email,
        expires_at=invite.expires_at,
        correlation_id=str(invite.id),
    )

    try:
        await write_audit_log(
            db,
            tenant_id=auth.tenant_id,
            actor_id=auth.user_id,
            action="invite_link:create",
            entity_type="invite_link",
            entity_id=invite.id,
            after_state={
                "label": invite.label,
                "role_id": str(invite.role_id),
                "email_recipient": body.recipient_email,
                "email_status": email_status,
            },
            request=request,
        )
        await db.commit()
    except Exception as exc:  # don't orphan the invite if audit fails
        await db.rollback()
        logger.error(
            "invite_audit_write_failed",
            extra={"invite_id": str(invite.id), "error": str(exc)},
        )

    resp = _invite_response(invite, auth.email)
    resp["inviteUrl"] = invite_url
    resp["emailStatus"] = email_status
    return resp


EmailStatus = Literal[
    "not_requested", "sent", "recipient_rejected", "not_configured", "failed"
]


async def _maybe_send_invite_email(
    db: AsyncSession,
    *,
    tenant_id: _uuid.UUID,
    recipient_email: Optional[str],
    user_name: Optional[str],
    invite_url: str,
    inviter_email: str,
    expires_at: datetime,
    correlation_id: str,
) -> EmailStatus:
    """Render + send the signup invite if a recipient is set; return the emailStatus."""
    if not recipient_email:
        return "not_requested"
    try:
        await _check_allowed_domains(recipient_email, tenant_id, db)
    except HTTPException:
        logger.info(
            "invite_email_recipient_rejected",
            extra={"invite_id": correlation_id, "recipient": recipient_email},
        )
        return "recipient_rejected"
    from zoneinfo import ZoneInfo
    try:
        await send_mail(
            db,
            tenant_id=tenant_id,
            call_site=CallSite.SIGNUP_INVITE,
            recipient=recipient_email,
            context={
                "user_name": user_name or recipient_email.split("@")[0],
                "inviter_name": inviter_email,
                "invite_url": invite_url,
                "expires_at_display": expires_at.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST"),
            },
            correlation_id=correlation_id,
        )
        await db.commit()
        return "sent"
    except MailNotConfigured:
        return "not_configured"
    except MailSendError as exc:
        await db.commit()  # persist the failure log row
        logger.warning("invite_email_failed", extra={"error": str(exc), "invite_id": correlation_id})
        return "failed"


@router.get("/invite-links")
async def list_invite_links(
    status: Literal['active', 'terminal', 'all'] = Query('active'),
    include: Optional[str] = Query(None, description="csv of optional projections; 'latestSend' joins mail_send_log"),
    auth: AuthContext = require_permission('invite_link:manage'),
    db: AsyncSession = Depends(get_db),
):
    """List invite links for the tenant (admin+).

    ``status`` filters server-side:
    - ``active`` (default) → only invites currently usable.
    - ``terminal`` → revoked / expired / exhausted.
    - ``all`` → everything.

    ``include=latestSend`` joins the most recent ``mail_send_log`` row per
    invite (by ``correlation_id == invite.id``) so the list view can render
    "Sent to" + "Last send status" columns without an N+1.

    Lazy correction: rows still labelled ``active`` whose timer has run
    out or whose ``max_uses`` is hit get persisted to their derived
    terminal status before the response is sent. Bounded so a list query
    never amplifies into a large fan-out.
    """
    stmt = (
        select(IdentityInviteLink, User.email)
        .outerjoin(User, IdentityInviteLink.created_by == User.id)
        .where(IdentityInviteLink.tenant_id == auth.tenant_id)
        .order_by(IdentityInviteLink.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    invites = [invite for invite, _email in rows]
    previous_statuses = [invite.status for invite in invites]
    await invite_link_service.lazily_persist_status_corrections(invites)
    if any(invite.status != previous for invite, previous in zip(invites, previous_statuses, strict=False)):
        await db.commit()

    if status == 'active':
        rows = [(invite, email) for invite, email in rows if invite.status == InviteStatus.active]
    elif status == 'terminal':
        rows = [(invite, email) for invite, email in rows if invite.status != InviteStatus.active]

    include_str = include if isinstance(include, str) else ""
    includes = {p.strip() for p in include_str.split(",") if p.strip()}
    latest_send_by_invite: dict[str, dict] = {}
    if "latestSend" in includes and rows:
        latest_send_by_invite = await _load_latest_invite_sends(
            db,
            tenant_id=auth.tenant_id,
            invite_ids=[str(invite.id) for invite, _ in rows],
        )

    payload = []
    for invite, email in rows:
        item = _invite_response(invite, _resolve_creator_email(invite, email))
        if "latestSend" in includes:
            latest = latest_send_by_invite.get(str(invite.id))
            item["latestSendRecipient"] = latest["recipient"] if latest else None
            item["latestSendStatus"] = latest["status"] if latest else None
            item["latestSendAt"] = latest["sent_at"].isoformat() if latest else None
        payload.append(item)
    return payload


async def _load_latest_invite_sends(
    db: AsyncSession,
    *,
    tenant_id: _uuid.UUID,
    invite_ids: list[str],
) -> dict[str, dict]:
    """Return ``{invite_id: latest mail_send_log row}`` per invite, tenant-filtered."""
    from app.models.mail_send_log import MailSendLog

    rn = func.row_number().over(
        partition_by=MailSendLog.correlation_id,
        order_by=MailSendLog.sent_at.desc(),
    ).label("rn")
    inner = (
        select(
            MailSendLog.correlation_id.label("correlation_id"),
            MailSendLog.recipient.label("recipient"),
            MailSendLog.status.label("status"),
            MailSendLog.sent_at.label("sent_at"),
            rn,
        )
        .where(MailSendLog.tenant_id == tenant_id)
        .where(MailSendLog.correlation_id.in_(invite_ids))
        .subquery()
    )
    stmt = select(
        inner.c.correlation_id,
        inner.c.recipient,
        inner.c.status,
        inner.c.sent_at,
    ).where(inner.c.rn == 1)
    rows = (await db.execute(stmt)).all()
    return {
        row.correlation_id: {
            "recipient": row.recipient,
            "status": row.status,
            "sent_at": row.sent_at,
        }
        for row in rows
    }


@router.post("/invite-links/{link_id}/revoke")
async def revoke_invite_link_v2(
    link_id: _uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('invite_link:manage'),
    db: AsyncSession = Depends(get_db),
):
    """Revoke an invite link (canonical endpoint).

    Returns the updated row so the frontend can update its cache without
    a follow-up GET. ``409`` if the row is already terminal — this is the
    enforcement that the legacy ``DELETE`` route silently lacked.
    """
    try:
        invite = await invite_link_service.revoke_invite_link(
            db,
            tenant_id=auth.tenant_id,
            invite_id=link_id,
            actor_id=auth.user_id,
            actor_email=auth.email,
            request=request,
        )
    except LookupError:
        raise HTTPException(404, detail="Invite link not found")
    except invite_link_service.InviteLinkAlreadyTerminal as exc:
        await db.commit()
        raise HTTPException(
            409, detail=f"invite link is already {exc.args[0]}"
        )
    await db.commit()
    creator_email = await _load_live_creator_email(db, invite)
    return _invite_response(invite, _resolve_creator_email(invite, creator_email))


@router.delete("/invite-links/{link_id}")
async def hard_delete_invite_link(
    link_id: _uuid.UUID,
    request: Request,
    auth: AuthContext = require_permission('invite_link:delete'),
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete a terminal invite. Cascades the redemption audit rows.

    Soft-revoke moved to ``POST /revoke`` in Phase 2; this verb now
    means "permanently remove the row". Returns 409 on active rows so
    callers can't bypass the audit trail by deleting before revoking.
    """
    try:
        await invite_link_service.hard_delete_invite_link(
            db,
            tenant_id=auth.tenant_id,
            invite_id=link_id,
            actor_id=auth.user_id,
            request=request,
        )
    except LookupError:
        raise HTTPException(404, detail="Invite link not found")
    except invite_link_service.InviteLinkNotTerminal as exc:
        raise HTTPException(
            409,
            detail=(
                f"invite link is currently {exc.args[0]}; revoke it first "
                "before permanent deletion"
            ),
        )
    await db.commit()
    return {"deleted": True, "id": str(link_id)}


@router.get("/invite-links/{link_id}/uses")
async def list_invite_link_uses(
    link_id: _uuid.UUID,
    auth: AuthContext = require_permission('invite_link:manage'),
    db: AsyncSession = Depends(get_db),
):
    """Forensic drill-in: who redeemed this invite, when, from where.

    ``ipHashPrefix`` = first 12 chars of the per-tenant SHA-256 hash —
    enough for "did the same IP redeem multiple invites" without
    exposing the full hash.
    """
    invite = await db.scalar(
        select(IdentityInviteLink).where(
            IdentityInviteLink.id == link_id,
            IdentityInviteLink.tenant_id == auth.tenant_id,
        )
    )
    if not invite:
        raise HTTPException(404, detail="Invite link not found")

    uses = await invite_link_service.list_invite_uses(
        db, invite_link_id=invite.id
    )
    return {
        "items": [
            {
                "id": str(u.id),
                "userId": str(u.user_id) if u.user_id else None,
                "userEmail": u.user_email_snapshot,
                "usedAt": u.used_at.isoformat(),
                "ipHashPrefix": (u.ip_hash[:12] + "…") if u.ip_hash else None,
            }
            for u in uses
        ]
    }


# ── Tenant Config ─────────────────────────────────────────────────────────────


class UpdateTenantConfigRequest(CamelModel):
    app_url: Optional[str] = None
    logo_url: Optional[str] = None
    allowed_domains: Optional[list[str]] = None


def _tenant_config_response(config: TenantConfiguration) -> dict:
    return {
        "id": str(config.id),
        "tenantId": str(config.tenant_id),
        "appUrl": config.app_url,
        "logoUrl": config.logo_url,
        "allowedDomains": config.allowed_domains or [],
        "createdAt": config.created_at.isoformat() if config.created_at else None,
        "updatedAt": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.get("/tenant-config")
async def get_tenant_config(
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Get tenant config (owner only). Creates default config if none exists."""
    config = await db.scalar(
        select(TenantConfiguration).where(TenantConfiguration.tenant_id == auth.tenant_id)
    )
    if not config:
        config = TenantConfiguration(tenant_id=auth.tenant_id)
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return _tenant_config_response(config)


@router.patch("/tenant-config")
async def update_tenant_config(
    body: UpdateTenantConfigRequest,
    auth: AuthContext = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Update tenant config (owner only)."""
    config = await db.scalar(
        select(TenantConfiguration).where(TenantConfiguration.tenant_id == auth.tenant_id)
    )
    if not config:
        config = TenantConfiguration(tenant_id=auth.tenant_id)
        db.add(config)
        await db.flush()

    if body.app_url is not None:
        config.app_url = body.app_url or None
    if body.logo_url is not None:
        config.logo_url = body.logo_url or None
    if body.allowed_domains is not None:
        # Normalize: lowercase, ensure @ prefix
        config.allowed_domains = [
            d.lower() if d.startswith("@") else f"@{d.lower()}"
            for d in body.allowed_domains
            if d.strip()
        ]

    await db.commit()
    await db.refresh(config)
    return _tenant_config_response(config)
