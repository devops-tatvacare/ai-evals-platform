"""source.event_trigger — entry from a webhook event.

Phase 11 contract:
  - User config is empty. The successor comes from the outgoing ``default``
    edge in the graph, not from a node-config ``next_node_id`` field.
  - Reads the run's ``event_payload`` (set by webhook ingress) and seeds one
    ``WorkflowRunRecipientState`` per element in
    ``event_payload['recipients']``.
  - Webhook ingress is responsible for normalizing provider-specific
    payloads into this canonical recipient shape — LSQ pulls ``LeadId``,
    generic events expect the caller to populate ``recipients`` directly.
    Logging a loud warning on zero-recipient entry lets ops catch silent
    no-ops introduced by mis-shaped external payloads.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import select, update

from app.models.orchestration import WorkflowRun, WorkflowRunRecipientState
from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node

_log = logging.getLogger(__name__)


class _Config(BaseModel):
    """Phase 11 contract: empty in canonical form. The legacy ``next_node_id``
    field is kept as Optional so unit tests and pre-Phase-11 saved
    definitions still load — the normalizer drops it from canonical
    definitions and the executor prefers the graph-derived target.
    """
    model_config = strict_node_config_dict()

    next_node_id: Optional[str] = None


def _next_target(ctx, config: _Config) -> str:
    if ctx.outgoing_targets:
        targets = ctx.outgoing_targets.get("default") or []
        if targets:
            return targets[0]
    if config.next_node_id:
        return config.next_node_id
    return ctx.resolve_default_target()


@register_node(workflow_type="*", node_type="source.event_trigger")
class _Handler:
    node_type = "source.event_trigger"
    config_schema = _Config
    output_edges = ["default"]
    category = "source"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        next_node_id = _next_target(ctx, config)
        result = await ctx.db.execute(
            select(WorkflowRun.params).where(WorkflowRun.id == ctx.run_id)
        )
        run_params: dict[str, Any] = result.scalar() or {}
        event_payload = run_params.get("event_payload") or {}
        recipients: list[dict[str, Any]] = event_payload.get("recipients", [])

        seeded = 0
        for r in recipients:
            recipient_id = r.get("recipient_id") if isinstance(r, dict) else None
            if not recipient_id:
                _log.warning(
                    "source.event_trigger: skipping recipient with no recipient_id "
                    "(run=%s)",
                    ctx.run_id,
                )
                continue
            ctx.db.add(WorkflowRunRecipientState(
                id=uuid.uuid4(), tenant_id=ctx.tenant_id, app_id=ctx.app_id,
                workflow_id=ctx.workflow_id, workflow_version_id=ctx.workflow_version_id,
                run_id=ctx.run_id,
                recipient_id=str(recipient_id),
                current_node_id=next_node_id,
                status="ready",
                payload=r.get("payload") or {},
            ))
            seeded += 1

        if seeded == 0:
            _log.warning(
                "source.event_trigger: zero recipients seeded for run=%s "
                "(event_payload had %d entries — webhook ingress probably did not "
                "normalize provider payload into the recipient contract).",
                ctx.run_id,
                len(recipients),
            )

        await ctx.db.execute(
            update(WorkflowRun).where(WorkflowRun.id == ctx.run_id)
            .values(cohort_size_at_entry=seeded)
        )
        await ctx.db.flush()
        return NodeResult(summary={"cohort_size": seeded})
