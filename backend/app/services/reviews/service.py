"""Shared review helpers used by the review routes."""
from collections import Counter
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, false, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.context import AuthContext
from app.models.app import App
from app.models.eval_run import EvalRun
from app.models.review import EvalReview, EvalReviewItem
from app.models.user import User
from app.schemas.app_config import AppConfig
from app.services.access_control import readable_scope_clause
from app.services.reviews.adapters import REVIEW_ADAPTERS


def app_access_clause(model, auth: AuthContext):
    if auth.is_owner:
        return true()
    if not auth.app_access:
        return false()
    return model.app_id.in_(tuple(sorted(auth.app_access)))


async def get_readable_run(db: AsyncSession, *, run_id, auth: AuthContext) -> EvalRun:
    run = await db.scalar(
        select(EvalRun)
        .options(selectinload(EvalRun.thread_evaluations))
        .where(
            EvalRun.id == run_id,
            readable_scope_clause(EvalRun, auth),
            app_access_clause(EvalRun, auth),
        )
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def get_reviewable_run(db: AsyncSession, *, run_id, auth: AuthContext) -> EvalRun:
    run = await get_readable_run(db, run_id=run_id, auth=auth)
    reviews_config = await get_app_reviews_config(db, run.app_id)
    if not reviews_config.enabled:
        raise HTTPException(status_code=404, detail="Reviews are not enabled for this app")
    return run


async def get_app_reviews_config(db: AsyncSession, app_id: str):
    app = await db.scalar(select(App).where(App.slug == app_id, App.is_active == True))
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    return AppConfig.model_validate(app.config or {}).reviews


def build_reviewable_items(run: EvalRun, adapter_name: str) -> list[dict]:
    adapter = REVIEW_ADAPTERS.get(adapter_name)
    if adapter is None:
        raise HTTPException(status_code=500, detail="Review adapter is not configured")
    return adapter(run)


def derive_overall_decision(items: list[EvalReviewItem]) -> str | None:
    if not items:
        return None
    decisions = {item.decision for item in items}
    if decisions == {"accept"}:
        return "accepted"
    if decisions == {"reject"}:
        return "rejected"
    if decisions <= {"accept", "correct"} and "correct" in decisions:
        return "accepted_with_changes"
    if decisions == {"correct"}:
        return "accepted_with_changes"
    return "mixed"


def build_review_snapshot(items: list[EvalReviewItem], notes: str | None) -> dict:
    decision_counts = Counter(item.decision for item in items)
    attribute_counts = Counter(item.attribute_key for item in items if item.decision == "correct")
    reason_counts = Counter(item.reason_code for item in items if item.reason_code)
    return {
        "reviewedItems": len(items),
        "accepted": decision_counts.get("accept", 0),
        "rejected": decision_counts.get("reject", 0),
        "corrected": decision_counts.get("correct", 0),
        "overrideCountsByAttribute": dict(attribute_counts),
        "reasonCounts": dict(reason_counts),
        "hasNotes": bool(notes and notes.strip()),
    }


def serialize_review_item(item: EvalReviewItem) -> dict:
    return {
        "id": item.id,
        "item_key": item.item_key,
        "item_type": item.item_type,
        "attribute_key": item.attribute_key,
        "decision": item.decision,
        "original_value": item.original_value,
        "reviewed_value": item.reviewed_value,
        "reason_code": item.reason_code,
        "note": item.note,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def serialize_review(review: EvalReview, reviewer_name: str | None = None, include_items: bool = False) -> dict:
    payload = {
        "id": review.id,
        "run_id": review.run_id,
        "reviewer_user_id": review.reviewer_user_id,
        "reviewer_name": reviewer_name,
        "status": review.status,
        "overall_decision": review.overall_decision,
        "notes": review.notes,
        "review_snapshot": review.review_snapshot or {},
        "created_at": review.created_at,
        "updated_at": review.updated_at,
        "completed_at": review.completed_at,
    }
    if include_items:
        payload["items"] = [serialize_review_item(item) for item in review.items]
    return payload


async def list_review_history(db: AsyncSession, *, run_id, auth: AuthContext) -> list[dict]:
    query = (
        select(EvalReview, User.display_name)
        .outerjoin(User, (User.id == EvalReview.reviewer_user_id) & (User.tenant_id == EvalReview.tenant_id))
        .where(
            EvalReview.run_id == run_id,
            EvalReview.tenant_id == auth.tenant_id,
            or_(
                EvalReview.status == "final",
                EvalReview.reviewer_user_id == auth.user_id,
            ),
        )
        .order_by(EvalReview.created_at.desc())
    )
    result = await db.execute(query)
    return [
        serialize_review(review, reviewer_name=reviewer_name, include_items=False)
        for review, reviewer_name in result.all()
    ]


async def get_review_for_read(db: AsyncSession, *, review_id, auth: AuthContext) -> tuple[EvalReview, EvalRun]:
    review = await db.scalar(
        select(EvalReview)
        .options(selectinload(EvalReview.items))
        .where(EvalReview.id == review_id, EvalReview.tenant_id == auth.tenant_id)
    )
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    run = await get_readable_run(db, run_id=review.run_id, auth=auth)
    if review.status != "final" and review.reviewer_user_id != auth.user_id and not auth.is_owner:
        raise HTTPException(status_code=404, detail="Review not found")
    return review, run


async def get_review_for_edit(db: AsyncSession, *, review_id, auth: AuthContext) -> tuple[EvalReview, EvalRun]:
    review = await db.scalar(
        select(EvalReview)
        .options(selectinload(EvalReview.items))
        .where(
            EvalReview.id == review_id,
            EvalReview.tenant_id == auth.tenant_id,
            EvalReview.reviewer_user_id == auth.user_id,
        )
    )
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft reviews can be edited")
    run = await get_reviewable_run(db, run_id=review.run_id, auth=auth)
    return review, run


async def get_or_create_draft_review(db: AsyncSession, *, run: EvalRun, auth: AuthContext) -> EvalReview:
    draft = await db.scalar(
        select(EvalReview)
        .options(selectinload(EvalReview.items))
        .where(
            EvalReview.run_id == run.id,
            EvalReview.tenant_id == auth.tenant_id,
            EvalReview.reviewer_user_id == auth.user_id,
            EvalReview.status == "draft",
        )
    )
    if draft:
        return draft

    draft = EvalReview(
        run_id=run.id,
        tenant_id=auth.tenant_id,
        reviewer_user_id=auth.user_id,
        status="draft",
    )
    db.add(draft)
    await db.flush()

    latest_final = await db.scalar(
        select(EvalReview)
        .options(selectinload(EvalReview.items))
        .where(
            EvalReview.run_id == run.id,
            EvalReview.tenant_id == auth.tenant_id,
            EvalReview.status == "final",
        )
        .order_by(EvalReview.created_at.desc())
        .limit(1)
    )
    if latest_final:
        draft.notes = latest_final.notes
        draft.items = [
            EvalReviewItem(
                review_id=draft.id,
                item_key=item.item_key,
                item_type=item.item_type,
                attribute_key=item.attribute_key,
                original_value=item.original_value,
                reviewed_value=item.reviewed_value,
                decision=item.decision,
                reason_code=item.reason_code,
                note=item.note,
            )
            for item in latest_final.items
        ]
    return draft


async def replace_review_items(
    db: AsyncSession,
    *,
    review: EvalReview,
    item_payloads: list,
) -> None:
    await db.execute(delete(EvalReviewItem).where(EvalReviewItem.review_id == review.id))
    review.items = [
        EvalReviewItem(
            review_id=review.id,
            item_key=item.item_key,
            item_type=item.item_type,
            attribute_key=item.attribute_key,
            original_value=item.original_value,
            reviewed_value=item.reviewed_value if item.decision == "correct" else None,
            decision=item.decision,
            reason_code=item.reason_code,
            note=item.note,
        )
        for item in item_payloads
    ]
    review.updated_at = datetime.now(timezone.utc)
