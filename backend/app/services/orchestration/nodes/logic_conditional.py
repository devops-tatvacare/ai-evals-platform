"""logic.conditional — true/false branch by predicate over recipient payload.

Phase 11 contract: predicate is the typed AST defined in
``predicate_contract`` (parsed from the persisted JSON). Persistence shape
remains a dict so existing definitions parse without migration.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, field_validator

from app.services.orchestration._config_strictness import strict_node_config_dict
from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.predicate_contract import (
    evaluate as evaluate_predicate,
    parse as parse_predicate,
)


class _Config(BaseModel):
    model_config = strict_node_config_dict()

    predicate: dict[str, Any]

    @field_validator("predicate")
    @classmethod
    def _validate_predicate(cls, value: dict[str, Any]) -> dict[str, Any]:
        parse_predicate(value)
        return value


@register_node(workflow_type="*", node_type="logic.conditional")
class _Handler:
    node_type = "logic.conditional"
    config_schema = _Config
    output_edges = ["true", "false"]
    category = "logic"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        true_outs: list[RecipientOutcome] = []
        false_outs: list[RecipientOutcome] = []
        async for rid, payload in input_cohort:
            (true_outs if evaluate_predicate(config.predicate, payload) else false_outs).append(
                RecipientOutcome(recipient_id=rid)
            )
        return NodeResult(
            by_output_id={"true": true_outs, "false": false_outs},
            summary={"true_count": len(true_outs), "false_count": len(false_outs)},
        )
