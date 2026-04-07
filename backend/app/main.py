"""FastAPI application entry point."""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import delete, text

from app.config import settings
from app.database import engine, get_db, async_session
from app.models.user import RefreshToken
from app.startup_schema import bootstrap_database_schema

logger = logging.getLogger(__name__)

LEGACY_ROLE_PERMISSION_NORMALIZATION_SQL = (
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'evaluation:run'
    FROM role_permissions
    WHERE permission = 'eval:run'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'evaluation:export'
    FROM role_permissions
    WHERE permission = 'eval:export'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'asset:create'
    FROM role_permissions
    WHERE permission = 'resource:create'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'asset:edit'
    FROM role_permissions
    WHERE permission = 'resource:edit'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'asset:delete'
    FROM role_permissions
    WHERE permission = 'resource:delete'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'insights:view'
    FROM role_permissions
    WHERE permission = 'analytics:view'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'configuration:edit'
    FROM role_permissions
    WHERE permission = 'settings:edit'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'invite_link:manage'
    FROM role_permissions
    WHERE permission = 'user:invite'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'evaluation:cancel'
    FROM role_permissions
    WHERE permission = 'eval:delete'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    INSERT INTO role_permissions (role_id, permission)
    SELECT role_id, 'evaluation:delete'
    FROM role_permissions
    WHERE permission = 'eval:delete'
    ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING
    """,
    """
    DELETE FROM role_permissions
    WHERE permission IN (
        'eval:run',
        'eval:delete',
        'eval:export',
        'resource:create',
        'resource:edit',
        'resource:delete',
        'analytics:view',
        'settings:edit',
        'user:invite',
        'tenant:settings',
        'evaluator:promote'
    )
    """,
)


def _validate_startup_config() -> None:
    """Fail fast if critical config is missing."""
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is required. Set it in .env.backend.")
    if settings.JOB_HEARTBEAT_INTERVAL_SECONDS >= settings.JOB_LEASE_SECONDS:
        raise RuntimeError("JOB_HEARTBEAT_INTERVAL_SECONDS must be less than JOB_LEASE_SECONDS.")
    if settings.JOB_MAX_ATTEMPTS < 1:
        raise RuntimeError("JOB_MAX_ATTEMPTS must be at least 1.")
    if settings.JOB_RETRY_BASE_DELAY_SECONDS < 1:
        raise RuntimeError("JOB_RETRY_BASE_DELAY_SECONDS must be at least 1.")
    if settings.JOB_RETRY_MAX_DELAY_SECONDS < settings.JOB_RETRY_BASE_DELAY_SECONDS:
        raise RuntimeError("JOB_RETRY_MAX_DELAY_SECONDS must be greater than or equal to JOB_RETRY_BASE_DELAY_SECONDS.")
    if settings.JOB_TENANT_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_TENANT_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_APP_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_APP_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_USER_MAX_CONCURRENT < 1:
        raise RuntimeError("JOB_USER_MAX_CONCURRENT must be at least 1.")
    if settings.JOB_CLAIM_WINDOW_MULTIPLIER < 1:
        raise RuntimeError("JOB_CLAIM_WINDOW_MULTIPLIER must be at least 1.")
    if settings.JOB_CLAIM_WINDOW_MAX < 1:
        raise RuntimeError("JOB_CLAIM_WINDOW_MAX must be at least 1.")


async def _cleanup_expired_refresh_tokens() -> None:
    """Delete expired refresh tokens. Called from recovery loop."""
    async with async_session() as db:
        result = await db.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < datetime.now(timezone.utc))
        )
        if result.rowcount:
            await db.commit()
            logger.info("Cleaned up %d expired refresh tokens", result.rowcount)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup, start background worker."""
    _validate_startup_config()

    await bootstrap_database_schema()

    async with engine.begin() as conn:
        await conn.execute(text(
            "UPDATE settings SET visibility = 'SHARED' WHERE visibility = 'APP'"
        ))
        await conn.execute(text(
            "UPDATE prompts SET visibility = 'SHARED' WHERE visibility = 'APP'"
        ))
        await conn.execute(text(
            "UPDATE schemas SET visibility = 'SHARED' WHERE visibility = 'APP'"
        ))
        await conn.execute(text(
            "UPDATE evaluators SET visibility = 'SHARED' WHERE visibility = 'APP'"
        ))
        await conn.execute(text(
            "UPDATE eval_runs SET visibility = 'SHARED' WHERE visibility = 'APP'"
        ))
        # Normalize stored role permissions to the canonical catalog before auth
        # loads role grants for requests and seeded roles.
        for statement in LEGACY_ROLE_PERMISSION_NORMALIZATION_SQL:
            await conn.execute(text(statement))
        await conn.execute(text(
            "DROP INDEX IF EXISTS uq_settings_app_scope"
        ))

    # Seed system tenant/user + default prompts/schemas, then bootstrap admin
    from app.services.seed_defaults import seed_all_defaults, seed_bootstrap_admin
    async with async_session() as session:
        await seed_all_defaults(session)
    await seed_bootstrap_admin()

    # Clean up any expired refresh tokens from previous run
    await _cleanup_expired_refresh_tokens()

    worker_task = None
    recovery_task = None
    if settings.JOB_RUN_EMBEDDED_WORKER:
        # Recover any jobs stuck in "running" from a previous crash,
        # then reconcile any eval_runs orphaned by the same crash
        from app.services.job_worker import recover_stale_jobs, recover_stale_eval_runs, worker_loop, recovery_loop
        await recover_stale_jobs()
        await recover_stale_eval_runs()

        # Start background job worker and periodic recovery loop
        worker_task = asyncio.create_task(worker_loop())
        recovery_task = asyncio.create_task(recovery_loop())
    else:
        logger.info("Embedded job worker disabled; expecting a separate worker process")

    yield

    # Cleanup
    if worker_task:
        worker_task.cancel()
    if recovery_task:
        recovery_task.cancel()
    await engine.dispose()


app = FastAPI(
    title="AI Evals Platform API",
    version="1.0.0",
    description="Backend API for AI evaluation pipelines.",
    lifespan=lifespan,
)

# Rate limiter (used by auth routes via app.state.limiter)
limiter = Limiter(key_func=get_remote_address, default_limits=[])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Verify API and database connectivity."""
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}


# Register routers
from app.routes.listings import router as listings_router
from app.routes.files import router as files_router
from app.routes.evaluators import router as evaluators_router
from app.routes.chat import router as chat_router
from app.routes.history import router as history_router
from app.routes.settings import router as settings_router
from app.routes.tags import router as tags_router
from app.routes.jobs import router as jobs_router
from app.routes.eval_runs import router as eval_runs_router, threads_router
from app.routes.llm import router as llm_router
from app.routes.adversarial_config import router as adversarial_config_router
from app.routes.adversarial_test_cases import router as adversarial_test_cases_router
from app.routes.admin import router as admin_router
from app.routes.reports import router as reports_router
from app.routes.auth import router as auth_router
from app.routes.inside_sales import router as inside_sales_router
from app.routes.apps import router as apps_router
from app.routes.roles import router as roles_router
from app.routes.rules import router as rules_router
from app.routes.eval_templates import router as eval_templates_router
app.include_router(auth_router)
app.include_router(listings_router)
app.include_router(files_router)
app.include_router(evaluators_router)
app.include_router(chat_router)
app.include_router(history_router)
app.include_router(settings_router)
app.include_router(tags_router)
app.include_router(jobs_router)
app.include_router(eval_runs_router)
app.include_router(threads_router)
app.include_router(llm_router)
app.include_router(adversarial_config_router)
app.include_router(adversarial_test_cases_router)
app.include_router(admin_router)
app.include_router(reports_router)
app.include_router(inside_sales_router)
app.include_router(apps_router)
app.include_router(roles_router)
app.include_router(rules_router)
app.include_router(eval_templates_router)
