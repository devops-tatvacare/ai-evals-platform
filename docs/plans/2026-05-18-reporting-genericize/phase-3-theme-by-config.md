# Reporting genericization — Phase 3 (theme palette by config)

**Status:** done
**Branch:** `feat/llm-credentials-cleanup` (stacked on Phases 1+2)
**Design doc:** `/Users/dhspl/Programs/tc-work/tatvacare-obsidian/Projects/ai-evals-platform/Designs/reporting-pipeline-genericization.md`
**Closes:** G2 only

## Why

`document_composer.py:39-88` hardcodes a per-variant `PrintThemeTokenSet` dict (`'kaira-run-v1'`, `'inside-sales-run-v1'`, etc.). The `export.documentVariant` string IS config-driven; the palette behind it is not. Renaming the variant in config without updating the composer silently falls back to `_DEFAULT_THEME`.

## What ships

### Backend EDITED (3)

- `backend/app/schemas/app_analytics_config.py` — adds `PrintThemeTokens` (Pydantic mirror of `PrintThemeTokenSet`; defined here so the schema module stays free of `services/` imports) and `theme: PrintThemeTokens | None = None` on `AnalyticsCompositionConfig`. Defaulted None — every existing seeded config validates unchanged.
- `backend/app/services/reports/document_composer.py` — `compose_document` accepts `composition_theme: PrintThemeTokens | None = None`. Resolution: `composition.theme → variant-dict fallback → presentation overrides`. The variant dict stays as fallback.
- `backend/app/services/reports/report_generation_service.py` + `voice_rx_report_service.py` — all 5 `compose_document` call sites pass `analytics_config.<scope>.theme`.

## What was reverted from this commit's first draft

**G3 producer-half deferred.** First draft added `declared_single_run_section_ids: tuple[str, ...] = ()` to `AnalyticsProfile` + populated it on all three concrete profiles with app-named string constants (`"kaira-summary"`, `"voice-rx-overview"`, etc.). That violates the **generic naming invariant** in CLAUDE.md — "net-new code MUST NOT extend the contamination" applies even when the literal already exists elsewhere. The validator check `declared ⊇ configured` is genuinely **not implementable** without one of:

1. App-named hardcoded ID tuples per profile (banned by invariant)
2. Producers config-driven (L2/L2a structural rewrite, out of scope for genericization)
3. Runtime fixture test (Phase 5 G7)

Phase 5 fixture tests are the correct mechanism — they exercise the producer against a real fixture run and assert the composed payload contains every configured section id. Boot-time static enforcement is not available without one of (1) or (2). G3 producer-half is therefore **blocked on Phase 5** for runtime detection, or on a future L2/L2a rewrite for boot-time detection.

## Theme migration follow-up — NOT a seed_defaults edit

The variant-dict fallback at `document_composer.py:39-88` stays. To migrate an app to the config-driven path:

1. **Alembic migration** (one-shot) that updates `platform.applications.config -> 'analytics' -> 'singleRun' -> 'theme'` for that app's row with the canonical six tokens.
2. Visual-regression PDF check against `eval-report-aad2c6e3.pdf`.
3. Once all three apps migrated, a separate PR removes `_THEMES_BY_VARIANT`.

**Do NOT edit `_build_default_report_config_seeds` / `APP_SEEDS` to populate `theme`.** Per the user's `feedback_seed_defaults_overuse.md` rule, row-level data changes belong in SQL migrations, not in seed_defaults edits that re-upsert on every boot. The fallback dict is correct behavior until migration; there is no reason to rush.

## Out of scope

- `APP_SEEDS` theme populate (see above — wrong tool)
- `_THEMES_BY_VARIANT` deletion (follow-up after Alembic migrations land)
- G3 producer-half (blocked on Phase 5 or L2/L2a)
- Voice-rx producer convergence (L2a, out of scope per design doc)
- Cross-run `theme` field consumption — added on the schema but not yet read by any active cross-run code path; covered when cross-run reporting reactivates

## Verification

1. `pytest backend/tests/test_reporting_config_validator_unittest.py
   backend/tests/test_reporting_data_quality_unittest.py
   backend/tests/test_report_contracts.py -q` → 30/30 green
2. `python -c "import app.main"` → cleanly
3. No behavior change for any seeded app — every `analytics.singleRun.theme` is `None`, so all 5 `compose_document` call sites take the existing `_theme_for_variant` fallback. Phase 3 ships the seam; Alembic ships the data when an app wants to migrate.
