"""Agents SDK tracing integrations.

Public surface:
- ``CostTrackingProcessor`` — a ``TracingProcessor`` that records generation
  spans into ``analytics.fact_llm_generation``.
- ``install_cost_tracking_processor`` — idempotent registration helper.
"""
from app.services.cost_tracking.tracing.agents_tracing_processor import (
    CostTrackingProcessor,
    install_cost_tracking_processor,
)

__all__ = ['CostTrackingProcessor', 'install_cost_tracking_processor']
