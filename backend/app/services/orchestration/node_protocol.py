"""Node handler protocol and the value types that flow between handlers and the engine.

Every node implements one async function:
    execute(input_cohort, config, ctx) -> NodeResult

The engine doesn't know what a node *does*; it knows the contract.
See design spec §4.3 — load-bearing surface.
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Optional, Protocol, runtime_checkable

from pydantic import AliasChoices, BaseModel, Field


class RecipientOutcome(BaseModel):
    """Result for one recipient at one node — flows down a declared output_id edge."""
    recipient_id: str
    payload_delta: dict[str, Any] = Field(default_factory=dict)


class NodeResult(BaseModel):
    """Return value from NodeHandler.execute keyed by output_id.

    ``by_edge_label`` remains accepted on input as a temporary compatibility
    alias while the rest of the branch converges on the Phase 11 contract.
    """
    by_output_id: dict[str, list[RecipientOutcome]] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("by_output_id", "by_edge_label"),
    )
    suspended: bool = False
    summary: dict[str, Any] = Field(default_factory=dict)

    @property
    def by_edge_label(self) -> dict[str, list[RecipientOutcome]]:
        """Temporary read alias for callers still migrating to ``by_output_id``."""
        return self.by_output_id


class ActionDispatch(BaseModel):
    """Pending outbound side-effect — handed to ctx.dispatch_actions."""
    recipient_id: str
    channel: str
    action_type: str
    idempotency_key: str
    payload: dict[str, Any]
    parent_action_id: Optional[str] = None


class ActionResult(BaseModel):
    """Returned by ctx.dispatch_actions per recipient."""
    recipient_id: str
    action_id: str
    status: str
    response: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class CohortStreamProto(Protocol):
    """Async iterator over (recipient_id, payload). See cohort_stream.py."""
    def __aiter__(self) -> AsyncIterator[tuple[str, dict[str, Any]]]: ...


@runtime_checkable
class NodeHandler(Protocol):
    """Every node type implements this protocol.

    Handlers are stateless singletons registered via @register_node decorator.
    """

    node_type: str
    config_schema: type[BaseModel]
    output_edges: list[str]
    category: str

    async def execute(
        self,
        input_cohort: CohortStreamProto,
        config: BaseModel,
        ctx: "NodeContext",  # noqa: F821 — forward ref to node_context.NodeContext
    ) -> NodeResult:
        ...
