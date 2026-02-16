"""FastAPI application entry point."""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine, get_db
from app.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup, start background worker."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Start background job worker
    from app.services.job_worker import worker_loop
    worker_task = asyncio.create_task(worker_loop())

    yield

    # Cleanup
    worker_task.cancel()
    await engine.dispose()


app = FastAPI(
    title="AI Evals Platform API",
    version="1.0.0",
    description="Backend API for AI evaluation pipelines.",
    lifespan=lifespan,
)

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
from app.routes.prompts import router as prompts_router
from app.routes.schemas import router as schemas_router
from app.routes.evaluators import router as evaluators_router
from app.routes.chat import router as chat_router
from app.routes.history import router as history_router
from app.routes.settings import router as settings_router
from app.routes.tags import router as tags_router
from app.routes.jobs import router as jobs_router
from app.routes.eval_runs import router as eval_runs_router
app.include_router(listings_router)
app.include_router(files_router)
app.include_router(prompts_router)
app.include_router(schemas_router)
app.include_router(evaluators_router)
app.include_router(chat_router)
app.include_router(history_router)
app.include_router(settings_router)
app.include_router(tags_router)
app.include_router(jobs_router)
app.include_router(eval_runs_router)
