"""filter.eligibility — splits cohort into 'passed' and 'skipped' edges by predicate.

Phase 11 contract: predicate is the typed AST defined in
``predicate_contract`` (parsed from the persisted JSON). Persistence shape
remains a dict so existing definitions parse without migration.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, field_validator

from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node
from app.services.orchestration.predicate_contract import (
    evaluate as evaluate_predicate,
    parse as parse_predicate,
)


class _Config(BaseModel):
    predicate: dict[str, Any]

    @field_validator("predicate")
    @classmethod
    def _validate_predicate(cls, value: dict[str, Any]) -> dict[str, Any]:
        parse_predicate(value)
        return value


@register_node(workflow_type="*", node_type="filter.eligibility")
class _Handler:
    node_type = "filter.eligibility"
    config_schema = _Config
    output_edges = ["passed", "skipped"]
    category = "filter"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        passed: list[RecipientOutcome] = []
        skipped: list[RecipientOutcome] = []
        async for rid, payload in input_cohort:
            (passed if evaluate_predicate(config.predicate, payload) else skipped).append(
                RecipientOutcome(recipient_id=rid)
            )
        return NodeResult(
            by_output_id={"passed": passed, "skipped": skipped},
            summary={"passed_count": len(passed), "skipped_count": len(skipped)},
        )
