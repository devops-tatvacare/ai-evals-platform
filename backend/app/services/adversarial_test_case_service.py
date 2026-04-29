"""Persistence and conversion helpers for saved adversarial test cases."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.adversarial_test_case import AdversarialSavedTestCase
from app.models.eval_run import EvaluationRunAdversarialResult
from app.schemas.adversarial_test_case import (
    AdversarialSavedTestCaseCreate,
    AdversarialSavedTestCaseUpdate,
)
from app.services.evaluators.models import AdversarialTestCase, deserialize

APP_ID = "kaira-bot"


def normalize_case_difficulty(value: str | None) -> str:
    if not value:
        return "MEDIUM"
    upper = value.upper()
    if upper in {"EASY", "MEDIUM", "HARD", "CRACK", "MORIARTY"}:
        return upper
    return "MEDIUM"


def test_case_fingerprint(test_case: AdversarialTestCase) -> str:
    payload = "|".join(
        [
            test_case.synthetic_input.strip().lower(),
            normalize_case_difficulty(test_case.difficulty),
            ",".join(sorted(test_case.goal_flow)),
            ",".join(sorted(test_case.active_traits)),
        ]
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def dedupe_test_cases(test_cases: list[AdversarialTestCase]) -> list[AdversarialTestCase]:
    seen: set[str] = set()
    deduped: list[AdversarialTestCase] = []
    for test_case in test_cases:
        fingerprint = test_case_fingerprint(test_case)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(test_case)
    return deduped


def model_to_runtime(record: AdversarialSavedTestCase) -> AdversarialTestCase:
    difficulty = normalize_case_difficulty(record.difficulty)
    runtime_case = AdversarialTestCase(
        synthetic_input=record.synthetic_input,
        expected_behavior=record.name or "",
        difficulty=difficulty,
        persona_labels=[difficulty.lower()],
        goal_flow=list(record.goal_flow or []),
        active_traits=list(record.active_traits or []),
        expected_challenges=list(record.expected_challenges or []),
    )
    # Dynamic attribute so hydrated cases retain their pinned tactic. The
    # runner reads ``persona_tactic`` off the runtime case when narrowing
    # ``selected_persona_tactics`` for this case alone.
    if getattr(record, "persona_tactic", None):
        setattr(runtime_case, "persona_tactic", record.persona_tactic)
    return runtime_case


def payload_to_runtime(payload: dict) -> AdversarialTestCase:
    difficulty = normalize_case_difficulty(payload.get("difficulty"))
    raw_persona_labels = payload.get("persona_labels") or payload.get("personaLabels") or []
    persona_labels = [str(label).strip().lower() for label in raw_persona_labels if str(label).strip()]
    if not persona_labels:
        persona_labels = [difficulty.lower()]
    return AdversarialTestCase(
        synthetic_input=payload.get("synthetic_input", ""),
        expected_behavior=payload.get("expected_behavior", ""),
        difficulty=difficulty,
        persona_labels=persona_labels,
        goal_flow=list(payload.get("goal_flow", []) or ["meal_logged"]),
        active_traits=list(payload.get("active_traits", []) or []),
        expected_challenges=list(payload.get("expected_challenges", []) or []),
    )


def runtime_to_create_payload(
    test_case: AdversarialTestCase,
    *,
    name: str | None = None,
    description: str | None = None,
    is_pinned: bool = False,
    persona_tactic: str | None = None,
    source_kind: str = "manual",
    created_from_run_id: UUID | None = None,
    created_from_eval_id: int | None = None,
) -> AdversarialSavedTestCaseCreate:
    resolved_tactic = persona_tactic or getattr(test_case, "persona_tactic", None)
    return AdversarialSavedTestCaseCreate(
        name=name,
        description=description,
        synthetic_input=test_case.synthetic_input,
        difficulty=normalize_case_difficulty(test_case.difficulty),
        goal_flow=list(test_case.goal_flow or ["meal_logged"]),
        active_traits=list(test_case.active_traits or []),
        expected_challenges=list(test_case.expected_challenges or []),
        is_pinned=is_pinned,
        persona_tactic=resolved_tactic,
        source_kind=source_kind,
        created_from_run_id=created_from_run_id,
        created_from_eval_id=created_from_eval_id,
    )


async def list_saved_test_cases(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    ids: list[UUID] | None = None,
    pinned_only: bool = False,
) -> list[AdversarialSavedTestCase]:
    query = (
        select(AdversarialSavedTestCase)
        .where(
            AdversarialSavedTestCase.tenant_id == tenant_id,
            AdversarialSavedTestCase.user_id == user_id,
            AdversarialSavedTestCase.app_id == APP_ID,
        )
        .order_by(AdversarialSavedTestCase.is_pinned.desc(), AdversarialSavedTestCase.created_at.desc())
    )
    if ids:
        query = query.where(AdversarialSavedTestCase.id.in_(ids))
    if pinned_only:
        query = query.where(AdversarialSavedTestCase.is_pinned.is_(True))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_saved_test_case(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    case_id: UUID,
) -> AdversarialSavedTestCase | None:
    result = await db.execute(
        select(AdversarialSavedTestCase).where(
            AdversarialSavedTestCase.id == case_id,
            AdversarialSavedTestCase.tenant_id == tenant_id,
            AdversarialSavedTestCase.user_id == user_id,
            AdversarialSavedTestCase.app_id == APP_ID,
        )
    )
    return result.scalar_one_or_none()


async def create_saved_test_case(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    payload: AdversarialSavedTestCaseCreate,
) -> AdversarialSavedTestCase:
    record = AdversarialSavedTestCase(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=APP_ID,
        name=payload.name,
        description=payload.description,
        synthetic_input=payload.synthetic_input,
        difficulty=normalize_case_difficulty(payload.difficulty),
        goal_flow=list(payload.goal_flow),
        active_traits=list(payload.active_traits or []),
        expected_challenges=list(payload.expected_challenges or []),
        is_pinned=payload.is_pinned,
        persona_tactic=payload.persona_tactic,
        source_kind=payload.source_kind,
        created_from_run_id=payload.created_from_run_id,
        created_from_eval_id=payload.created_from_eval_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def update_saved_test_case(
    db: AsyncSession,
    *,
    record: AdversarialSavedTestCase,
    payload: AdversarialSavedTestCaseUpdate,
) -> AdversarialSavedTestCase:
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "difficulty" and value is not None:
            value = normalize_case_difficulty(value)
        setattr(record, key, value)
    await db.commit()
    await db.refresh(record)
    return record


async def mark_cases_used(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID,
    case_ids: list[UUID],
) -> None:
    if not case_ids:
        return
    records = await list_saved_test_cases(
        db, tenant_id=tenant_id, user_id=user_id, ids=case_ids
    )
    now = datetime.now(timezone.utc)
    for record in records:
        record.use_count = (record.use_count or 0) + 1
        record.last_used_at = now
    await db.commit()


async def load_retry_test_cases(
    db: AsyncSession,
    *,
    run_id: UUID,
    eval_ids: list[int] | None = None,
) -> list[AdversarialTestCase]:
    query = select(EvaluationRunAdversarialResult).where(EvaluationRunAdversarialResult.run_id == run_id)
    if eval_ids:
        query = query.where(EvaluationRunAdversarialResult.id.in_(eval_ids))
    result = await db.execute(query)
    rows = result.scalars().all()

    retry_cases: list[AdversarialTestCase] = []
    for row in rows:
        data = row.result or {}
        raw_test_case = data.get("test_case") if isinstance(data, dict) else None
        if not raw_test_case:
            continue
        try:
            parsed = deserialize(raw_test_case)
        except Exception:
            parsed = None
        if isinstance(parsed, AdversarialTestCase):
            retry_cases.append(parsed)
            continue
        if isinstance(raw_test_case, dict):
            retry_cases.append(payload_to_runtime(raw_test_case))
    return retry_cases
