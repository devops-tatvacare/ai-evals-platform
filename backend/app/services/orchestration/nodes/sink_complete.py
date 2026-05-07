"""sink.complete — terminal node. Marks recipients completed."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import NodeResult
from app.services.orchestration.node_registry import register_node


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    reason: Optional[str] = None


@register_node(workflow_type="*", node_type="sink.complete")
class _Handler:
    node_type = "sink.complete"
    config_schema = _Config
    output_edges: list[str] = []
    category = "sink"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        now = datetime.now(timezone.utc)
        async for rid, _ in input_cohort:
            await ctx.set_recipient_state(
                rid, status="completed", completed_at=now,
                error=config.reason,
            )
        return NodeResult(summary={"reason": config.reason})
