"""Typed record / result shapes the selection contract emits."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class EvaluableCall(BaseModel):
    """One call subject ready to be transcribed and evaluated.

    Snake_case throughout. Constructed by a DatasetBinding from a SQLAlchemy
    row. The evaluator worker reads from named attributes; no `.get(...)`,
    no string lookups against a loose dict.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    activity_id: str
    lead_id: str
    rep_label: str | None = None
    rep_external_id: str | None = None
    rep_email: str | None = None
    occurred_at: datetime | None = None
    direction: str | None = None
    status: str | None = None
    duration_seconds: int = 0
    recording_url: str | None = None
    event_code: int | None = None
    phone_number: str | None = None
    display_number: str | None = None
    notes: str | None = None
    session_id: str | None = None
    raw_attributes: dict[str, Any] = {}


class SelectionDiagnostics(BaseModel):
    """Per-stage record counts produced during selection.

    Surfaced on the run-detail page so the user can see exactly which filter
    narrowed the universe to zero (or to N). No magic strings — every key
    matches a stage name in `resolve_selection`.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    universe_total: int = 0          # rows matching the binding's base predicate alone
    after_universe_predicates: int = 0  # rows after agents/leads/direction/status/event/recording/duration
    after_skip_evaluated: int = 0    # rows after skip_evaluated removal
    selected: int = 0                # final count actually returned (mode-aware)
    predicate_summary: dict[str, Any] = {}


class ResolvedSelection(BaseModel):
    """Final output of `resolve_selection`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    records: list[EvaluableCall]
    diagnostics: SelectionDiagnostics


class SpecificSelectionMissingError(ValueError):
    """Raised when mode='specific' resolves fewer rows than the user picked.

    Carries the missing IDs so the runner can surface a precise error on the
    run-detail page.
    """

    def __init__(self, missing_ids: Sequence[str]) -> None:
        self.missing_ids = tuple(missing_ids)
        super().__init__(
            f"Specific selection missing {len(self.missing_ids)} record(s) "
            f"from the source dataset: {sorted(self.missing_ids)}"
        )


# Re-exported for callers that want to type-check the literals
SelectionStage = Literal[
    "universe_total",
    "after_universe_predicates",
    "after_skip_evaluated",
    "selected",
]
