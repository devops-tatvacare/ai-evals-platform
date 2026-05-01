"""filter.consent_gate — checks workflow_consent_records for the channel.

Phase 11 contract:
  - ``authoring_status='hidden'`` — kept executable for definitions that
    already reference it but removed from the palette until consent
    ingestion lands.
  - ``consent_policy`` is now an explicit enum instead of a permissive bool:
      - ``permissive``    — only ``opted_out`` blocks; ``unknown`` allows
                            (matches the historical default).
      - ``explicit_optin`` — only ``opted_in`` allows; everything else
                            blocks (sensitive channels).

Legacy ``{ require_explicit_optin: bool }`` configs are coerced to the new
``consent_policy`` enum so old saved definitions and seed JSON still load.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, model_validator
from sqlalchemy import select

from app.models.orchestration import WorkflowConsentRecord
from app.services.orchestration.node_protocol import NodeResult, RecipientOutcome
from app.services.orchestration.node_registry import register_node


ConsentPolicy = Literal["permissive", "explicit_optin"]


class _Config(BaseModel):
    channel: Literal["wa", "voice", "sms", "email"]
    consent_policy: ConsentPolicy = "permissive"

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy(cls, raw: Any) -> Any:
        if not isinstance(raw, dict) or "consent_policy" in raw:
            return raw
        if "require_explicit_optin" in raw:
            new_raw = dict(raw)
            new_raw["consent_policy"] = (
                "explicit_optin" if new_raw.pop("require_explicit_optin") else "permissive"
            )
            return new_raw
        return raw


@register_node(workflow_type="*", node_type="filter.consent_gate")
class _Handler:
    node_type = "filter.consent_gate"
    config_schema = _Config
    output_edges = ["allowed", "blocked"]
    category = "filter"

    async def execute(self, input_cohort, config: _Config, ctx) -> NodeResult:
        recipient_ids: list[str] = []
        async for rid, _ in input_cohort:
            recipient_ids.append(rid)
        if not recipient_ids:
            return NodeResult(by_output_id={"allowed": [], "blocked": []})

        stmt = (
            select(
                WorkflowConsentRecord.recipient_id,
                WorkflowConsentRecord.status,
            )
            .where(
                WorkflowConsentRecord.tenant_id == ctx.tenant_id,
                WorkflowConsentRecord.app_id == ctx.app_id,
                WorkflowConsentRecord.channel == config.channel,
                WorkflowConsentRecord.recipient_id.in_(recipient_ids),
            )
            .distinct(WorkflowConsentRecord.recipient_id)
            .order_by(
                WorkflowConsentRecord.recipient_id,
                WorkflowConsentRecord.created_at.desc(),
            )
        )
        result = await ctx.db.execute(stmt)
        latest: dict[str, str] = dict(result.all())

        allowed: list[RecipientOutcome] = []
        blocked: list[RecipientOutcome] = []
        for rid in recipient_ids:
            status = latest.get(rid)
            if config.consent_policy == "explicit_optin":
                if status == "opted_in":
                    allowed.append(RecipientOutcome(recipient_id=rid))
                else:
                    blocked.append(RecipientOutcome(recipient_id=rid))
            else:  # permissive
                if status == "opted_out":
                    blocked.append(RecipientOutcome(recipient_id=rid))
                else:
                    allowed.append(RecipientOutcome(recipient_id=rid))

        return NodeResult(
            by_output_id={"allowed": allowed, "blocked": blocked},
            summary={
                "allowed_count": len(allowed),
                "blocked_count": len(blocked),
                "consent_policy": config.consent_policy,
            },
        )
