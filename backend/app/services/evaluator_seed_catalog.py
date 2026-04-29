"""Canonical seeded evaluator catalog and tenant-restore helpers."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import SYSTEM_TENANT_ID
from app.models.evaluator import Evaluator
from app.models.evaluation_dataset import EvaluationDataset
from app.models.mixins.shareable import Visibility
from app.services.seed_defaults import (
    INSIDE_SALES_EVALUATORS,
    KAIRA_BOT_EVALUATORS,
    VOICE_RX_API_EVALUATORS,
    VOICE_RX_UPLOAD_EVALUATORS,
)

VOICE_RX_APP_ID = 'voice-rx'
VOICE_RX_UPLOAD_VARIANT = 'upload'
VOICE_RX_API_VARIANT = 'api'


@dataclass(frozen=True)
class EvaluatorSeedSpec:
    app_id: str
    seed_key: str
    name: str
    prompt: str
    output_schema: list[Any]
    seed_variant: str | None = None
    visibility: Visibility = Visibility.SHARED


def _build_seed_specs(
    *,
    app_id: str,
    raw_specs: list[dict[str, Any]],
    seed_keys: tuple[str, ...],
    seed_variant: str | None = None,
) -> tuple[EvaluatorSeedSpec, ...]:
    if len(raw_specs) != len(seed_keys):
        raise ValueError(f'Seed key count mismatch for app {app_id}')

    return tuple(
        EvaluatorSeedSpec(
            app_id=app_id,
            seed_key=seed_key,
            seed_variant=seed_variant,
            name=raw_spec['name'],
            prompt=raw_spec['prompt'],
            output_schema=raw_spec['output_schema'],
            visibility=Visibility.normalize(raw_spec.get('visibility')) or Visibility.SHARED,
        )
        for seed_key, raw_spec in zip(seed_keys, raw_specs, strict=True)
    )


INSIDE_SALES_SEED_SPECS = _build_seed_specs(
    app_id='inside-sales',
    raw_specs=INSIDE_SALES_EVALUATORS,
    seed_keys=(
        'sales-call-qa',
    ),
)

KAIRA_BOT_SEED_SPECS = _build_seed_specs(
    app_id='kaira-bot',
    raw_specs=KAIRA_BOT_EVALUATORS,
    seed_keys=(
        'chat-quality-analysis',
        'health-accuracy-checker',
        'empathy-assessment',
        'risk-detection',
    ),
)

VOICE_RX_UPLOAD_SEED_SPECS = _build_seed_specs(
    app_id=VOICE_RX_APP_ID,
    raw_specs=VOICE_RX_UPLOAD_EVALUATORS,
    seed_keys=(
        'medical-entity-recall',
        'factual-integrity',
        'negation-consistency',
        'temporal-precision',
        'critical-safety-audit',
    ),
    seed_variant=VOICE_RX_UPLOAD_VARIANT,
)

VOICE_RX_API_SEED_SPECS = _build_seed_specs(
    app_id=VOICE_RX_APP_ID,
    raw_specs=VOICE_RX_API_EVALUATORS,
    seed_keys=(
        'medical-entity-recall',
        'factual-integrity',
        'negation-consistency',
        'temporal-precision',
        'critical-safety-audit',
    ),
    seed_variant=VOICE_RX_API_VARIANT,
)

APP_LEVEL_SEED_SPECS_BY_APP: dict[str, tuple[EvaluatorSeedSpec, ...]] = {
    'inside-sales': INSIDE_SALES_SEED_SPECS,
    'kaira-bot': KAIRA_BOT_SEED_SPECS,
}

VOICE_RX_SEED_SPECS_BY_VARIANT: dict[str, tuple[EvaluatorSeedSpec, ...]] = {
    VOICE_RX_UPLOAD_VARIANT: VOICE_RX_UPLOAD_SEED_SPECS,
    VOICE_RX_API_VARIANT: VOICE_RX_API_SEED_SPECS,
}


def supported_seeded_evaluator_apps() -> tuple[str, ...]:
    return tuple(sorted({*APP_LEVEL_SEED_SPECS_BY_APP.keys(), VOICE_RX_APP_ID}))


def resolve_seed_variant(app_id: str, source_type: str | None) -> str | None:
    if app_id != VOICE_RX_APP_ID:
        return None
    if source_type in VOICE_RX_SEED_SPECS_BY_VARIANT:
        return source_type
    return None


def get_seed_specs(app_id: str, *, seed_variant: str | None = None) -> tuple[EvaluatorSeedSpec, ...]:
    if app_id == VOICE_RX_APP_ID:
        if seed_variant is None:
            return ()
        return VOICE_RX_SEED_SPECS_BY_VARIANT.get(seed_variant, ())
    return APP_LEVEL_SEED_SPECS_BY_APP.get(app_id, ())


def supports_seed_restore(app_id: str, *, seed_variant: str | None = None) -> bool:
    return bool(get_seed_specs(app_id, seed_variant=seed_variant))


def is_seeded_default(evaluator: Evaluator) -> bool:
    return evaluator.seed_key is not None


def is_canonical_seeded_default(evaluator: Evaluator) -> bool:
    return (
        evaluator.seed_key is not None
        and evaluator.listing_id is None
        and evaluator.forked_from is None
        and Visibility.normalize(evaluator.visibility) == Visibility.SHARED
    )


def is_legacy_seed_clone(evaluator: Evaluator) -> bool:
    return (
        evaluator.seed_key is not None
        and evaluator.listing_id is not None
        and evaluator.forked_from is None
    )


def canonical_seed_identity(evaluator: Evaluator) -> tuple[str, str | None, str] | None:
    if evaluator.seed_key is None:
        return None
    return (evaluator.app_id, evaluator.seed_variant, evaluator.seed_key)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def _seed_signature(spec: EvaluatorSeedSpec) -> tuple[str, str, str]:
    return (spec.name, spec.prompt, _canonical_json(spec.output_schema))


def _choose_preferred_seed_candidate(
    left: Evaluator,
    right: Evaluator,
) -> Evaluator:
    def _rank(candidate: Evaluator) -> tuple[int, int, datetime, str]:
        return (
            0 if candidate.tenant_id != SYSTEM_TENANT_ID else 1,
            0 if is_canonical_seeded_default(candidate) else 1,
            candidate.created_at or datetime.now(UTC),
            str(candidate.id),
        )

    return left if _rank(left) <= _rank(right) else right


def collapse_visible_seeded_evaluators(
    evaluators: list[Evaluator],
    *,
    listing_id: uuid.UUID | None,
) -> list[Evaluator]:
    best_by_identity: dict[tuple[str, str | None, str], Evaluator] = {}
    for evaluator in evaluators:
        identity = canonical_seed_identity(evaluator)
        if identity is None:
            continue
        current = best_by_identity.get(identity)
        if current is None:
            best_by_identity[identity] = evaluator
            continue
        best_by_identity[identity] = _choose_preferred_seed_candidate(current, evaluator)

    visible: list[Evaluator] = []
    emitted_seed_ids: set[tuple[str, str | None, str]] = set()
    for evaluator in evaluators:
        identity = canonical_seed_identity(evaluator)
        if identity is None:
            visible.append(evaluator)
            continue

        best = best_by_identity.get(identity)
        if best is None:
            visible.append(evaluator)
            continue

        if is_canonical_seeded_default(evaluator):
            if evaluator.id != best.id or identity in emitted_seed_ids:
                continue
            visible.append(evaluator)
            emitted_seed_ids.add(identity)
            continue

        if is_legacy_seed_clone(evaluator):
            if listing_id is None:
                continue
            if is_canonical_seeded_default(best):
                continue
            if evaluator.id != best.id or identity in emitted_seed_ids:
                continue
            visible.append(evaluator)
            emitted_seed_ids.add(identity)
            continue

        visible.append(evaluator)

    return visible


def _spec_lookup() -> dict[tuple[str, str | None], dict[tuple[str, str, str], EvaluatorSeedSpec]]:
    by_scope: dict[tuple[str, str | None], dict[tuple[str, str, str], EvaluatorSeedSpec]] = {}
    for app_id, seed_specs in APP_LEVEL_SEED_SPECS_BY_APP.items():
        by_scope[(app_id, None)] = {_seed_signature(spec): spec for spec in seed_specs}
    for seed_variant, seed_specs in VOICE_RX_SEED_SPECS_BY_VARIANT.items():
        by_scope[(VOICE_RX_APP_ID, seed_variant)] = {
            _seed_signature(spec): spec for spec in seed_specs
        }
    return by_scope


SEED_SPEC_LOOKUP = _spec_lookup()


def match_seed_spec(
    *,
    app_id: str,
    seed_variant: str | None,
    name: str,
    prompt: str,
    output_schema: list[Any],
) -> EvaluatorSeedSpec | None:
    scope_lookup = SEED_SPEC_LOOKUP.get((app_id, seed_variant))
    if scope_lookup is None:
        return None
    return scope_lookup.get((name, prompt, _canonical_json(output_schema)))


async def backfill_evaluator_seed_metadata(session: AsyncSession) -> int:
    result = await session.execute(
        select(Evaluator, EvaluationDataset.source_type)
        .outerjoin(EvaluationDataset, EvaluationDataset.id == Evaluator.listing_id)
        .where(Evaluator.app_id.in_(supported_seeded_evaluator_apps()))
    )

    updated = 0
    for evaluator, source_type in result.all():
        inferred_variant = evaluator.seed_variant
        if inferred_variant is None:
            inferred_variant = resolve_seed_variant(evaluator.app_id, source_type)

        matched = match_seed_spec(
            app_id=evaluator.app_id,
            seed_variant=inferred_variant,
            name=evaluator.name,
            prompt=evaluator.prompt,
            output_schema=evaluator.output_schema or [],
        )
        if matched is None:
            continue

        visibility = Visibility.normalize(evaluator.visibility) or Visibility.PRIVATE
        changed = False
        if evaluator.seed_key != matched.seed_key:
            evaluator.seed_key = matched.seed_key
            changed = True
        if evaluator.seed_variant != matched.seed_variant:
            evaluator.seed_variant = matched.seed_variant
            changed = True
        if evaluator.listing_id is None and visibility != Visibility.SHARED:
            evaluator.visibility = Visibility.SHARED
            changed = True

        if changed:
            updated += 1

    if updated:
        await session.flush()

    return updated


async def dedupe_canonical_seeded_evaluators(session: AsyncSession) -> int:
    result = await session.execute(
        select(Evaluator).where(
            Evaluator.seed_key.is_not(None),
            Evaluator.listing_id.is_(None),
            Evaluator.forked_from.is_(None),
        )
    )

    grouped: dict[tuple[uuid.UUID, str, str | None, str], list[Evaluator]] = {}
    for evaluator in result.scalars().all():
        visibility = Visibility.normalize(evaluator.visibility)
        if visibility != Visibility.SHARED:
            continue
        grouped.setdefault(
            (evaluator.tenant_id, evaluator.app_id, evaluator.seed_variant, evaluator.seed_key),
            [],
        ).append(evaluator)

    removed = 0
    for evaluators in grouped.values():
        if len(evaluators) <= 1:
            continue

        keep = evaluators[0]
        for candidate in evaluators[1:]:
            keep = _choose_preferred_seed_candidate(keep, candidate)

        drop_ids = [candidate.id for candidate in evaluators if candidate.id != keep.id]
        if not drop_ids:
            continue

        await session.execute(
            update(Evaluator)
            .where(Evaluator.forked_from.in_(drop_ids))
            .values(forked_from=keep.id)
        )
        await session.execute(delete(Evaluator).where(Evaluator.id.in_(drop_ids)))
        removed += len(drop_ids)

    if removed:
        await session.flush()

    return removed


async def ensure_seeded_evaluator_unique_index(session: AsyncSession) -> None:
    await session.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluators_seed_scope
            ON evaluators (tenant_id, app_id, COALESCE(seed_variant, ''), seed_key)
            WHERE listing_id IS NULL
              AND forked_from IS NULL
              AND seed_key IS NOT NULL
              AND visibility = 'shared'
            """
        )
    )


