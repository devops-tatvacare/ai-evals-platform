# Reporting genericization — Phase 4 (narrative assets out of source via Alembic)

**Status:** done (2026-05-18, commit b93dc57; Alembic 0052)
**Branch:** `feat/llm-credentials-cleanup` (stacked on Phases 1-3)
**Design doc:** `/Users/dhspl/Programs/tc-work/tatvacare-obsidian/Projects/ai-evals-platform/Designs/reporting-pipeline-genericization.md`
**Closes:** G1

## Why

`asset_resolver._narrative_defaults_for_app:42-50` is a Python dict keyed on `'kaira-bot' | 'inside-sales' | 'voice-rx'`. It returns the narrative system prompt when `assets.narrativeTemplateKey` does not resolve to an `ApplicationSetting` row. This is the ONLY true app-slug literal in the reporting runtime path (per the gap-table in the design doc). Renaming or cloning an app silently downgrades to a placeholder narrative.

## Mechanism — Alembic migration, NOT `seed_defaults`

Per `feedback_seed_defaults_overuse.md` (saved memory): row-level data inserts belong in one-shot Alembic migrations, not in `seed_defaults.py` which re-upserts on every backend boot for every deploy.

### What goes in the Alembic migration

One file: `backend/alembic/versions/XXXX_seed_narrative_system_prompts.py`

```python
"""Seed three narrative system prompts as SYSTEM-shared application_settings rows."""

from alembic import op

revision = "XXXX"
down_revision = "<latest>"

# Prompt content embedded as triple-quoted strings so the migration is
# reproducible from history alone — no import dependency on services/reports/.
KAIRA_NARRATIVE_SYSTEM_PROMPT = """..."""
INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT = """..."""
VOICE_RX_NARRATIVE_SYSTEM_PROMPT = """..."""

SYSTEM_TENANT_ID = "..."  # constant value from app.services.seed_defaults
SYSTEM_USER_ID = "..."

ROWS = [
    ("kaira-bot",     "<kaira narrativeTemplateKey>",        KAIRA_NARRATIVE_SYSTEM_PROMPT),
    ("inside-sales",  "<inside-sales narrativeTemplateKey>", INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT),
    ("voice-rx",      "<voice-rx narrativeTemplateKey>",     VOICE_RX_NARRATIVE_SYSTEM_PROMPT),
]


def upgrade():
    for app_id, key, prompt in ROWS:
        op.execute(
            f"""
            INSERT INTO platform.application_settings
              (tenant_id, user_id, app_id, key, value, visibility, created_at, updated_at)
            VALUES
              ('{SYSTEM_TENANT_ID}', '{SYSTEM_USER_ID}', '{app_id}', '{key}',
               $${{"systemPrompt": {prompt!r}}}$$::jsonb,
               'SHARED', NOW(), NOW())
            ON CONFLICT (tenant_id, user_id, app_id, key) DO NOTHING
            """
        )


def downgrade():
    for app_id, key, _ in ROWS:
        op.execute(
            f"""
            DELETE FROM platform.application_settings
            WHERE tenant_id = '{SYSTEM_TENANT_ID}'
              AND user_id = '{SYSTEM_USER_ID}'
              AND app_id = '{app_id}'
              AND key = '{key}'
              AND visibility = 'SHARED'
            """
        )
```

Concerns to verify before implementation:
- **Exact constants** — `SYSTEM_TENANT_ID` / `SYSTEM_USER_ID` are UUID literals in `app.services.seed_defaults`. Inline them in the migration (don't import — migrations should be import-stable).
- **Visibility ordering** — confirm the `_resolve_setting_value` cascade actually finds `(SYSTEM_TENANT, SYSTEM_USER, SHARED)` for an arbitrary tenant's narrative-asset lookup. If the cascade requires a specific user_id pattern, adjust.
- **JSONB column shape** — confirm `application_settings.value` is JSONB and whether the existing prompt-reference rows wrap content in `{"systemPrompt": ...}` or store raw text. Mirror whatever the existing rows use.
- **Unique constraint** — confirm the `ON CONFLICT` columns match the actual unique index on the table.
- **Schema prefix** — every `text("...")` / `op.execute(...)` schema-qualifies tables per `feedback_schema_qualify_raw_sql` (post roadmap-01).

### What goes in `seed_defaults.py`

**ONLY one tiny config-shape change.** Voice-rx's `APP_SEEDS` entry currently has:
```python
"assets": {
    "glossaryKey": "voice-rx-glossary",  # only this
}
```

Phase 4 adds:
```python
"assets": {
    "glossaryKey": "voice-rx-glossary",
    "narrativeTemplateKey": "voice-rx-narrative-system-prompt",  # NEW
}
```

That's a Pydantic config field that needs to exist on every fresh DB — exactly what `seed_defaults` is for. **No `_seed_report_prompt_references` extension. No new `_seed_report_assets` function. No `ApplicationSetting` rows inserted from `seed_defaults`.**

Kaira and inside-sales already have `narrativeTemplateKey` in their config; only voice-rx is missing.

### Code changes

1. `backend/app/services/reports/asset_resolver.py` — delete `_narrative_defaults_for_app:42-50` + the call site (whichever helper falls back to it). `resolve_report_config_assets` reads exclusively from `ApplicationSetting` via the cascade.

2. `backend/app/services/reports/config_validator.py` — extend Phase 1 validator with a new check: for every app where `capabilities.singleRunReport=true` AND `narrative_config.enabled=true`, assert `_resolve_setting_value(tenant_id=SYSTEM_TENANT, user_id=SYSTEM_USER, app_id=<slug>, key=<narrativeTemplateKey>)` returns a non-empty value. This is the gate that prevents code merge if the Alembic migration didn't run. Boot fails with a clear message naming the missing app + key.

3. `backend/tests/test_report_asset_resolver_unittest.py` — drop the two tests that explicitly assert the Python-literal fallback. Replace with tests that mock `_resolve_setting_value` to return the SYSTEM-shared prompt + assert it's used.

## Files

**New:** `backend/alembic/versions/XXXX_seed_narrative_system_prompts.py`

**Edited:**
- `backend/app/services/reports/asset_resolver.py` — drop fallback dict
- `backend/app/services/seed_defaults.py` — voice-rx `narrativeTemplateKey` ONLY (no prompt rows)
- `backend/app/services/reports/config_validator.py` — extend Phase 1 validator
- `backend/tests/test_report_asset_resolver_unittest.py` — rewrite fallback-related tests
- `backend/tests/test_reporting_config_validator_unittest.py` — add tests for the new validator check

## Out of scope

- `_seed_report_prompt_references` extension (rejected per design doc Re-audit correction 6)
- Per-tenant private narrative prompts (those work via the cascade today; no migration needed)
- Migrating existing `_seed_report_prompt_references` rows to Alembic (separate cleanup PR)

## Verification

1. `alembic upgrade head` against a fresh DB → three rows in `platform.application_settings` with visibility=SHARED
2. `alembic downgrade -1` → rows deleted, repeat upgrade is idempotent
3. `pytest backend/tests/test_report_asset_resolver_unittest.py backend/tests/test_reporting_config_validator_unittest.py -v` → all green
4. Boot the backend with the migration applied → validator passes
5. Boot the backend with the migration NOT applied (revert just the migration, keep the code) → validator fails boot with clear error naming the missing keys
6. Generate one inside-sales report end-to-end → confirm narrative prompt was loaded from the SHARED row, not the Python literal (logged via `_resolve_setting_value`)
