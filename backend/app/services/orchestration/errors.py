"""Domain exceptions raised by the orchestration runtime."""
from __future__ import annotations

import uuid


class OrchestrationError(Exception):
    """Base for orchestration runtime errors."""


class RecipientNotInManifestError(OrchestrationError):
    """A node attempted to act on a recipient outside the run's frozen manifest."""

    def __init__(self, *, run_id: uuid.UUID, recipient_id: str) -> None:
        self.run_id = run_id
        self.recipient_id = recipient_id
        super().__init__(
            f"recipient_id={recipient_id!r} is not in the frozen manifest "
            f"for run_id={run_id}"
        )
