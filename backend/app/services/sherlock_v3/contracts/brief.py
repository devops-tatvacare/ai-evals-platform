"""Typed supervisor→specialist dispatch envelope plus per-attempt trail entries."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.sherlock_v3.contracts.bouncer import Verdict


AttemptStatus = Literal[
    'ok',
    'empty',
    'bouncer_rejected_before',
    'bouncer_rejected_after',
    'execution_error',
    'prepare_failed',
    'tool_args_invalid',
]


class Attempt(BaseModel):
    """One submit_sql attempt — populated regardless of outcome; threads into the next retry brief."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    sql: str
    verdict: Verdict
    status: AttemptStatus
    row_count: int | None = None
    error_message: str | None = None


class SpecialistScope(BaseModel):
    """Per-dispatch scope — tenant + app + user resolved upstream."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    tenant_id: str
    app_id: str
    user_id: str


class SpecialistBrief(BaseModel):
    """Typed input to a stateless specialist via ``Agent.as_tool`` — JSON-encoded by the supervisor."""

    model_config = ConfigDict(extra='forbid', frozen=True)

    question: str
    scope: SpecialistScope
    prior_attempts: list[Attempt] = Field(default_factory=list)
    retry_hint: str | None = None

    @property
    def is_retry(self) -> bool:
        return len(self.prior_attempts) > 0
