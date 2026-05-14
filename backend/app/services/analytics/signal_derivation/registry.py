"""Signal derivation framework — strategy plugin registry.

Phase 11A of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.

One plugin per strategy key. Registration is explicit and eager (import
this module → registry populated). The orchestrator and the manifest
projection both resolve strategies through ``get_strategy``.
"""
from __future__ import annotations

from app.models.analytics_signal_definition import SIGNAL_STRATEGIES
from app.services.analytics.signal_derivation.base import SignalStrategy
from app.services.analytics.signal_derivation.llm_profile_strategy import (
    LlmProfileStrategy,
)
from app.services.analytics.signal_derivation.llm_transcript_strategy import (
    LlmTranscriptStrategy,
)
from app.services.analytics.signal_derivation.rule_strategy import RuleStrategy

_REGISTRY: dict[str, SignalStrategy] = {}


def register_strategy(strategy: SignalStrategy) -> None:
    """Register a strategy plugin. Duplicate key = hard fail at import."""
    if strategy.key in _REGISTRY:
        raise ValueError(f"duplicate signal strategy registration: {strategy.key!r}")
    if strategy.key not in SIGNAL_STRATEGIES:
        raise ValueError(
            f"strategy key {strategy.key!r} not in SIGNAL_STRATEGIES "
            f"{SIGNAL_STRATEGIES!r}"
        )
    _REGISTRY[strategy.key] = strategy


def get_strategy(key: str) -> SignalStrategy:
    """Resolve a strategy plugin by key. ``KeyError`` if unregistered."""
    if key not in _REGISTRY:
        raise KeyError(
            f"no signal strategy registered for {key!r}; "
            f"registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[key]


def registered_strategies() -> dict[str, SignalStrategy]:
    """Return the live registry (read-only view for callers/tests)."""
    return dict(_REGISTRY)


# Eager registration — all three strategy plugins.
register_strategy(RuleStrategy())
register_strategy(LlmTranscriptStrategy())
register_strategy(LlmProfileStrategy())
