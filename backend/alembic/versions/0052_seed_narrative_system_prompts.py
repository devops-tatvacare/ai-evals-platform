"""seed narrative system prompts into platform.application_settings

Revision ID: 0052
Revises: 0051
Create Date: 2026-05-18

Phase 4 of docs/plans/2026-05-18-reporting-genericize/phase-4-narrative-assets-alembic.md.

Closes G1 — removes the per-app Python-literal fallback at
``asset_resolver._narrative_defaults_for_app`` by seeding three SYSTEM-shared
``platform.application_settings`` rows (one per app with single-run narrative
enabled). The existing private → tenant-shared → SYSTEM-shared cascade in
``asset_resolver._resolve_setting_value`` then finds these rows for every
tenant without per-tenant rows of their own.

Embeds prompt content as triple-quoted strings (NOT imports) so the migration
is reproducible from migration history alone — if a prompt module moves or
its constant gets renamed, this migration keeps running.

Schema-qualifies every raw SQL statement per the Roadmap-01 invariant.

Upgrade: ``INSERT ... ON CONFLICT DO NOTHING`` — idempotent across re-runs.
Downgrade: DELETE the same three rows by their natural key.
"""
from __future__ import annotations

import logging
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0052"
down_revision: Union[str, None] = "0051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_log = logging.getLogger("alembic.runtime.migration")


# Mirror of app.constants — inlined here so the migration has no import
# dependency on app.* (migrations must remain runnable from history alone).
_SYSTEM_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
_SYSTEM_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")


# Prompt content embedded verbatim from
# ``backend/app/services/reports/prompts/{narrative,inside_sales_narrative}_prompt.py``
# as of 2026-05-18. Future updates to the SYSTEM-shared baseline ship as new
# migrations OR via the application-settings management surface (a tenant /
# user can override with PRIVATE or tenant-SHARED rows).
_KAIRA_NARRATIVE_SYSTEM_PROMPT = (
    "You are an AI evaluation analyst for a conversational health bot.\n"
    "Your task is to analyze evaluation results and produce a structured report "
    "for the engineering team.\n\n"
    "You write in a direct, professional tone. No filler. Every sentence must "
    "be actionable or informative.\n"
    "Use specific numbers from the data. Reference thread IDs when discussing "
    "examples.\n"
    "Never fabricate data — only reference metrics and threads provided in the "
    "input.\n\n"
    "Your output MUST be valid JSON matching the schema provided."
)


_INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT = """You are a sales QA analyst generating coaching insights from call evaluation data.

You will receive aggregated evaluation data for a batch of inside sales calls. Your job is to produce actionable coaching commentary.

Output MUST be valid JSON matching this schema:
{
  "executive_summary": "3-5 sentences: key findings, biggest strengths, biggest gaps",
  "dimension_insights": [
    {"dimension": "dimension_key", "insight": "what the data shows and why it matters", "priority": "P0|P1|P2"}
  ],
  "agent_coaching_notes": {
    "agent-uuid": "2-3 sentences: strengths, specific improvement areas, recommended actions"
  },
  "flag_patterns": "Cross-cutting observations about behavioral/outcome flags",
  "compliance_alerts": ["Specific compliance concerns requiring immediate attention"],
  "recommendations": [
    {"priority": "P0|P1|P2", "action": "Concrete, actionable recommendation"}
  ]
}

Guidelines:
- P0 = immediate action needed (compliance violations, severe performance gaps)
- P1 = coaching priority (systematic weakness across team or individual)
- P2 = optimization opportunity (good performance that could be great)
- Reference specific agents by name when giving coaching notes
- Connect flag patterns to dimension scores
- Be direct and specific — avoid generic advice
- Compliance alerts are P0 by definition
"""


_VOICE_RX_NARRATIVE_SYSTEM_PROMPT = (
    "You are a clinical transcription QA analyst. Summarize the evaluation "
    "accurately, using only the evidence and counts provided in the analytics "
    "payload."
)


# (app_id, narrative_template_key, prompt_text). Per the Phase 4 plan: voice-rx
# gets the same key string as kaira ("report-narrative-template") — safe
# because the unique constraint includes app_id, and APP_SEEDS adds the
# matching key on the voice-rx app config row in the same PR.
_ROWS: list[tuple[str, str, str]] = [
    ("kaira-bot", "report-narrative-template", _KAIRA_NARRATIVE_SYSTEM_PROMPT),
    (
        "inside-sales",
        "inside-sales-report-narrative-template",
        _INSIDE_SALES_NARRATIVE_SYSTEM_PROMPT,
    ),
    ("voice-rx", "report-narrative-template", _VOICE_RX_NARRATIVE_SYSTEM_PROMPT),
]


def upgrade() -> None:
    # platform.application_settings shape (verified against the live DB):
    #   id          integer DEFAULT nextval('settings_id_seq')  -- NOT uuid
    #   updated_at  timestamptz DEFAULT now()                   -- NO created_at
    #   visibility  varchar(7) — stores ENUM member NAME because the SAEnum is
    #                declared native_enum=False, so the row value is 'SHARED'
    #                (uppercase) not 'shared'. Verified via
    #                `SELECT DISTINCT visibility FROM platform.application_settings`.
    bind = op.get_bind()

    for app_id, key, prompt in _ROWS:
        bind.execute(
            sa.text(
                """
                INSERT INTO platform.application_settings
                    (tenant_id, user_id, app_id, key, value, visibility)
                VALUES
                    (:tenant_id, :user_id, :app_id, :key,
                     jsonb_build_object('systemPrompt', cast(:prompt as text)),
                     'SHARED')
                ON CONFLICT ON CONSTRAINT uq_application_setting DO NOTHING
                """
            ),
            {
                "tenant_id": _SYSTEM_TENANT_ID,
                "user_id": _SYSTEM_USER_ID,
                "app_id": app_id,
                "key": key,
                "prompt": prompt,
            },
        )
        _log.info(
            "0052: seeded narrative system prompt for app=%s key=%s "
            "(idempotent — existing row preserved)",
            app_id, key,
        )


def downgrade() -> None:
    bind = op.get_bind()

    for app_id, key, _prompt in _ROWS:
        bind.execute(
            sa.text(
                """
                DELETE FROM platform.application_settings
                 WHERE tenant_id = :tenant_id
                   AND user_id = :user_id
                   AND app_id = :app_id
                   AND key = :key
                   AND visibility = 'SHARED'
                """
            ),
            {
                "tenant_id": _SYSTEM_TENANT_ID,
                "user_id": _SYSTEM_USER_ID,
                "app_id": app_id,
                "key": key,
            },
        )
