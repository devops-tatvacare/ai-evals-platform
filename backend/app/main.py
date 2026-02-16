"""FastAPI application entry point."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine, get_db
from app.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup. In production, use Alembic migrations instead."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
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
app.include_router(listings_router)
app.include_router(files_router)
app.include_router(prompts_router)
app.include_router(schemas_router)
