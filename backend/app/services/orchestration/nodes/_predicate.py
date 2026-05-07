"""Backward-compatible predicate-evaluation entry point.

Delegates to the typed ``predicate_contract`` module so legacy node code
that imports ``evaluate_predicate`` keeps working unchanged. New code should
import from ``app.services.orchestration.predicate_contract`` directly.
"""
from __future__ import annotations

from typing import Any

from app.services.orchestration.predicate_contract import (
    PredicateError,  # re-exported for legacy imports
    evaluate as _evaluate,
)


def evaluate_predicate(predicate: Any, payload: dict[str, Any]) -> bool:
    return _evaluate(predicate, payload)


__all__ = ["evaluate_predicate", "PredicateError"]
