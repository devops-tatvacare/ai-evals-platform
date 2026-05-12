"""Per-turn grounding context for the data_specialist.

The workbench catalog is passed whole to the LLM; this context only
carries enrichments that aren't in the catalog: top-k verified
question→SQL examples and the app/tenant instructions block.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class VerifiedExampleRef:
    """One retrieved verified-query reference rendered into the prompt.

    Mirrors ``verified_queries.RetrievedQuery`` so the grounding layer
    stays free of a circular import.
    """
    id: str  # uuid as string for telemetry-friendliness
    question: str
    sql: str
    score: float
    source: str


@dataclass(frozen=True)
class GroundingContext:
    """Per-turn grounding payload handed to the data_specialist.

    Frozen because it is computed once per turn in ``runtime.run_turn``
    and read (not mutated) by the prompt builder + the ``submit_sql``
    telemetry.
    """

    app_id: str
    user_message: str
    verified_examples: tuple[VerifiedExampleRef, ...] = field(default_factory=tuple)
    instructions_block: str = ''

    def telemetry_dict(self) -> dict[str, Any]:
        """Serializable view of the grounding decision for log lines."""
        return {
            'verified_example_ids': [v.id for v in self.verified_examples],
            'instructions_present': bool(self.instructions_block),
            'instructions_chars': len(self.instructions_block),
        }


__all__ = ['GroundingContext', 'VerifiedExampleRef']
