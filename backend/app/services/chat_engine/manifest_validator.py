"""Cross-check manifests against live Postgres. Run at every backend/worker boot.

Refuses startup if any manifest declares a table or column that doesn't actually
exist in the public schema. This is the one place drift between the manifest
(logical truth) and Postgres (physical truth) gets caught.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine.manifest import AppManifest, load_all_manifests

logger = logging.getLogger(__name__)


class ManifestDriftError(RuntimeError):
    """Raised when a manifest contradicts live Postgres. Boot should abort."""


def validate_manifest_taxonomy(manifest: AppManifest, strict: bool = False) -> list[str]:
    """Return warnings for chart-contract taxonomy drift.

    - measure columns without ``semantic_type`` → warning.
    - role/``data_type`` contradictions (measure must be quantitative, temporal
      must be temporal) → error, raised in strict mode, appended in loose mode.
    """
    warnings: list[str] = []
    errors: list[str] = []
    for table_name, table in manifest.catalog_tables.items():
        for col_name, col in table.columns.items():
            qualified = f"{manifest.app_id}:{table_name}.{col_name}"
            if col.role == "measure" and col.semantic_type is None:
                warnings.append(f"{qualified}: measure missing semantic_type")
            if col.role == "measure" and col.data_type not in (None, "quantitative"):
                errors.append(
                    f"{qualified}: role=measure requires data_type=quantitative, "
                    f"got {col.data_type!r}"
                )
            if col.role == "temporal" and col.data_type not in (None, "temporal"):
                errors.append(
                    f"{qualified}: role=temporal requires data_type=temporal, "
                    f"got {col.data_type!r}"
                )
    if strict and errors:
        raise ValueError("; ".join(errors))
    return warnings + errors


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
    """Validate every registered manifest.

    Raises ``ManifestDriftError`` on physical drift (boot-blocking) and
    ``ValueError`` on strict taxonomy violations. Loose taxonomy issues
    (missing ``semantic_type`` on measures) are logged as warnings.
    """
    manifests = load_all_manifests()
    for manifest in manifests.values():
        await validate_manifest_against_postgres(manifest, db)
        # strict=True raises on role/data_type contradictions; warnings
        # (e.g. missing semantic_type) are collected and logged non-fatally.
        taxonomy_issues = validate_manifest_taxonomy(manifest, strict=True)
        if taxonomy_issues:
            logger.warning(
                "Manifest %s: %d taxonomy warning(s): %s",
                manifest.app_id,
                len(taxonomy_issues),
                "; ".join(taxonomy_issues),
            )
        else:
            logger.info("Manifest %s: taxonomy validation OK", manifest.app_id)
