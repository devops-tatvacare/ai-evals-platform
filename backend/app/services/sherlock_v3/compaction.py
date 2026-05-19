"""Auto-compaction config for Sherlock v3.

Single source of truth for the context-management settings every Sherlock
agent (supervisor + specialists) hands to the OpenAI Responses API. The
Responses API compacts conversation history server-side once rendered
context crosses ``CONTEXT_COMPACT_THRESHOLD_TOKENS``; the SDK round-trips
the compaction item back in the stream where ``runtime`` picks it up and
emits a typed ``CompactionPart`` onto the Part stream.

The frontend reads ``CONTEXT_COMPACT_THRESHOLD_TOKENS`` and
``CONTEXT_PROGRESS_START_RATIO`` off the ``turn_finished`` payload —
nothing about compaction thresholds is hardcoded on the FE. Change the
constants here, both sides move in lockstep.

Implementation note: the Agents SDK v0.7.0 ``ModelSettings`` doesn't
expose ``context_management`` as a typed field. The OpenAI Python SDK
DOES — ``AsyncResponses.create()`` accepts ``context_management:
Optional[Iterable[ContextManagement]]`` natively (shape:
``{'type': str, 'compact_threshold': int}``). We bridge by using
``ModelSettings.extra_args`` which the Agents SDK spreads as typed
kwargs into the create call. That hits the proper typed-param path,
gets type-validated, and serializes the same way Azure / OpenAI both
expect (request body field ``context_management``). Setting it via
``extra_body`` would also reach the body but bypass the SDK's typed-
param handling — and Azure was silently dropping it in our 2026-05-19
live test, presumably during the SDK's request-body composition.
"""
from __future__ import annotations

from typing import Any

# Hard threshold where the Responses API begins server-side compaction.
# Production target: 120_000 (leaves ~50K headroom under gpt-5.4's
# working context so the next turn's prompt + grounding still fits
# without truncation).
# TEMP 2026-05-19: lowered to 20_000 for live UI verification of the
# compaction separator + progress pill. Revert to 120_000 after user
# sign-off.
CONTEXT_COMPACT_THRESHOLD_TOKENS: int = 20_000

# Ratio above which the chat widget starts showing a "context filling"
# pill (75% → 0.75). Below this, no FE noise; the user sees a normal
# chat. Above, the pill ticks at 10% increments until compaction fires.
CONTEXT_PROGRESS_START_RATIO: float = 0.75
CONTEXT_PROGRESS_TICK_RATIO: float = 0.10


def context_management_extra_args() -> dict[str, Any]:
    """The ``extra_args`` payload the supervisor installs on its
    ``ModelSettings`` so the Agents SDK spreads ``context_management``
    into ``AsyncResponses.create(context_management=...)`` as a typed
    kwarg. Returned as a fresh dict each call so a downstream caller
    cannot accidentally mutate the shared default."""
    return {
        'context_management': [
            {'type': 'compaction', 'compact_threshold': CONTEXT_COMPACT_THRESHOLD_TOKENS},
        ],
    }


__all__ = [
    'CONTEXT_COMPACT_THRESHOLD_TOKENS',
    'CONTEXT_PROGRESS_START_RATIO',
    'CONTEXT_PROGRESS_TICK_RATIO',
    'context_management_extra_args',
]
