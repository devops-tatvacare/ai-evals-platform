"""FastAPI application entry point."""
import asyncio
import logging
import warnings
from contextlib import asynccontextmanager
from datetime import datetime, timezone

# Pydantic 2.13 + FastAPI emit UnsupportedFieldAttributeWarning for every
# CamelModel-derived request body (aliases produced by alias_generator=to_camel
# reach pydantic's _apply_single_annotation via fastapi._compat.ModelField
# wrapping fields in Annotated[type, FieldInfo(...)]; pydantic's internal
# suppression only covers FieldInfo subclasses, so the plain FieldInfo used
# by FastAPI trips the warning). The warning is cosmetic — request/response
# serialization still honors the aliases. Silence it at import time so the
# logs stay useful. Upstream fix tracked in pydantic; remove this once we
# upgrade past the version that addresses it.
from pydantic.warnings import UnsupportedFieldAttributeWarning

warnings.filterwarnings("ignore", category=UnsupportedFieldAttributeWarning)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import engine, get_db, async_session
from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.gzip_safe import GZipSafeMiddleware
from app.models.user import IdentityRefreshToken

logger = logging.getLogger(__name__)


def _validate_startup_config() -> None:
    """Fail fast if critical config is missing."""
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is required. Set it in .env.backend.")
    if not settings.ORCHESTRATION_CONNECTION_KEY:
        raise RuntimeError(
            "ORCHESTRATION_CONNECTION_KEY environment variable is required. "
            "Generate one with `python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\"` and add it to .env.backend."
        )
    # Round-trip a small token so an invalid base64 / wrong-length value is
    # rejected at boot, not the first time an operator opens the connections page.
    from app.services.orchestration.connections.crypto import (
        ConnectionCryptoError,
        assert_key_valid,
    )
    try:
        assert_key_valid()
    except ConnectionCryptoError as exc:
        raise RuntimeError(f"ORCHESTRATION_CONNECTION_KEY is invalid: {exc}") from exc
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
            delete(IdentityRefreshToken).where(IdentityRefreshToken.expires_at < datetime.now(timezone.utc))
        )
        if result.rowcount:
            await db.commit()
            logger.info("Cleaned up %d expired refresh tokens", result.rowcount)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup, start background worker."""
    from app.logging_config import configure_logging
    configure_logging()

    _validate_startup_config()

    # Eagerly import the job worker so ``@register_job_handler`` runs and
    # populates both JOB_HANDLERS and the scheduler workload registry
    # before any request hits ``/api/jobs`` or ``/api/scheduled-jobs/registry``.
    # This is required in dedicated-worker deployments (JOB_RUN_EMBEDDED_WORKER=false)
    # where the API process never starts the job loop itself — without this
    # import, unknown-job-type validation and the scheduled-workload list
    # would see an empty registry on the first request after boot.
    # (Aliased import: the lifespan param is named ``app``, shadowing the
    # top-level ``app`` package.)
    import app.services.job_worker as _register_job_handlers  # noqa: F401
    # Register the orchestration shared node handlers (10 nodes — source/filter/logic/core/sink).
    # The package __init__ imports each module so @register_node fires.
    import app.services.orchestration.nodes as _register_orch_nodes  # noqa: F401

    # Schema is owned by Alembic; migrations were applied by entrypoint.sh's
    # `alembic upgrade head` before this process started. Log the alembic head
    # for diagnostics, then sync manifest-driven COMMENT ON COLUMN rows
    # (separate from Alembic; Sherlock's SQL agent reads pg_description).
    from scripts.sync_column_comments import sync_column_comments
    async with engine.begin() as _boot_conn:
        _head_row = (
            await _boot_conn.execute(text("SELECT version_num FROM public.alembic_version"))
        ).first()
        logger.info(
            "alembic_head=%s",
            _head_row[0] if _head_row else "<unstamped>",
        )
        await sync_column_comments(_boot_conn)

    # Fail boot if any Sherlock manifest drifts from live Postgres schema.
    from app.database import async_session
    from app.services.chat_engine.manifest_validator import run_manifest_validator
    async with async_session() as _validator_db:
        await run_manifest_validator(_validator_db)

    # Seed system tenant/user + default prompts/schemas, then bootstrap admin
    from app.services.seed_defaults import seed_all_defaults, seed_bootstrap_admin
    async with async_session() as session:
        await seed_all_defaults(session)
    await seed_bootstrap_admin()

    # Phase 3 acceptance gate: raise on unknown pack id in any app config.
    # Runs after seed so stale ``App.config.chat.capabilities`` arrays have
    # already been rewritten by ``seed_apps`` to the current canonical set
    # before the validator inspects live rows.
    from app.services.chat_engine.capability_pack import validate_all_app_pack_ids
    async with async_session() as _pack_validator_db:
        await validate_all_app_pack_ids(_pack_validator_db)

    # Clean up any expired refresh tokens from previous run
    await _cleanup_expired_refresh_tokens()

    worker_task = None
    recovery_task = None
    scheduler_task = None
    if settings.JOB_RUN_EMBEDDED_WORKER:
        # Recover any jobs stuck in "running" from a previous crash,
        # then reconcile any evaluation_runs orphaned by the same crash
        from app.services.job_worker import (
            recover_stale_jobs,
            recover_stale_eval_runs,
            recover_stale_source_sync_runs,
            recover_stale_workflow_runs,
            worker_loop,
            recovery_loop,
        )
        await recover_stale_jobs()
        await recover_stale_eval_runs()
        await recover_stale_source_sync_runs()
        await recover_stale_workflow_runs()

        # Start background job worker and periodic recovery loop
        worker_task = asyncio.create_task(worker_loop())
        recovery_task = asyncio.create_task(recovery_loop())

        # Scheduler tick loop also runs inside the embedded path so single-
        # container deployments (no dedicated worker process) still fire
        # cron-driven `scheduled_jobs`. Set SCHEDULER_TICK_INTERVAL_SECONDS=0
        # to opt out (useful when a dedicated worker container handles ticking).
        # tick_once uses FOR UPDATE SKIP LOCKED, so multiple tickers are safe.
        if settings.SCHEDULER_TICK_INTERVAL_SECONDS > 0:
            from app.services.scheduler.engine import scheduler_tick_loop
            scheduler_task = asyncio.create_task(scheduler_tick_loop())
        else:
            logger.warning(
                "scheduler.disabled SCHEDULER_TICK_INTERVAL_SECONDS=%s — "
                "embedded worker will NOT fire scheduled_jobs on this replica.",
                settings.SCHEDULER_TICK_INTERVAL_SECONDS,
            )
    else:
        logger.info("Embedded job worker disabled; expecting a separate worker process")

    yield

    # Cleanup
    if worker_task:
        worker_task.cancel()
    if recovery_task:
        recovery_task.cancel()
    if scheduler_task:
        scheduler_task.cancel()
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


async def _integrity_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Map DB constraint violations to 409 instead of 500.

    Catches FK / unique violations from raw SQL or ORM flushes that escape
    pre-write guards (e.g. NO ACTION FK on a child table the route forgot
    to clean up). Returning 409 keeps the API contract stable and gives
    clients a parseable error instead of a generic 500.
    """
    detail = "Database constraint violated"
    orig = getattr(exc, "orig", None)
    if orig is not None:
        constraint = getattr(orig.diag, "constraint_name", None) if hasattr(orig, "diag") else None
        if constraint:
            detail = f"Database constraint violated: {constraint}"
    logger.warning(
        "IntegrityError on %s %s: %s",
        request.method, request.url.path, exc, exc_info=True,
    )
    return JSONResponse(status_code=409, content={"detail": detail})


