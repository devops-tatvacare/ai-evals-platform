"""Correlation-id contextvar used to stitch LLM calls together.

Phase 1 exposes the contextvar and helpers. Phase 2 wires middleware, the job
worker, and the Sherlock turn lifecycle to set/clear it. When unset, recorded
rows store NULL for ``correlation_id``.
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar, Token

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
