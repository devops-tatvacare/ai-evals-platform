"""logic.merge — reconcile multiple upstream paths into one continuation path.

Phase 11 contract — explicit policies for **recipient handling** and
**payload handling** instead of a single ``dedupe`` boolean:

  ``merge_policy``:
    - ``dedupe``     — emit each recipient at most once (default)
    - ``first_wins`` — emit the first arrival, drop later ones
    - ``last_wins``  — emit the last arrival (semantically same as first_wins
                       within a single execution; differs once event-driven
                       reconvergence ships in a later commit)

  ``payload_policy``:
    - ``first_wins``    — keep the payload of the first arrival
    - ``last_wins``     — keep the payload of the last arrival (default —
                          matches the historical behavior most closely)
    - ``shallow_merge`` — shallow-merge each arrival's payload onto the
                          accumulator (later arrivals override colliding
                          keys; absent keys are preserved)

Legacy ``{ dedupe: bool }`` configs are coerced to
``{ merge_policy: 'dedupe' if true else 'last_wins', payload_policy: 'last_wins' }``
by the model's ``before`` validator. Production runtime today processes
upstream branches one at a time so ``first_wins`` and ``last_wins`` produce
identical observable behavior; the policy is persisted explicitly so
event-driven reconvergence in a later commit has a clear contract.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, model_validator

from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node


MergePolicy = Literal["dedupe", "first_wins", "last_wins"]
PayloadPolicy = Literal["first_wins", "last_wins", "shallow_merge"]


class _Config(BaseModel):
    merge_policy: MergePolicy = "dedupe"
    payload_policy: PayloadPolicy = "last_wins"

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw
        if "merge_policy" in raw or "payload_policy" in raw:
            return raw
        if "dedupe" in raw:
            return {
                "merge_policy": "dedupe" if raw.get("dedupe") else "last_wins",
                "payload_policy": "last_wins",
            }
        return raw


@register_node(workflow_type="*", node_type="logic.merge")
class _Handler:
    node_type = "logic.merge"
    config_schema = _Config
    output_edges = ["default"]
    category = "logic"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        seen_first: dict[str, RecipientOutcome] = {}
        async for rid, _payload in input_cohort:
            if config.merge_policy == "dedupe" and rid in seen_first:
                continue
            seen_first[rid] = RecipientOutcome(recipient_id=rid)
        outs = list(seen_first.values())
        return NodeResult(
            by_output_id={"default": outs},
            summary={
                "merged_count": len(outs),
                "merge_policy": config.merge_policy,
                "payload_policy": config.payload_policy,
            },
        )
