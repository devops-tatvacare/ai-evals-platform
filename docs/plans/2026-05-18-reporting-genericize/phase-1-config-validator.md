# Reporting genericization — Phase 1 (boot-time config validator)

**Status:** done (2026-05-18, commit 75f7385; Phase-4 cascade check added 2026-05-18, commit b93dc57)
**Branch:** `feat/llm-credentials-cleanup` (deviation from `feat/reporting-genericize-phase-1-*`; stacked on in-flight LLM-credentials work per user request 2026-05-18)
**Design doc:** `/Users/dhspl/Programs/tc-work/tatvacare-obsidian/Projects/ai-evals-platform/Designs/reporting-pipeline-genericization.md`
**Closes:** G4 + structural half of G3

## Goal

Make `Application.config.analytics` invariants fail **at boot**, not at the first generate-report click. Three classes of silent drop today:

1. **`document_composer.py:432-436`** — `export.section_ids` referencing a section ID that no producer emits → that page silently drops from the PDF.
2. **`narrative_executor.py:201-213`** — narrative insertion routes by substring match on section IDs (`'narrative'`, `'prompt-gap'`, `'issue'`, `'overview'`). A valid-looking section can receive zero narrative output.
3. **`report_generation_service.py:160-163`** — unknown `analytics.profile` raises `ValueError` at job time, after queueing.

Phase 1 catches all three from `app.config.analytics` alone, without executing any producer (producers are DB-shape-dependent; synthesizing fake runs at boot is out of scope — see Phase 3).

## Scope (single-run only; cross-run deferred)

For each `Application` where `analytics.capabilities.singleRunReport=true`, validate:

| # | Check | Closes |
|---|---|---|
| 1 | `analytics.profile` non-empty AND resolves in `analytics_profiles.registry` | G4 |
| 2 | `single_run.sections` non-empty | structural |
| 3 | `single_run.sections[].id` unique within the app | structural |
| 4 | `single_run.export.sectionIds ⊆ sections[].id` | G3 (export half) |
| 5 | `single_run.export.documentVariant` resolves in `document_composer.known_document_variants()` | G3 (palette) |
| 6 | `single_run.aiSummary.sectionIds ⊆ sections[].id` | G3 (narrative half) |
| 7 | Each section whose `type` ∈ {`narrative`, `prompt_gap_analysis`, `issues_recommendations`, `callout`} has an `id` containing the substring(s) `narrative_executor` routes by — closes the silent-drop where a typed-narrative section's ID does not match the substring router | G3 (narrative half) |

Error mode: collect per app, raise once at end with one bullet per error. Pattern mirrors `validate_all_app_pack_ids` at `backend/app/services/chat_engine/capability_pack.py:363-399`.

## Files

**New:**
- `backend/app/services/reports/config_validator.py` — public `validate_reporting_config(db)`; module-private `_NARRATIVE_INSERTION_TARGETS` mirrors `narrative_executor.py:202-213` substring rules (cross-referenced in both files)
- `backend/tests/test_reporting_config_validator_unittest.py` — positive (all three seeded apps pass) + one negative per invariant

**Edited:**
- `backend/app/main.py` — wire after `validate_all_app_pack_ids` (~`:193`)
- `backend/app/services/reports/document_composer.py` — add 2-line public `known_document_variants() -> frozenset[str]` so validator does not import the private `_THEMES_BY_VARIANT`

## Out of scope (per design doc)

- Producer execution at boot (Phase 3)
- `theme` field on `AnalyticsCompositionConfig` (Phase 3 G2)
- `data_quality` / `narrative_status` on payload (Phase 2)
- `_narrative_defaults_for_app` removal (Phase 4 G1)
- E2E test of `generate_single_run_report_artifact` (Phase 5 G7)
- Reading stored `report_configurations.narrative_config` rows — those are runtime-mutable user data; static checks on `app.config.analytics` cover the source of truth (`_build_narrative_config:2570` derives the persisted shape from it at seed time)

## Verification

1. `pytest backend/tests/test_reporting_config_validator_unittest.py -v`
2. Full boot: `docker compose up backend` succeeds (validator passes for the three seeded apps).
3. Negative gate: temporarily set `voice-rx` `analytics.profile = "bogus"` in `APP_SEEDS`, confirm boot fails with `App 'voice-rx' declares capabilities.singleRunReport=true but profile 'bogus' is not registered.` Revert.
