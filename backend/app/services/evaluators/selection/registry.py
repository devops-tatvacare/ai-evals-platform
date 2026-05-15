"""Binding registry — string key → DatasetBinding instance.

App.config.evaluation.datasets.<dataset_id>.binding holds the string key.
The runner shell looks up the binding via `get_binding(key)`. Registering a
new binding is the only step needed to add a new evaluable dataset.
"""

from __future__ import annotations

from app.services.evaluators.selection.binding import (
    FACT_LEAD_ACTIVITY_CALL_BINDING,
    DatasetBinding,
)

_REGISTRY: dict[str, DatasetBinding] = {
    FACT_LEAD_ACTIVITY_CALL_BINDING.key: FACT_LEAD_ACTIVITY_CALL_BINDING,
}


class UnknownDatasetBindingError(KeyError):
    """Raised when App.config references a binding key that isn't registered."""


def register_binding(binding: DatasetBinding) -> None:
    if binding.key in _REGISTRY and _REGISTRY[binding.key] is not binding:
        raise ValueError(
            f"Binding key '{binding.key}' already registered to a different "
            f"DatasetBinding instance"
        )
    _REGISTRY[binding.key] = binding


def get_binding(key: str) -> DatasetBinding:
    try:
        return _REGISTRY[key]
    except KeyError as e:
        raise UnknownDatasetBindingError(
            f"No DatasetBinding registered for key '{key}'. "
            f"Known keys: {sorted(_REGISTRY)}"
        ) from e


__all__ = ["UnknownDatasetBindingError", "get_binding", "register_binding"]
