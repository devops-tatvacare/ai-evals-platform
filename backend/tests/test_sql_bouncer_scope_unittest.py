"""Phase 1A — scope walker + bouncer R4 CTE-projection-aware acceptance."""
from __future__ import annotations

import sqlglot
import sqlglot.expressions as exp

from app.services.chat_engine.scope import (
    compute_scope_bindings,
    visible_projection_names,
)


def _parse_select(sql: str):
    root = sqlglot.parse_one(sql, read='postgres')
    if root and root.find(exp.Select):
        return root, root.find(exp.Select)
    return root, root


def test_scope_collects_catalog_alias():
    sql = "SELECT fe.run_id FROM analytics.fact_evaluation fe WHERE fe.tenant_id = :tenant_id"
    root, sel = _parse_select(sql)
    b = compute_scope_bindings(sel)
    assert 'fe' in b.catalog_aliases
    assert b.catalog_aliases['fe'] == 'fact_evaluation'


def test_scope_collects_cte_alias_in_outer_select():
    sql = """WITH x AS (SELECT 1 AS one) SELECT one FROM x"""
    root, sel = _parse_select(sql)
    outer_select = root  # top-level Select carries the WITH
    b = compute_scope_bindings(outer_select)
    assert 'x' in b.cte_aliases


def test_scope_collects_outer_projection_aliases():
    sql = "SELECT count(*) AS total, fe.agent FROM analytics.fact_evaluation fe"
    root, sel = _parse_select(sql)
    b = compute_scope_bindings(sel)
    assert 'total' in b.projection_aliases
    # bare-column projection (no AS) is NOT collected — it's a reference, not a declaration
    assert 'agent' not in b.projection_aliases


def test_visible_projection_names_captures_cte_aliases_only():
    sql = """WITH latest AS (
        SELECT fe.run_id,
               ROW_NUMBER() OVER (ORDER BY fe.created_at) AS rn,
               MAX(fe.created_at) OVER () AS latest_ts
        FROM analytics.fact_evaluation fe
    )
    SELECT run_id, rn, latest_ts FROM latest"""
    root = sqlglot.parse_one(sql, read='postgres')
    names = visible_projection_names(root)
    assert 'rn' in names
    assert 'latest_ts' in names
    # bare CTE-internal column projection NOT in pool (acts as a reference, not declaration)
    assert 'run_id' not in names
    # outer-select bare references NOT in pool either
    assert 'agent' not in names


def test_visible_projection_does_not_seed_bogus_columns_from_outer_projection():
    # The bug we caught: visible_projection_names previously collected bare
    # column refs from the OUTER projection, which let `SELECT fe.bogus_col`
    # pass R4 because the projection itself seeded the acceptance pool.
    sql = "SELECT fe.bogus_col, fe.created_at FROM analytics.fact_evaluation fe"
    root = sqlglot.parse_one(sql, read='postgres')
    names = visible_projection_names(root)
    assert 'bogus_col' not in names
    assert 'created_at' not in names
