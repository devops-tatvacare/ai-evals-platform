"""Shared review endpoints for eval runs."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import AuthContext
from app.auth.permissions import require_permission
from app.database import get_db
from app.models.review import EvalReview
from app.models.user import User
from app.schemas.reviews import ReviewDetailResponse, ReviewDraftUpdate, RunReviewContextResponse
from app.services.reviews.service import (
    build_review_snapshot,
    build_reviewable_items,
    derive_overall_decision,
    get_app_reviews_config,
    get_or_create_draft_review,
    get_review_for_edit,
    get_review_for_read,
    get_reviewable_run,
    list_review_history,
    replace_review_items,
    serialize_review,
)

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


@router.get("/runs/{run_id}", response_model=RunReviewContextResponse)
async def get_run_review_context(
    run_id: UUID,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    run = await get_reviewable_run(db, run_id=run_id, auth=auth)
    reviews_config = await get_app_reviews_config(db, run.app_id)
    history = await list_review_history(db, run_id=run.id, auth=auth)
    draft_review_id = next(
        (entry["id"] for entry in history if entry["status"] == "draft" and entry["reviewer_user_id"] == auth.user_id),
        None,
    )
    return {
        "run_id": run.id,
        "app_id": run.app_id,
        "adapter": reviews_config.adapter,
        "item_types": reviews_config.item_types,
        "latest_review_id": run.latest_review_id,
        "draft_review_id": draft_review_id,
        "items": build_reviewable_items(run, reviews_config.adapter),
        "history": history,
    }


@router.post("/runs/{run_id}/draft", response_model=ReviewDetailResponse)
async def create_or_get_review_draft(
    run_id: UUID,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    run = await get_reviewable_run(db, run_id=run_id, auth=auth)
    draft = await get_or_create_draft_review(db, run=run, auth=auth)
    await db.commit()
    await db.refresh(draft)
    await db.refresh(draft, attribute_names=["items"])
    reviewer_name = await db.scalar(
        select(User.display_name).where(User.id == draft.reviewer_user_id, User.tenant_id == draft.tenant_id)
    )
    return serialize_review(draft, reviewer_name=reviewer_name, include_items=True)


@router.get("/{review_id}", response_model=ReviewDetailResponse)
async def get_review_detail(
    review_id: UUID,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    review, _run = await get_review_for_read(db, review_id=review_id, auth=auth)
    reviewer_name = await db.scalar(
        select(User.display_name).where(User.id == review.reviewer_user_id, User.tenant_id == review.tenant_id)
    )
    return serialize_review(review, reviewer_name=reviewer_name, include_items=True)


@router.put("/{review_id}", response_model=ReviewDetailResponse)
async def save_review_draft(
    review_id: UUID,
    payload: ReviewDraftUpdate,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    review, _run = await get_review_for_edit(db, review_id=review_id, auth=auth)
    review.notes = payload.notes
    await replace_review_items(db, review=review, item_payloads=payload.items)
    review.overall_decision = derive_overall_decision(review.items)
    review.review_snapshot = build_review_snapshot(review.items, review.notes)
    await db.commit()
    await db.refresh(review)
    await db.refresh(review, attribute_names=["items"])
    reviewer_name = await db.scalar(
        select(User.display_name).where(User.id == review.reviewer_user_id, User.tenant_id == review.tenant_id)
    )
    return serialize_review(review, reviewer_name=reviewer_name, include_items=True)


@router.post("/{review_id}/finalize", response_model=ReviewDetailResponse)
async def finalize_review(
    review_id: UUID,
    payload: ReviewDraftUpdate,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    review, run = await get_review_for_edit(db, review_id=review_id, auth=auth)
    review.notes = payload.notes
    await replace_review_items(db, review=review, item_payloads=payload.items)
    review.status = "final"
    review.completed_at = datetime.now(timezone.utc)
    review.overall_decision = derive_overall_decision(review.items)
    review.review_snapshot = build_review_snapshot(review.items, review.notes)
    run.latest_review_id = review.id
    await db.commit()
    await db.refresh(review)
    await db.refresh(review, attribute_names=["items"])
    reviewer_name = await db.scalar(
        select(User.display_name).where(User.id == review.reviewer_user_id, User.tenant_id == review.tenant_id)
    )
    return serialize_review(review, reviewer_name=reviewer_name, include_items=True)


@router.delete("/{review_id}")
async def discard_review_draft(
    review_id: UUID,
    auth: AuthContext = require_permission("review:manage"),
    db: AsyncSession = Depends(get_db),
):
    review, _run = await get_review_for_edit(db, review_id=review_id, auth=auth)
    await db.execute(delete(EvalReview).where(EvalReview.id == review.id))
    await db.commit()
    return {"deleted": True, "reviewId": review_id}
