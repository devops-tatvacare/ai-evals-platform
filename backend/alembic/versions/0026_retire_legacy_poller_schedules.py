"""retire the every-minute orchestration crons (poll-bolna-executions /
resume-waiting-cohorts) — replaced by per-correlation polling jobs and
inline run-workflow enqueue from webhook handlers + logic.wait suspend.

Revision ID: 0026_retire_legacy_poller_schedules
Revises: 0025_background_jobs_available_at
Create Date: 2026-05-05

Both crons sat at ``* * * * *`` and ran zero-value queries on idle
schedules. Their replacement uses the new ``available_at`` delayed-
delivery primitive (migration 0025) so no perpetual cron is needed.

Downgrade re-creates the schedule rows so ``alembic downgrade`` lands
on a working pre-cutover state. Anyone rolling back also needs to roll
back the seeder change in the same revert — the seeder otherwise
re-deletes them on the next boot.
"""
from __future__ import annotations

from typing import Sequence, Union

import uuid

from alembic import op
from sqlalchemy import text


revision: str = "0026_retire_legacy_poller_schedules"
down_revision: Union[str, None] = "0025_background_jobs_available_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The two schedule keys are platform constants, not user input — safe
    # to inline. Using ``IN (...)`` keeps the migration readable and
    # sidesteps SQLAlchemy's ``expanding=True`` ceremony in raw text.
    op.execute(
        "DELETE FROM platform.scheduled_job_definitions "
        "WHERE schedule_key IN ("
        "  'platform:orchestration:poll-bolna-executions', "
        "  'platform:orchestration:resume-waiting-cohorts'"
        ")"
    )


def downgrade() -> None:
    """Best-effort restore. ``next_check_at`` is set to ``now() + 1 minute``
    so the scheduler picks the rows up immediately on rollback. The
    seeded ``id`` is fresh; no FK references the old ids so this is safe.
    """
    op.execute(
        text(
            """
            INSERT INTO platform.scheduled_job_definitions (
                id, tenant_id, app_id, job_type, schedule_key, name,
                description, cron, params, override, enabled,
                next_check_at, current_cycle_attempts, created_by,
                created_at, updated_at
            )
            SELECT
                :id_a,
                tenants.id,
                '',
                'poll-bolna-executions',
                'platform:orchestration:poll-bolna-executions',
                'Platform · Bolna execution poller',
                'Restored on alembic downgrade — see migration 0026.',
                '* * * * *',
                '{}'::jsonb,
                '{}'::jsonb,
                TRUE,
                NOW() + INTERVAL '1 minute',
                0,
                NULL,
                NOW(),
                NOW()
            FROM platform.tenants AS tenants
            WHERE tenants.id = '00000000-0000-0000-0000-000000000000'
            LIMIT 1
            """
        ).bindparams(id_a=str(uuid.uuid4()))
    )
    op.execute(
        text(
            """
            INSERT INTO platform.scheduled_job_definitions (
                id, tenant_id, app_id, job_type, schedule_key, name,
                description, cron, params, override, enabled,
                next_check_at, current_cycle_attempts, created_by,
                created_at, updated_at
            )
            SELECT
                :id_b,
                tenants.id,
                '',
                'resume-waiting-cohorts',
                'platform:orchestration:resume-waiting-cohorts',
                'Platform · Orchestration resume poller',
                'Restored on alembic downgrade — see migration 0026.',
                '* * * * *',
                '{}'::jsonb,
                '{}'::jsonb,
                TRUE,
                NOW() + INTERVAL '1 minute',
                0,
                NULL,
                NOW(),
                NOW()
            FROM platform.tenants AS tenants
            WHERE tenants.id = '00000000-0000-0000-0000-000000000000'
            LIMIT 1
            """
        ).bindparams(id_b=str(uuid.uuid4()))
    )
