"""Generic, app-agnostic evaluation-selection contract.

Owns the typed shape that flows from the submit boundary to the runner shell:
spec → resolver → records → worker. No app names, no per-app branches; per-app
behaviour is declared via DatasetBinding registered in the registry.
"""

from app.services.evaluators.selection.binding import DatasetBinding
from app.services.evaluators.selection.record import (
    EvaluableCall,
    ResolvedSelection,
    SelectionDiagnostics,
    SpecificSelectionMissingError,
)
from app.services.evaluators.selection.registry import (
    get_binding,
    register_binding,
)
from app.services.evaluators.selection.resolver import resolve_selection
from app.services.evaluators.selection.spec import EvaluationSelectionSpec

__all__ = [
    "DatasetBinding",
    "EvaluableCall",
    "EvaluationSelectionSpec",
    "ResolvedSelection",
    "SelectionDiagnostics",
    "SpecificSelectionMissingError",
    "get_binding",
    "register_binding",
    "resolve_selection",
]
