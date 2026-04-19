"""ContextVars used to stitch LLM calls together across async boundaries.

- ``CORRELATION_ID`` — set per API request / per job handler / per Sherlock
  turn. Recorded on every ``llm_usage`` row so one id joins the full graph.
- ``SHERLOCK_TURN_CONTEXT`` — carries the turn's tenant/user/app/turn_id into
  the global Agents SDK ``CostTrackingProcessor``. The processor is registered
  once and fires for every run; this contextvar tells it which turn the
  current run belongs to.

When either contextvar is unset, consumers must degrade gracefully: the
recorder stores ``NULL`` correlation_id, and the tracing processor silently
skips recording rather than fabricating owner attribution.
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass

CORRELATION_ID: ContextVar[uuid.UUID | None] = ContextVar('cost_correlation_id', default=None)


def get_correlation_id() -> uuid.UUID | None:
    """Return the current correlation id, or ``None`` if unset."""
    return CORRELATION_ID.get()


def set_correlation_id(value: uuid.UUID | None) -> Token[uuid.UUID | None]:
    """Set the current correlation id and return the reset token."""
    return CORRELATION_ID.set(value)


def reset_correlation_id(token: Token[uuid.UUID | None]) -> None:
    """Restore the previous correlation id."""
    CORRELATION_ID.reset(token)


@dataclass(frozen=True, slots=True)
class SherlockTurnContext:
    """Owner-attribution bag for the current Sherlock turn."""

    tenant_id: uuid.UUID
    user_id: uuid.UUID | None
    app_id: str
    turn_id: uuid.UUID
    subsystem: str = 'sherlock'


SHERLOCK_TURN_CONTEXT: ContextVar[SherlockTurnContext | None] = ContextVar(
    'cost_sherlock_turn_context', default=None
)


def get_sherlock_turn_context() -> SherlockTurnContext | None:
    return SHERLOCK_TURN_CONTEXT.get()


def set_sherlock_turn_context(
    value: SherlockTurnContext | None,
) -> Token[SherlockTurnContext | None]:
    return SHERLOCK_TURN_CONTEXT.set(value)


def reset_sherlock_turn_context(token: Token[SherlockTurnContext | None]) -> None:
    SHERLOCK_TURN_CONTEXT.reset(token)
