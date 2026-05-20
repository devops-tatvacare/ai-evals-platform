"""Live-DB round-trip for ``semantic_lowering.lower_sql``.

Unit tests in ``test_semantic_lowering_unittest.py`` pin the AST
rewrite shape; this suite proves the rewritten SQL actually executes
against Postgres without ``UndefinedColumnError`` — the failure mode
that hit kaira-bot's ``persona_tactic`` on 2026-05-18.

Uses real catalogs (kaira-bot, voice-rx, inside-sales) loaded from the
running container. Skips if a catalog file is missing (lets the suite
run on slimmed-down dev environments). No fixtures, no synthetic
schemas — that's the unit test's job.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.services.chat_engine.semantic_lowering import lower_sql
from app.services.chat_engine.workbench_catalog import (
    has_workbench_catalog,
    load_workbench_catalog_strict,
)


def _skip_if_no_catalog(app_id: str) -> None:
    if not has_workbench_catalog(app_id):
        pytest.skip(f'no workbench catalog for {app_id}')


@pytest.mark.asyncio
async def test_kaira_bot_persona_tactic_executes(db_session) -> None:
    """The 2026-05-18 regression: LLM writes the catalog-logical name
    ``persona_tactic`` (a JSONB extract), the bouncer accepts it, and
    the rewritten SQL must reach Postgres as the underlying
    ``context->>'persona_tactics_attempted'``. Pre-fix: bare
    ``persona_tactic`` reached PG and raised UndefinedColumnError."""
    _skip_if_no_catalog('kaira-bot')
    catalog = load_workbench_catalog_strict('kaira-bot')
    logical = (
        "SELECT persona_tactic "
        "FROM analytics.fact_evaluation "
        "WHERE tenant_id = :tenant_id "
        "  AND app_id = :app_id "
        "  AND persona_tactic IS NOT NULL "
        "LIMIT 5"
    )
    physical = lower_sql(logical, catalog)
    assert 'context' in physical, (
        f'kaira-bot persona_tactic must lower to context->>… extract; '
        f'got: {physical}'
    )
    # Execute against the real DB. Bind params with a SYSTEM-tenant
    # dummy: the test only proves no UndefinedColumnError; row count
    # is irrelevant (the bouncer wraps with LIMIT separately in prod).
    from app.constants import SYSTEM_TENANT_ID
    rows = (await db_session.execute(
        text(physical),
        {'tenant_id': str(SYSTEM_TENANT_ID), 'app_id': 'kaira-bot'},
    )).fetchall()
    assert isinstance(rows, list)  # executed successfully


@pytest.mark.asyncio
async def test_kaira_bot_persona_id_case_when_executes(db_session) -> None:
    """``persona_id`` is a CASE-WHEN derived column on
    fact_evaluation_criterion. The rewriter must expand it to the
    case-expression before it hits PG."""
    _skip_if_no_catalog('kaira-bot')
    catalog = load_workbench_catalog_strict('kaira-bot')
    logical = (
        "SELECT persona_id, COUNT(*) AS n "
        "FROM analytics.fact_evaluation_criterion "
        "WHERE tenant_id = :tenant_id "
        "  AND app_id = :app_id "
        "GROUP BY persona_id "
        "LIMIT 10"
    )
    physical = lower_sql(logical, catalog)
    assert 'CASE' in physical.upper(), (
        f'persona_id must lower to its CASE-WHEN expression; got: {physical}'
    )
    from app.constants import SYSTEM_TENANT_ID
    rows = (await db_session.execute(
        text(physical),
        {'tenant_id': str(SYSTEM_TENANT_ID), 'app_id': 'kaira-bot'},
    )).fetchall()
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_kaira_bot_same_name_alias_executes(db_session) -> None:
    """The exact shape that failed on 2026-05-18: LLM aliases the
    derived column to its own name (so the result column reads
    naturally). Pre-fix, the over-broad SELECT-alias skip prevented
    expansion and PG saw a bare ``persona_tactic`` column."""
    _skip_if_no_catalog('kaira-bot')
    catalog = load_workbench_catalog_strict('kaira-bot')
    logical = (
        "SELECT COALESCE(NULLIF(TRIM(persona_tactic), ''), '(none)') AS persona_tactic, "
        "       COUNT(*) AS failures "
        "FROM analytics.fact_evaluation "
        "WHERE tenant_id = :tenant_id "
        "  AND app_id = :app_id "
        "GROUP BY persona_tactic "
        "LIMIT 10"
    )
    physical = lower_sql(logical, catalog)
    # Every occurrence of persona_tactic (TRIM arg + GROUP BY) must be
    # lowered; the result-column alias remains as `AS persona_tactic`.
    assert physical.count('context') >= 2, (
        f'both persona_tactic references must lower; got: {physical}'
    )
    from app.constants import SYSTEM_TENANT_ID
    try:
        (await db_session.execute(
            text(physical),
            {'tenant_id': str(SYSTEM_TENANT_ID), 'app_id': 'kaira-bot'},
        )).fetchall()
    except ProgrammingError as exc:
        pytest.fail(
            f'rewritten SQL still raises ProgrammingError on PG: {exc}'
        )


@pytest.mark.asyncio
async def test_inside_sales_call_opening_score_executes(db_session) -> None:
    """inside-sales ``call_opening_score`` is a JSONB cast extract
    from result_detail — same lowering shape as kaira-bot's persona
    columns, different app, different catalog. Proves the rewriter is
    app-agnostic; the manifest is the only source of truth."""
    _skip_if_no_catalog('inside-sales')
    catalog = load_workbench_catalog_strict('inside-sales')
    logical = (
        "SELECT agent, AVG(call_opening_score) AS avg_opening "
        "FROM analytics.fact_evaluation "
        "WHERE tenant_id = :tenant_id "
        "  AND app_id = :app_id "
        "GROUP BY agent "
        "LIMIT 5"
    )
    physical = lower_sql(logical, catalog)
    assert 'result_detail' in physical, (
        f'inside-sales call_opening_score must lower to result_detail->>… ; '
        f'got: {physical}'
    )
    from app.constants import SYSTEM_TENANT_ID
    rows = (await db_session.execute(
        text(physical),
        {'tenant_id': str(SYSTEM_TENANT_ID), 'app_id': 'inside-sales'},
    )).fetchall()
    assert isinstance(rows, list)


@pytest.mark.asyncio
async def test_passthrough_column_unchanged_and_executes(db_session) -> None:
    """Passthrough (1:1) columns must NOT be touched by the rewriter,
    AND the unmodified SQL must execute. Proves rewriter is no-op on
    columns it has no business lowering."""
    _skip_if_no_catalog('inside-sales')
    catalog = load_workbench_catalog_strict('inside-sales')
    logical = (
        "SELECT agent, COUNT(*) AS n "
        "FROM analytics.fact_evaluation "
        "WHERE tenant_id = :tenant_id "
        "  AND app_id = :app_id "
        "GROUP BY agent "
        "LIMIT 5"
    )
    physical = lower_sql(logical, catalog)
    # No rewrite expected for the passthrough `agent` column.
    assert ' agent' in physical, f'agent passthrough must remain: {physical}'
    from app.constants import SYSTEM_TENANT_ID
    rows = (await db_session.execute(
        text(physical),
        {'tenant_id': str(SYSTEM_TENANT_ID), 'app_id': 'inside-sales'},
    )).fetchall()
    assert isinstance(rows, list)
