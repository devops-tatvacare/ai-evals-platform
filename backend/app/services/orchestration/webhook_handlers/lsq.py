"""LSQ inbound webhook → translate to a 'lsq.lead.updated' event.

LSQ payloads are normalized into the engine's recipient contract here so the
``source.event_trigger`` node can seed a recipient state row without each node
re-implementing provider-specific extraction. Without this normalization the
node looks for ``payload['recipients']``, which LSQ never sends, so runs
created here would complete as silent no-ops.

We extract the lead identifier from any of the common LSQ webhook shapes:
``LeadId``, ``ProspectID``, ``Lead.LeadId``, or ``Lead.ProspectID``. The
original payload is forwarded as ``event_payload`` so downstream filters can
still read raw provider fields.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestration.webhook_handlers.generic_event import (
    EventPayloadContractError,
    fire_event,
)


_LEAD_ID_KEYS = ("LeadId", "leadId", "lead_id", "ProspectID", "prospect_id")


def _extract_lead_id(payload: dict[str, Any]) -> Optional[str]:
    # Top-level keys (most common in LSQ Webhooks Manager v2).
    for k in _LEAD_ID_KEYS:
        v = payload.get(k)
        if isinstance(v, (str, int, uuid.UUID)) and str(v):
            return str(v)
    # Nested ``Lead`` envelope (older LSQ "Activity Hooks" format).
    lead = payload.get("Lead") or payload.get("lead")
    if isinstance(lead, dict):
        for k in _LEAD_ID_KEYS:
            v = lead.get(k)
            if isinstance(v, (str, int, uuid.UUID)) and str(v):
                return str(v)
    return None


def _normalize_lsq_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Translate any LSQ shape into the engine's recipient contract.

    Returns a copy of ``payload`` with a ``recipients`` array suitable for
    ``source.event_trigger``. Leaves other keys intact so workflows can read
    provider-specific fields downstream.
    """
    normalized = dict(payload)
    if "recipients" in normalized and isinstance(normalized["recipients"], list):
        return normalized
    lead_id = _extract_lead_id(payload)
    if lead_id is None:
        raise EventPayloadContractError("LSQ payload missing lead identifier")
    normalized["recipients"] = [{"recipient_id": lead_id, "payload": dict(payload)}]
    return normalized


async def handle_lsq_event(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app_id: str,
    payload: dict[str, Any],
) -> list[uuid.UUID]:
    return await fire_event(
        db,
        tenant_id=tenant_id,
        app_id=app_id,
        event_name="lsq.lead.updated",
        event_payload=_normalize_lsq_payload(payload),
    )
