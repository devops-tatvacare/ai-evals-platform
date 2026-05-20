"""Lifespan-boot guarantee that ``analytics.ref_llm_models_catalog`` is populated.

Runs after Alembic migrations + ``seed_all_defaults``. If the catalog is empty,
fetches models.dev synchronously and applies the refresh. If the catalog is
empty AND the refresh fails (network, parse, allowlist mismatch), raises a
``RuntimeError`` so the lifespan aborts loudly — the alternative is silently
booting a backend that has no models in the catalog, which makes every
``resolve_llm_call`` fail at runtime with a less actionable error.

Replaces the hand-curated catalog seed that previously lived in Alembic 0050.
That seed was the source of capability-flag drift bugs (e.g. a row whose
``supports_structured_output=false`` made Sherlock specialist mis-resolve);
the only safe source for capability data is upstream truth at boot time.

Idempotent: if the catalog is non-empty, returns immediately. No refresh
fires on every boot — that's the cron job's responsibility.
"""
from __future__ import annotations

import hashlib
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost import RefLlmModelsCatalog


_log = logging.getLogger(__name__)


class CatalogBootstrapError(RuntimeError):
    """Catalog is empty and the models.dev refresh failed to populate it."""


async def ensure_catalog_loaded(db: AsyncSession) -> None:
    """Boot-time guarantee that the catalog has at least one row.

    No-op when the catalog already has rows. When empty, fetches models.dev,
    applies the refresh, commits. Raises ``CatalogBootstrapError`` (a
    ``RuntimeError``) if the catalog is still empty after attempting the
    refresh — surfaces to the FastAPI lifespan as a hard boot failure.
    """
    count = (
        await db.execute(
            select(func.count()).select_from(RefLlmModelsCatalog)
        )
    ).scalar_one()
    if count > 0:
        _log.info(
            "ref_llm_models_catalog already populated (count=%d); skipping boot refresh",
            count,
        )
        return

    _log.info(
        "ref_llm_models_catalog empty at boot; fetching models.dev to populate"
    )

    # Imports kept local — these reach into aiohttp + the full refresh path,
    # which would slow lifespan import in environments that never hit this
    # branch (e.g. prod that already has catalog rows from a previous boot).
    from app.services.cost_tracking.models_dev_client import (
        ModelsDevFetchError,
        fetch_models_dev_api,
    )
    from app.services.cost_tracking.models_dev_refresh import (
        ModelsDevRefreshError,
        apply_refresh,
    )

    try:
        payload = await fetch_models_dev_api()
    except ModelsDevFetchError as exc:
        raise CatalogBootstrapError(
            f"models.dev unreachable at boot and the catalog is empty: {exc}. "
            f"Either fix the network (models.dev is GitHub-Pages-hosted) or "
            f"manually populate analytics.ref_llm_models_catalog before "
            f"restarting."
        ) from exc

    payload_hash = hashlib.sha256(
        repr(sorted(payload.items(), key=lambda kv: kv[0])).encode()
    ).hexdigest()

    try:
        diff = await apply_refresh(
            db,
            payload=payload,
            payload_hash=payload_hash,
            actor_id=None,  # boot-time refresh has no acting user
        )
    except ModelsDevRefreshError as exc:
        raise CatalogBootstrapError(
            f"models.dev refresh produced an invalid payload at boot: {exc}. "
            f"Inspect upstream or pin a known-good revision."
        ) from exc

    await db.commit()

    final_count = (
        await db.execute(
            select(func.count()).select_from(RefLlmModelsCatalog)
        )
    ).scalar_one()
    if final_count == 0:
        # Defensive — apply_refresh should have inserted rows or raised. If
        # somehow zero rows landed (allowlist matched nothing in the upstream
        # payload), fail boot loudly rather than ship an empty catalog.
        raise CatalogBootstrapError(
            "models.dev refresh completed but the catalog is still empty. "
            f"Snapshot id={diff.get('snapshot_id')} returned "
            f"added={diff.get('added_count')}, "
            f"unchanged={diff.get('unchanged_count')}. Verify the provider "
            f"allowlist in cost_tracking/provider_map.py covers at least one "
            f"provider present in the upstream payload."
        )

    _log.info(
        "ref_llm_models_catalog populated from models.dev at boot: "
        "added=%s updated=%s unchanged=%s final_count=%d",
        diff.get("added_count"),
        diff.get("updated_count"),
        diff.get("unchanged_count"),
        final_count,
    )


__all__ = ["CatalogBootstrapError", "ensure_catalog_loaded"]
