"""Schemas for saved adversarial test cases."""

import uuid
from datetime import datetime
from typing import Literal, Optional

from app.schemas.base import CamelModel, CamelORMModel


Difficulty = Literal["EASY", "MEDIUM", "HARD", "CRACK", "MORIARTY"]
SourceKind = Literal["manual", "generated", "saved", "retry"]


class AdversarialSavedTestCaseBase(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None
    synthetic_input: str
    difficulty: Difficulty = "MEDIUM"
    goal_flow: list[str]
    active_traits: list[str] = []
    expected_challenges: list[str] = []
    is_pinned: bool = False
    persona_tactic: Optional[str] = None
    source_kind: SourceKind = "manual"
    created_from_run_id: Optional[uuid.UUID] = None
    created_from_eval_id: Optional[int] = None


class AdversarialSavedTestCaseCreate(AdversarialSavedTestCaseBase):
    pass


class AdversarialSavedTestCaseUpdate(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None
    synthetic_input: Optional[str] = None
    difficulty: Optional[Difficulty] = None
    goal_flow: Optional[list[str]] = None
    active_traits: Optional[list[str]] = None
    expected_challenges: Optional[list[str]] = None
    is_pinned: Optional[bool] = None
    persona_tactic: Optional[str] = None


class AdversarialSavedTestCaseResponse(CamelORMModel):
    id: uuid.UUID
    app_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    synthetic_input: str
    difficulty: Difficulty
    goal_flow: list[str]
    active_traits: list[str]
    expected_challenges: list[str]
    is_pinned: bool
    persona_tactic: Optional[str] = None
    source_kind: SourceKind
    created_from_run_id: Optional[uuid.UUID] = None
    created_from_eval_id: Optional[int] = None
    last_used_at: Optional[datetime] = None
    use_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None
