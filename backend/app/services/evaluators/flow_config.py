"""FlowConfig — immutable config that controls pipeline behavior for a single eval run.

Created from listing source_type + job params at eval start time.
Frozen so nothing can mutate it mid-pipeline.
"""

from dataclasses import dataclass
from typing import Literal

FlowType = Literal["upload", "api"]


@dataclass(frozen=True)
class FlowConfig:
    """Immutable config that controls pipeline behavior for a single eval run."""

    flow_type: FlowType

    # ── Step enablement ──
    skip_transcription: bool = False
    normalize_original: bool = False

    # ── Flow-derived properties ──
    @property
    def requires_segments(self) -> bool:
        """Upload flow requires time-aligned segments."""
        return self.flow_type == "upload"

    @property
    def requires_rx_fields(self) -> bool:
        """API flow compares structured rx data."""
        return self.flow_type == "api"

    @property
    def use_segments_in_prompts(self) -> bool:
        """Whether prompt variables like {{time_windows}} are available."""
        return self.flow_type == "upload"

    @property
    def normalization_input_type(self) -> Literal["segments", "text"]:
        """What shape the normalization input will be."""
        return "segments" if self.flow_type == "upload" else "text"

    @property
    def total_steps(self) -> int:
        """Number of pipeline steps for progress tracking."""
        steps = 0
        if not self.skip_transcription:
            steps += 1
        if self.normalize_original:
            steps += 1
        steps += 1  # critique always runs
        return steps

    @classmethod
    def from_params(cls, params: dict, source_type: str) -> "FlowConfig":
        """Construct from job params and listing source_type."""
        flow_type: FlowType = "api" if source_type == "api" else "upload"
        return cls(
            flow_type=flow_type,
            skip_transcription=params.get("skip_transcription", False),
            normalize_original=params.get("normalize_original", False),
        )
