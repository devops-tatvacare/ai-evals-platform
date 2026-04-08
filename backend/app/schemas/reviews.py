"""Schemas for the shared evaluation review system."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel

ReviewDecision = Literal["accept", "reject", "correct"]
ReviewStatus = Literal["draft", "final"]


class ReviewEvidenceEntry(CamelModel):
    label: str
    value: str | list[str] | dict | None = None
    kind: Literal["text", "list", "json"] = "text"


class ReviewableAttribute(CamelModel):
    key: str
    label: str
    original_value: str | None = None
    allowed_values: list[str] = Field(default_factory=list)
    group: str | None = None
    source_label: str | None = None
    description: str | None = None
    evidence: str | None = None


class ReviewableItem(CamelModel):
    item_key: str
    item_type: str
    title: str
    subtitle: str | None = None
    badges: list[str] = Field(default_factory=list)
    evidence: list[ReviewEvidenceEntry] = Field(default_factory=list)
    attributes: list[ReviewableAttribute] = Field(default_factory=list)


class ReviewItemUpsert(CamelModel):
    item_key: str
    item_type: str
    attribute_key: str
    decision: ReviewDecision
    original_value: str | None = None
    reviewed_value: str | None = None
    reason_code: str | None = None
    note: str | None = None


class ReviewDraftUpdate(CamelModel):
    notes: str | None = None
    items: list[ReviewItemUpsert] = Field(default_factory=list)


class ReviewItemResponse(CamelModel):
    id: uuid.UUID
    item_key: str
    item_type: str
    attribute_key: str
    decision: ReviewDecision
    original_value: str | None = None
    reviewed_value: str | None = None
    reason_code: str | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class ReviewSummaryResponse(CamelModel):
    id: uuid.UUID
    run_id: uuid.UUID
    reviewer_user_id: uuid.UUID
    reviewer_name: str | None = None
    status: ReviewStatus
    overall_decision: str | None = None
    notes: str | None = None
    review_snapshot: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class ReviewDetailResponse(ReviewSummaryResponse):
    items: list[ReviewItemResponse] = Field(default_factory=list)


class RunReviewContextResponse(CamelModel):
    run_id: uuid.UUID
    app_id: str
    adapter: str
    item_types: list[str] = Field(default_factory=list)
    latest_review_id: uuid.UUID | None = None
    draft_review_id: uuid.UUID | None = None
    items: list[ReviewableItem] = Field(default_factory=list)
    history: list[ReviewSummaryResponse] = Field(default_factory=list)
