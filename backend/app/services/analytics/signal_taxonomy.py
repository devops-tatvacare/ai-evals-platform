"""Inside-sales signal taxonomy (controlled vocabulary, v1).

Source of truth for the ``analytics.fact_lead_signal.signal_type`` enum
(per Roadmap 01 §7). The populator validates incoming ``signal_type``
values against ``SIGNAL_TYPES``; unknowns are coerced to
``other_notable_signal`` with the original label preserved in
``attributes.signal_type_raw`` so the vocabulary can grow over time
without losing fidelity.

The vocabulary is intentionally a flat ``frozenset`` rather than an
``Enum`` so new signal types added to the LLM extractor can land without
a code change to the populator — only the LLM prompt + schema and this
constant set need to update in lockstep.
"""
from __future__ import annotations

from typing import Any

# Commitments & next steps
_COMMITMENTS: frozenset[str] = frozenset(
    {
        "followup_call_commitment",
        "info_send_commitment",
        "payment_link_commitment",
        "onboarding_link_commitment",
        "home_visit_commitment",
        "video_consult_commitment",
        "callback_request",
    }
)

# Intent & stage progression
_INTENT_STAGE: frozenset[str] = frozenset(
    {
        "purchase_intent",
        "enrollment_intent",
        "decision_maker_status",
        "decision_timeline",
        "budget_signal",
    }
)

# Objections (a single discriminator with a controlled value vocabulary
# carried in ``signal_value`` — the value enum lives in the LLM prompt
# and is documented in §7 of the roadmap; the populator does not enforce
# ``signal_value`` cardinality, only ``signal_type``).
_OBJECTIONS: frozenset[str] = frozenset({"objection"})

# Qualification & correction
_QUALIFICATION: frozenset[str] = frozenset(
    {
        "condition_confirmed",
        "condition_denied",
        "current_treatment_status",
        "preferred_language",
        "preferred_contact_window",
        "alternate_contact",
        "wrong_number",
        "do_not_call_request",
    }
)

# Outcome & relationship
_OUTCOME_RELATIONSHIP: frozenset[str] = frozenset(
    {
        "outcome",
        "sentiment",
        "rapport_level",
        "escalation_needed",
    }
)

# Freeform capture — coerce target.
OTHER_SIGNAL_TYPE = "other_notable_signal"

SIGNAL_TYPES: frozenset[str] = (
    _COMMITMENTS
    | _INTENT_STAGE
    | _OBJECTIONS
    | _QUALIFICATION
    | _OUTCOME_RELATIONSHIP
    | frozenset({OTHER_SIGNAL_TYPE})
)


def coerce_signal_type(
    raw_signal_type: str | None,
    *,
    attributes: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Validate ``raw_signal_type`` against the controlled vocabulary.

    Returns ``(canonical_signal_type, attributes)`` where:
      - if ``raw_signal_type`` is in ``SIGNAL_TYPES``, it is returned
        verbatim and ``attributes`` is returned unchanged.
      - otherwise, ``OTHER_SIGNAL_TYPE`` is returned and the raw label is
        preserved in ``attributes['signal_type_raw']`` so downstream
        analysis can drive vocabulary expansion.

    ``attributes`` is copied (never mutated). A None / empty value
    becomes a new dict.
    """
    new_attributes: dict[str, Any] = dict(attributes) if attributes else {}
    label = (raw_signal_type or "").strip()
    if label and label in SIGNAL_TYPES:
        return label, new_attributes
    if label:
        new_attributes["signal_type_raw"] = label
    return OTHER_SIGNAL_TYPE, new_attributes


__all__ = [
    "SIGNAL_TYPES",
    "OTHER_SIGNAL_TYPE",
    "coerce_signal_type",
]
