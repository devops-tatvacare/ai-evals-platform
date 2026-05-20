"""Phase 1A regression — R4 must accept industry-pattern CTE+window SQL.

Locks in the live failure from production (2026-05-19) where the
data_specialist generated `ROW_NUMBER() OVER (...) AS rn` inside a CTE,
referenced `rn` in the outer query's WHERE, and the bouncer R4 falsely
rejected with ``unknown columns ['rn']``. The scope walker fix lifted
from ``semantic_lowering`` accepts CTE projection aliases.
"""
from __future__ import annotations

import pytest

from app.services.chat_engine.granularity_graph import build_granularity_graph
from app.services.chat_engine.sql_bouncer import check_before
from app.services.chat_engine.workbench_catalog import (
    load_workbench_catalog_strict,
)


@pytest.fixture(scope='module')
def catalog():
    return load_workbench_catalog_strict('inside-sales')


@pytest.fixture(scope='module')
def graph(catalog):
    return build_granularity_graph(catalog)


def test_top_n_with_row_number_passes_r4(catalog, graph):
    """Live failure SQL — top 10 evals via ROW_NUMBER + outer WHERE rn <= 10."""
    sql = """WITH latest AS (
        SELECT fe.run_id, fe.item_id, fe.evaluator_id, fe.created_at,
               ROW_NUMBER() OVER (ORDER BY fe.created_at DESC) AS rn,
               MAX(fe.created_at) OVER () AS latest_evaluation_timestamp
        FROM analytics.fact_evaluation fe
        WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id
    )
    SELECT run_id, item_id, evaluator_id, created_at, latest_evaluation_timestamp
    FROM latest
    WHERE rn <= 10
    ORDER BY created_at DESC"""
    v = check_before(
        sql=sql,
        declared_grain=['run_id', 'item_id', 'evaluator_id'],
        expected_row_bound='small',
        catalog=catalog,
        graph=graph,
    )
    assert v.ok, (
        f'CTE+window SQL should pass R4; got '
        f'{v.diagnostic.rule_id if v.diagnostic else "no diagnostic"}: '
        f'{v.diagnostic.message[:200] if v.diagnostic else ""}'
    )
    assert v.safe_sql is not None
    assert 'LIMIT' in v.safe_sql


def test_bare_column_cte_passes_r4(catalog, graph):
    """A CTE that projects bare catalog columns and an outer query that
    references them — the catalog in_scope_columns fallback handles this."""
    sql = """WITH x AS (
        SELECT fe.run_id, fe.created_at
        FROM analytics.fact_evaluation fe
        WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id
    )
    SELECT run_id, created_at FROM x WHERE created_at > '2020-01-01'"""
    v = check_before(
        sql=sql, declared_grain=['run_id'], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert v.ok


def test_bogus_column_still_rejects_r4(catalog, graph):
    """Negative — visible_projection_names must NOT seed bogus column names
    from the OUTER projection list. ``fe.totally_made_up_column`` must reject."""
    sql = """SELECT fe.totally_made_up_column, fe.created_at
    FROM analytics.fact_evaluation fe
    WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"""
    v = check_before(
        sql=sql, declared_grain=['run_id'], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.rule_number == 4
    assert v.diagnostic.rule_name == 'Allowed columns'
    assert any('totally_made_up_column' in c for c in v.diagnostic.offending_columns)
