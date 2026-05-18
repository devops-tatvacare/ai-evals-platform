"""Boot-time validator for per-app reporting config.

Phase 1 of the reporting genericization plan
(docs/plans/2026-05-18-reporting-genericize-phase-1.md). Catches three classes
of silent drop today by asserting them against ``Application.config.analytics``
alone — no producer execution, no DB-row inspection beyond reading ``Application.config``:

1. ``document_composer.py:432-436`` silently drops export.sectionIds that no
   composed section ID matches → check 4.
2. ``narrative_executor.py:201-213`` routes narrative insertion by substring
   match on section IDs → check 7 (and 6 catches the simpler subset failure).
3. ``report_generation_service.py:160-163`` raises at job time on an unknown
   ``analytics.profile`` → check 1 moves the failure to boot.

Wired into ``backend/app/main.py`` lifespan after ``validate_all_app_pack_ids``.
Pattern mirrors ``app.services.chat_engine.capability_pack.validate_all_app_pack_ids``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

# Module-level import (rather than deferred-inside-helper) so test code can
# patch.object the symbol on this module — the empty-declared-opt-out test
# at test_reporting_config_validator_unittest.py needs this hook.
from app.services.reports.analytics_profiles.registry import get_analytics_profile


# Mirrors narrative_executor.py:202-213 substring routing. Each value lists the
# acceptable substrings — a section.id must contain at least one to receive
# generated narrative output for that section type.
_NARRATIVE_INSERTION_TARGETS: dict[str, tuple[str, ...]] = {
    "narrative": ("narrative",),
    "prompt_gap_analysis": ("prompt-gap", "prompt_gaps"),
    "issues_recommendations": ("issue", "recommendation"),
    "callout": ("overview", "callout"),
}


def _validate_one_app(slug: str, raw_config: dict | None) -> list[str]:
    """Return a list of human-readable error strings; empty list means the app passes."""
    from app.schemas.app_config import AppConfig
    from app.services.reports.document_composer import known_document_variants

    errors: list[str] = []

    try:
        app_config = AppConfig.model_validate(raw_config or {})
    except Exception as exc:
        errors.append(f"App '{slug}': failed to parse App.config: {exc}")
        return errors

    analytics = app_config.analytics
    if not analytics.capabilities.single_run_report:
        return errors  # Phase 1 only validates apps with single-run reporting enabled.

    # 1. profile resolves
    profile_key = (analytics.profile or "").strip()
    if not profile_key:
        errors.append(
            f"App '{slug}' declares capabilities.singleRunReport=true but has no analytics.profile."
        )
    elif get_analytics_profile(profile_key) is None:
        errors.append(
            f"App '{slug}' declares capabilities.singleRunReport=true but profile "
            f"'{profile_key}' is not registered in analytics_profiles.registry."
        )

    single_run = analytics.single_run

    # 2. sections non-empty
    if not single_run.sections:
        errors.append(
            f"App '{slug}' declares capabilities.singleRunReport=true but "
            f"analytics.singleRun.sections is empty."
        )
        return errors  # downstream checks need sections

    # 3. unique section ids
    seen: set[str] = set()
    duplicates: list[str] = []
    for section in single_run.sections:
        if section.id in seen:
            duplicates.append(section.id)
        else:
            seen.add(section.id)
    if duplicates:
        errors.append(
            f"App '{slug}' has duplicate section ids in analytics.singleRun.sections: "
            f"{sorted(set(duplicates))}"
        )

    declared_ids = {section.id for section in single_run.sections}

    # 4. export.sectionIds ⊆ sections[].id  (closes document_composer:432-436 silent drop)
    export_missing = [sid for sid in single_run.export.section_ids if sid not in declared_ids]
    if export_missing:
        errors.append(
            f"App '{slug}' analytics.singleRun.export.sectionIds references id(s) not in "
            f"sections[]: {export_missing}"
        )

    # 5. export.documentVariant in known palette
    variant = single_run.export.document_variant
    if variant and variant not in known_document_variants():
        errors.append(
            f"App '{slug}' analytics.singleRun.export.documentVariant='{variant}' "
            f"is not in document_composer.known_document_variants(). Known: "
            f"{sorted(known_document_variants())}"
        )

    # 6. aiSummary.sectionIds ⊆ sections[].id
    ai_summary_missing = [
        sid for sid in single_run.ai_summary.section_ids if sid not in declared_ids
    ]
    if ai_summary_missing:
        errors.append(
            f"App '{slug}' analytics.singleRun.aiSummary.sectionIds references id(s) "
            f"not in sections[]: {ai_summary_missing}"
        )

    # 7. narrative-typed sections must have ids the substring router will match
    #    (mirror of narrative_executor.py:201-213 routing)
    for section in single_run.sections:
        targets = _NARRATIVE_INSERTION_TARGETS.get(section.type)
        if not targets:
            continue
        lowered = section.id.lower()
        if not any(token in lowered for token in targets):
            errors.append(
                f"App '{slug}' section id='{section.id}' (type='{section.type}') will be "
                f"silently dropped by narrative_executor — its id does not contain any of "
                f"{list(targets)}. Either rename the id to include one, or change the section type."
            )

    # G3 producer-half — "configured section ids are emittable by the producer"
    # is NOT enforceable here without either (a) hardcoding app-named section id
    # tuples per profile (violates CLAUDE.md generic-naming invariant) or
    # (b) producers being config-driven (L2/L2a structural rewrite, out of scope
    # for the genericization plan). Phase 5 fixture tests verify this at runtime
    # by running each profile against a fixture EvaluationRun and asserting the
    # composed payload contains every configured section id.

    return errors


async def validate_reporting_config(db: Any) -> None:
    """Boot-time gate — iterate active apps, validate analytics config, raise on any failure.

    Runs after ``seed_all_defaults`` so freshly seeded apps are visible. Collects all
    errors across all apps before raising once, so an operator sees the full picture
    in one boot log line.
    """
    from app.models.application import Application

    result = await db.execute(
        select(Application.slug, Application.config).where(Application.is_active.is_(True))
    )
    errors: list[str] = []
    for slug, raw_config in result.all():
        errors.extend(_validate_one_app(slug, raw_config))

    if errors:
        raise RuntimeError(
            "Reporting config validation failed:\n  - " + "\n  - ".join(errors),
        )
