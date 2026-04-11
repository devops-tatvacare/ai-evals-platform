"""Async SQLAlchemy engine and session factory.

Usage in routes:
    from app.database import get_db

    @router.get("/items")
    async def list_items(db: AsyncSession = Depends(get_db)):
        result = await db.execute(select(Item))
        return result.scalars().all()
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Separate pool for analytics queries — smaller, with statement timeout.
# Falls back to primary if ANALYTICS_DATABASE_URL is not set.
analytics_engine = create_async_engine(
    settings.ANALYTICS_DATABASE_URL or settings.DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"server_settings": {"statement_timeout": "15000"}},
)

analytics_session = async_sessionmaker(analytics_engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    """FastAPI dependency that yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_analytics_db():
    """FastAPI dependency that yields an analytics DB session (15s timeout)."""
    async with analytics_session() as session:
        try:
            yield session
        finally:
            await session.close()
