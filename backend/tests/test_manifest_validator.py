"""Tests for manifest_validator — drift detection against live Postgres."""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.services.chat_engine.manifest import (
    AppManifest,
    CatalogTable,
    ManifestColumn,
    _clear_manifest_cache_for_tests,
    get_manifest,
)
from app.services.chat_engine.manifest_validator import (
    ManifestDriftError,
    run_manifest_validator,
    validate_manifest_against_postgres,
)


@pytest.fixture
def engine_url() -> str:
    """Resolve a DB URL that works both inside docker (evals-postgres:5432) and
    from the host (localhost:5433 — the port mapped by docker-compose).
    """
    import os
    override = os.environ.get("TEST_DATABASE_URL")
    if override:
        return override
    url = settings.DATABASE_URL
    if "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://")
    # When running from the host, settings default points to localhost:5432 which
    # isn't exposed; the host-side mapping is 5433.
    url = url.replace("@localhost:5432/", "@localhost:5433/")
    url = url.replace("@evals-postgres:5432/", "@localhost:5433/")
    return url


@pytest.fixture
async def db(engine_url: str):
    engine = create_async_engine(engine_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_validator_rejects_missing_column(db):
    bogus = AppManifest(
        app_id="drift-test",
        catalog_tables={
            "agg_evaluation_run": CatalogTable(
                orm="AggEvaluationRun",
                pg_schema="analytics",
                columns={
                    "does_not_exist_column": ManifestColumn(role="measure"),
                },
            ),
        },
        data_surfaces=[],
    )
    with pytest.raises(ManifestDriftError, match="does_not_exist_column"):
        await validate_manifest_against_postgres(bogus, db)


@pytest.mark.asyncio
async def test_validator_rejects_missing_table(db):
    bogus = AppManifest(
        app_id="drift-test",
        catalog_tables={
            "table_that_never_existed": CatalogTable(
                orm="NonExistent",
                columns={"id": ManifestColumn(role="key")},
            ),
        },
        data_surfaces=[],
    )
    with pytest.raises(ManifestDriftError, match="table_that_never_existed"):
        await validate_manifest_against_postgres(bogus, db)


@pytest.mark.asyncio
async def test_validator_passes_real_manifest(db):
    _clear_manifest_cache_for_tests()
    manifest = get_manifest("kaira-bot")
    await validate_manifest_against_postgres(manifest, db)  # must not raise


@pytest.mark.asyncio
async def test_run_manifest_validator_all_apps(db):
    _clear_manifest_cache_for_tests()
    await run_manifest_validator(db)  # must not raise for any registered manifest