app.add_exception_handler(IntegrityError, _integrity_error_handler)

# Correlation id — sets a per-request UUID via ContextVar so every
# analytics.fact_llm_generation row recorded downstream shares one id. Honors inbound
# X-Correlation-Id when supplied. Registered before CORS/GZip so the
# contextvar is set for middleware-layer work as well.
app.add_middleware(CorrelationIdMiddleware)

# Compression — skipped for SSE (paths ending in /stream)
app.add_middleware(GZipSafeMiddleware, minimum_size=1000)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


API_VERSION = "2.1.0"

@app.get("/api/health")
async def health_check():
    """Verify API and database connectivity."""
    try:
        async for db in get_db():
            await db.execute(text("SELECT 1"))
            return {"status": "ok", "database": "connected", "version": API_VERSION}
    except Exception as e:
        return {"status": "error", "database": str(e), "version": API_VERSION}


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
from app.routes.report_builder import router as report_builder_router, v2_router as report_builder_v2_router
from app.routes.chat_engine import router as chat_engine_router
from app.routes.auth import router as auth_router
from app.routes.inside_sales import router as inside_sales_router
from app.routes.apps import router as apps_router
from app.routes.roles import router as roles_router
from app.routes.rules import router as rules_router
from app.routes.eval_templates import router as eval_templates_router
from app.routes.reviews import router as reviews_router
from app.routes.analytics_library import router as analytics_library_router
from app.routes.cost import router as cost_router, admin_router as cost_admin_router
from app.routes.scheduled_jobs import router as scheduled_jobs_router
from app.routes.orchestration_webhooks import router as orchestration_webhooks_router
from app.routes.orchestration import router as orchestration_router
from app.routes.orchestration_connections import router as orchestration_connections_router
from app.routes.orchestration_datasets import router as orchestration_datasets_router
from app.routes.orchestration_sse import router as orchestration_sse_router
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
app.include_router(report_builder_router)
app.include_router(report_builder_v2_router)
app.include_router(chat_engine_router)
app.include_router(inside_sales_router)
app.include_router(apps_router)
app.include_router(roles_router)
app.include_router(rules_router)
app.include_router(eval_templates_router)
app.include_router(reviews_router)
app.include_router(analytics_library_router)
app.include_router(cost_router)
app.include_router(cost_admin_router)
app.include_router(scheduled_jobs_router)
app.include_router(orchestration_webhooks_router)
app.include_router(orchestration_router)
app.include_router(orchestration_connections_router)
app.include_router(orchestration_datasets_router)
app.include_router(orchestration_sse_router)
