"""Generic external-source sync dispatcher."""

from __future__ import annotations

import uuid


async def run_external_source_sync(
    job_id,
    params: dict,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """Dispatch a source sync job to the app-specific implementation."""
    app_id = str(params.get("app_id") or "").strip()

    if app_id == "inside-sales":
        from app.services.inside_sales_sync import run_inside_sales_source_sync

        return await run_inside_sales_source_sync(
            job_id=job_id,
            params=params,
            tenant_id=tenant_id,
            user_id=user_id,
        )

    raise ValueError(f"Unsupported sync app_id: {app_id or '<missing>'}")