async def reconcile_evaluator_seed_catalog(session: AsyncSession) -> tuple[int, int]:
    updated = await backfill_evaluator_seed_metadata(session)
    removed = await dedupe_canonical_seeded_evaluators(session)
    await ensure_seeded_evaluator_unique_index(session)
    return updated, removed


async def restore_seeded_evaluators_for_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    app_id: str,
    seed_variant: str | None = None,
) -> list[Evaluator]:
    seed_specs = get_seed_specs(app_id, seed_variant=seed_variant)
    if not seed_specs:
        return []

    await backfill_evaluator_seed_metadata(session)
    await dedupe_canonical_seeded_evaluators(session)

    seed_keys = [seed_spec.seed_key for seed_spec in seed_specs]
    existing_result = await session.execute(
        select(Evaluator).where(
            Evaluator.tenant_id == tenant_id,
            Evaluator.app_id == app_id,
            Evaluator.listing_id.is_(None),
            Evaluator.forked_from.is_(None),
            Evaluator.seed_key.in_(seed_keys),
            Evaluator.visibility == Visibility.SHARED,
            Evaluator.seed_variant.is_(seed_variant) if seed_variant is None else Evaluator.seed_variant == seed_variant,
        )
    )
    existing_by_key = {
        evaluator.seed_key: evaluator
        for evaluator in existing_result.scalars().all()
        if evaluator.seed_key is not None
    }

    created: list[Evaluator] = []
    for seed_spec in seed_specs:
        if seed_spec.seed_key in existing_by_key:
            continue
        evaluator = Evaluator(
            app_id=seed_spec.app_id,
            listing_id=None,
            name=seed_spec.name,
            prompt=seed_spec.prompt,
            output_schema=seed_spec.output_schema,
            model_id=None,
            visibility=seed_spec.visibility,
            tenant_id=tenant_id,
            user_id=actor_id,
            shared_by=actor_id,
            shared_at=datetime.now(UTC),
            seed_key=seed_spec.seed_key,
            seed_variant=seed_spec.seed_variant,
        )
        session.add(evaluator)
        created.append(evaluator)

    if created:
        await session.flush()

    await ensure_seeded_evaluator_unique_index(session)
    return created
