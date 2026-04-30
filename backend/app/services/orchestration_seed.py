"""Seed loader for orchestration.* — system action templates + seed workflows.

Phase 0 ships the empty scaffolding. Phase 8 (concierge cutover) populates:
  - System default action templates for WATI, Bolna, LSQ
  - The 'Default MQL Concierge' seeded crm workflow

Loader runs idempotently from app startup (lifespan hook) — every row uses
ON CONFLICT DO NOTHING keyed on natural keys.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession


_log = logging.getLogger(__name__)


async def seed_orchestration_defaults(db: AsyncSession) -> None:
    """Insert system-default action templates and seed workflows.

    Idempotent. Safe to call on every boot. Phase 8 populates this.
    """
    _log.info("orchestration seed loader: no defaults to insert in Phase 0")
    return
