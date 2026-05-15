"""Declarative selection spec consumed by the resolver and runner shell."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

SelectionMode = Literal["all", "sample", "specific"]
RecordingMode = Literal["any", "only", "exclude"]
Direction = Literal["inbound", "outbound"]
SkipScope = Literal["self", "tenant"]


class EvaluationSelectionSpec(BaseModel):
    """One typed contract for choosing which records an eval run will process.

    Drives both SQL universe predicates and quality gates from a single source.
    `extra='forbid'` so a fabricated key from the UI fails the submit request.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Universe predicates — empty / None means "no filter"
    agents: tuple[str, ...] = ()
    lead_ids: tuple[str, ...] = ()
    direction: Direction | None = None
    status: str | None = None
    event_codes: tuple[int, ...] = ()
    duration_min_seconds: int | None = None
    duration_max_seconds: int | None = None
    has_recording: RecordingMode = "any"

    # Mode + quantity
    mode: SelectionMode = "all"
    sample_size: int | None = None
    selected_ids: tuple[str, ...] = ()

    # Quality gates
    skip_evaluated: bool = False
    skip_evaluated_scope: SkipScope = "self"

    @model_validator(mode="after")
    def _validate_mode(self) -> "EvaluationSelectionSpec":
        if self.mode == "specific":
            if not self.selected_ids:
                raise ValueError(
                    "mode='specific' requires non-empty selected_ids"
                )
        elif self.mode == "sample":
            if self.sample_size is None or self.sample_size < 1:
                raise ValueError(
                    "mode='sample' requires sample_size >= 1"
                )
        if self.duration_min_seconds is not None and self.duration_min_seconds < 0:
            raise ValueError("duration_min_seconds must be >= 0")
        if self.duration_max_seconds is not None and self.duration_max_seconds < 0:
            raise ValueError("duration_max_seconds must be >= 0")
        if (
            self.duration_min_seconds is not None
            and self.duration_max_seconds is not None
            and self.duration_min_seconds > self.duration_max_seconds
        ):
            raise ValueError(
                "duration_min_seconds must be <= duration_max_seconds"
            )
        return self

    def predicate_summary(self) -> dict[str, object]:
        """Compact dict describing every active predicate.

        Used in run-detail diagnostics so the user sees exactly which filters
        narrowed the universe.
        """
        out: dict[str, object] = {"mode": self.mode}
        if self.agents:
            out["agents"] = list(self.agents)
        if self.lead_ids:
            out["lead_ids"] = list(self.lead_ids)
        if self.direction:
            out["direction"] = self.direction
        if self.status:
            out["status"] = self.status
        if self.event_codes:
            out["event_codes"] = list(self.event_codes)
        if self.duration_min_seconds is not None:
            out["duration_min_seconds"] = self.duration_min_seconds
        if self.duration_max_seconds is not None:
            out["duration_max_seconds"] = self.duration_max_seconds
        if self.has_recording != "any":
            out["has_recording"] = self.has_recording
        if self.mode == "sample":
            out["sample_size"] = self.sample_size
        if self.mode == "specific":
            out["selected_ids_count"] = len(self.selected_ids)
        if self.skip_evaluated:
            out["skip_evaluated"] = True
            out["skip_evaluated_scope"] = self.skip_evaluated_scope
        return out
