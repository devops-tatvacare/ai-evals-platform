"""logic.split — N-way split into disjoint or weighted branches.

Phase 11 contract:
  - Each branch carries a stable ``id`` (the routing key — matches edges'
    ``output_id``) and a separate ``label`` (display only). Renaming a
    branch label never changes routing.
  - ``mode='by_field'`` picks a branch using ``payload[field]`` against
    each branch's ``match`` value; ``mode='random'`` allocates by weight,
    deterministically per (run_id, recipient_id).
  - ``default_branch_id`` (a branch ``id``) catches recipients with no
    match in ``by_field`` mode.
  - ``drop_unmatched=True`` (default ``False``) lets unmatched recipients
    fall out of the workflow as 'skipped' instead of routing through the
    default branch.

Legacy field names (``label``-as-routing-key, ``default_branch`` referencing
a label) remain accepted on input via the normalization layer — this
handler reads only the canonical ``id``-based config.
"""
from __future__ import annotations

import hashlib
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node


class _Branch(BaseModel):
    """One branch on a split.

    ``id`` is the stable routing key — matches the source edge's
    ``output_id``. ``label`` is display-only and may change freely.
    ``match`` is used by ``mode='by_field'``; ``weight`` by ``mode='random'``.

    Legacy back-compat: a branch dict supplied with only ``label`` (no
    ``id``) gets ``id`` defaulted to ``label``. The normalizer produces
    canonical forms where ``id`` is always explicit; this fallback keeps
    pre-Phase-11 saved definitions and tests parsing.
    """
    id: str
    label: str
    match: Optional[str] = None
    weight: Optional[int] = None

    @model_validator(mode="before")
    @classmethod
    def _default_id_to_label(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw
        if not raw.get("id") and raw.get("label"):
            raw = {**raw, "id": raw["label"]}
        return raw


class _Config(BaseModel):
    mode: Literal["by_field", "random"]
    field: Optional[str] = None
    branches: list[_Branch] = Field(min_length=2)
    default_branch_id: Optional[str] = None
    drop_unmatched: bool = False

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_default(cls, raw: Any) -> Any:
        """Lift legacy ``default_branch`` (a label) to ``default_branch_id``.

        The normalizer also does this at persistence time; this in-memory
        coercion lets unit tests construct ``_Config`` directly with the
        legacy shape.
        """
        if not isinstance(raw, dict):
            return raw
        if "default_branch" in raw and "default_branch_id" not in raw:
            label = raw.pop("default_branch")
            for b in raw.get("branches") or []:
                if isinstance(b, dict) and (b.get("label") == label or b.get("id") == label):
                    raw["default_branch_id"] = b.get("id") or b.get("label")
                    break
            else:
                raw["default_branch_id"] = label
        return raw

    @model_validator(mode="after")
    def _check_branch_ids_unique(self) -> "_Config":
        ids = [b.id for b in self.branches]
        if len(set(ids)) != len(ids):
            raise ValueError(f"split branch ids must be unique: {ids}")
        if self.default_branch_id is not None and self.default_branch_id not in ids:
            raise ValueError(
                f"default_branch_id={self.default_branch_id!r} not present in branches {ids}"
            )
        if self.mode == "by_field" and not self.field:
            raise ValueError("'field' required when mode='by_field'")
        if self.mode == "random":
            total = sum(b.weight or 0 for b in self.branches)
            if total <= 0:
                raise ValueError("branches must have positive weight in random mode")
        return self


@register_node(workflow_type="*", node_type="logic.split")
class _Handler:
    node_type = "logic.split"
    config_schema = _Config
    output_edges: list[str] = []  # populated dynamically per config
    category = "logic"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        buckets: dict[str, list[RecipientOutcome]] = {b.id: [] for b in config.branches}
        if config.mode == "by_field":
            assert config.field, "field required when mode='by_field'"
            match_to_id = {b.match: b.id for b in config.branches if b.match is not None}
            async for rid, payload in input_cohort:
                v = payload.get(config.field)
                branch_id = match_to_id.get(v) if v is not None else None
                if branch_id is None:
                    if config.drop_unmatched:
                        continue
                    branch_id = config.default_branch_id
                if branch_id is None:
                    continue
                buckets[branch_id].append(RecipientOutcome(recipient_id=rid))
        else:  # random
            total_weight = sum(b.weight or 0 for b in config.branches)
            async for rid, _payload in input_cohort:
                # Deterministic per (run_id, recipient_id) — retries land in the same bucket.
                seed = hashlib.sha256(f"{ctx.run_id}|{rid}".encode()).digest()
                bucket = int.from_bytes(seed[:4], "big") % total_weight
                acc = 0
                for b in config.branches:
                    acc += (b.weight or 0)
                    if bucket < acc:
                        buckets[b.id].append(RecipientOutcome(recipient_id=rid))
                        break

        return NodeResult(
            by_output_id=buckets,
            summary={f"{bid}_count": len(outs) for bid, outs in buckets.items()},
        )
