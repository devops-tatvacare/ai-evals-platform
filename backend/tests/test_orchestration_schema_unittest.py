"""Schema-existence and index assertions for orchestration.* tables.

Run after Alembic upgrade. Verifies the live catalog matches the design spec —
schema name, table count, primary keys, partial indexes, cross-schema FKs.

Tests use the live-DB `db_session` fixture from conftest.py — they assert
against the real Postgres catalog, not mocks.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text


EXPECTED_TABLES = {
    "workflows",
    "workflow_versions",
    "workflow_triggers",
    "workflow_action_templates",
    "workflow_consent_records",
    "workflow_runs",
    "workflow_run_node_steps",
    "workflow_run_recipient_states",
    "workflow_run_recipient_actions",
    "workflow_run_recipient_overrides",
    # Phase 10 commit 1
    "provider_connections",
}


@pytest.mark.asyncio
async def test_orchestration_schema_exists(db_session):
    result = await db_session.execute(
        text("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'orchestration'")
    )
    assert result.scalar() == "orchestration"


@pytest.mark.asyncio
async def test_orchestration_tables_exist(db_session):
    result = await db_session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'orchestration' ORDER BY table_name"
        )
    )
    actual = {row[0] for row in result.all()}
    assert actual == EXPECTED_TABLES, f"missing: {EXPECTED_TABLES - actual}, extra: {actual - EXPECTED_TABLES}"


@pytest.mark.asyncio
async def test_partial_unique_index_no_double_dispatch(db_session):
    """The 'no double-dispatch' invariant from concierge spec §4.1."""
    result = await db_session.execute(
        text(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname = 'orchestration' "
            "AND indexname = 'idx_orch_actions_no_double_dispatch'"
        )
    )
    indexdef = result.scalar()
    assert indexdef is not None, "missing partial unique index for double-dispatch guard"
    assert "UNIQUE" in indexdef
    assert "wa_dispatched" in indexdef
    assert "bolna_queued" in indexdef
    # Postgres canonicalizes the predicate; check for both raw and canonical forms.
    assert "'pending'" in indexdef


@pytest.mark.asyncio
async def test_partial_index_resume_poller(db_session):
    """The hot path for resume-waiting-cohorts."""
    result = await db_session.execute(
        text(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname = 'orchestration' "
            "AND indexname = 'idx_orch_states_resume'"
        )
    )
    indexdef = result.scalar()
    assert indexdef is not None, "missing partial index for resume poller"
    assert "wakeup_at" in indexdef
    assert "waiting" in indexdef and "ready" in indexdef


@pytest.mark.asyncio
async def test_cross_schema_fks_to_platform(db_session):
    """All cross-schema FKs land in platform.* per design spec §3.12."""
    result = await db_session.execute(
        text(
            """
            SELECT
              tc.table_name,
              kcu.column_name,
              ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name AS references
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'orchestration'
              AND ccu.table_schema = 'platform'
            ORDER BY tc.table_name, kcu.column_name
            """
        )
    )
    rows = result.all()
    # 6 catalog/run tables carry an explicit FK on tenant_id → platform.tenants.id.
    # The 4 run-tier per-recipient tables (node_steps, recipient_states,
    # recipient_actions, recipient_overrides) denormalize tenant_id without FK
    # per design spec §3.8 — they're scoped via the run_id ON DELETE CASCADE chain.
    tenant_fks = sorted({r[0] for r in rows if r[1] == "tenant_id" and r[2] == "platform.tenants.id"})
    expected_fk_tables = {
        "workflows",
        "workflow_versions",
        "workflow_triggers",
        "workflow_action_templates",
        "workflow_consent_records",
        "workflow_runs",
        # Phase 10 commit 1 — provider_connections.tenant_id → platform.tenants.id.
        "provider_connections",
    }
    assert set(tenant_fks) == expected_fk_tables, (
        f"tenant_id FK targets mismatch. expected={expected_fk_tables}, got={set(tenant_fks)}"
    )

    # And the 4 run-tier per-recipient tables expose tenant_id WITHOUT a FK.
    no_fk_tables = await db_session.execute(
        text(
            """
            SELECT table_name FROM information_schema.columns
            WHERE table_schema='orchestration'
              AND column_name='tenant_id'
              AND table_name IN (
                'workflow_run_node_steps',
                'workflow_run_recipient_states',
                'workflow_run_recipient_actions',
                'workflow_run_recipient_overrides'
              )
            """
        )
    )
    assert {r[0] for r in no_fk_tables.all()} == {
        "workflow_run_node_steps",
        "workflow_run_recipient_states",
        "workflow_run_recipient_actions",
        "workflow_run_recipient_overrides",
    }
