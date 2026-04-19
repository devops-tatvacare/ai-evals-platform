"""Cost tracking service module.

Phase 1 surface:
- ``LLMCallMetadata`` envelope (``models``)
- ``record_llm_usage`` recorder
- Pricing lookup + cache
- Correlation-id contextvar
- Per-provider normalizers

Phase 2 additions:
- ``SherlockTurnContext`` + ``SHERLOCK_TURN_CONTEXT`` contextvar for the
  Agents SDK tracing processor.
- ``CostTrackingProcessor`` in ``tracing`` submodule.
- ``aggregate_turn_usage`` helper used by the Sherlock SSE ``done`` payload.

Phase 3+ additions (models.dev client, populate-rollup job) live alongside
this package but ship in later phases.
"""
from app.services.cost_tracking.aggregation import aggregate_turn_usage
from app.services.cost_tracking.correlation import (
    CORRELATION_ID,
    SHERLOCK_TURN_CONTEXT,
    SherlockTurnContext,
    get_correlation_id,
    get_sherlock_turn_context,
    reset_correlation_id,
    reset_sherlock_turn_context,
    set_correlation_id,
    set_sherlock_turn_context,
)
from app.services.cost_tracking.models import LLMCallMetadata
from app.services.cost_tracking.recorder import record_llm_usage

__all__ = [
    'LLMCallMetadata',
    'record_llm_usage',
    'CORRELATION_ID',
    'SHERLOCK_TURN_CONTEXT',
    'SherlockTurnContext',
    'aggregate_turn_usage',
    'get_correlation_id',
    'get_sherlock_turn_context',
    'reset_correlation_id',
    'reset_sherlock_turn_context',
    'set_correlation_id',
    'set_sherlock_turn_context',
]
