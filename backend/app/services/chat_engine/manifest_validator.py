"""Cross-check manifests against live Postgres. Run at every backend/worker boot.

Refuses startup if any manifest declares a table or column that doesn't actually
exist in the public schema. This is the one place drift between the manifest
(logical truth) and Postgres (physical truth) gets caught.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine.manifest import AppManifest, load_all_manifests


class ManifestDriftError(RuntimeError):
    """Raised when a manifest contradicts live Postgres. Boot should abort."""


async def _db_columns_for(db: AsyncSession, table_name: str) -> dict[str, str]:
    result = await db.execute(
        text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :t"
        ),
        {"t": table_name},
    )
    return {row.column_name: row.data_type for row in result}


async def validate_manifest_against_postgres(
    manifest: AppManifest, db: AsyncSession
) -> None:
    drift: list[str] = []
    for table_name, table in manifest.catalog_tables.items():
        db_cols = await _db_columns_for(db, table_name)
        if not db_cols:
            drift.append(
                f"[{manifest.app_id}] table {table_name!r} does not exist in public schema"
            )
            continue
        for col_name in table.columns:
            if col_name not in db_cols:
                drift.append(
                    f"[{manifest.app_id}] {table_name}.{col_name!r} declared in manifest "
                    f"but not in information_schema.columns"
                )
    if drift:
        raise ManifestDriftError(
            f"Manifest drift detected ({len(drift)} issue(s)):\n  - "
            + "\n  - ".join(drift)
        )


async def run_manifest_validator(db: AsyncSession) -> None:
    """Validate every registered manifest. Raises ManifestDriftError on first drift."""
    manifests = load_all_manifests()
    for manifest in manifests.values():
        await validate_manifest_against_postgres(manifest, db)
