"""Cost tracking service module.

Phase 1 surface:
- ``LLMCallMetadata`` envelope (``models``)
- ``record_llm_usage`` recorder
- Pricing lookup + cache
- Correlation-id contextvar
- Per-provider normalizers

Phase 2+ additions (Agents SDK tracing, models.dev client, populate-rollup job)
live alongside this package but ship in later phases.
"""
from app.services.cost_tracking.models import LLMCallMetadata
from app.services.cost_tracking.recorder import record_llm_usage
from app.services.cost_tracking.correlation import (
    CORRELATION_ID,
    get_correlation_id,
    set_correlation_id,
)

__all__ = [
    'LLMCallMetadata',
    'record_llm_usage',
    'CORRELATION_ID',
    'get_correlation_id',
    'set_correlation_id',
]
