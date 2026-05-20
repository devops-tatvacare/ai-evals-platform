"""Phase 1A — enriched Diagnostic surface (available_* + did_you_mean)."""
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


def test_r2_diagnostic_carries_available_tables(catalog, graph):
    """Unknown table → diagnostic populates ``available_tables``."""
    sql = """SELECT * FROM analytics.totally_made_up_table fe
    WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"""
    v = check_before(
        sql=sql, declared_grain=[], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.rule_number == 2
    assert v.diagnostic.available_tables  # non-empty
    assert 'fact_evaluation' in v.diagnostic.available_tables


def test_r4_diagnostic_carries_available_columns_for(catalog, graph):
    """Unknown column → diagnostic populates ``available_columns_for``."""
    sql = """SELECT fe.bogus_field FROM analytics.fact_evaluation fe
    WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"""
    v = check_before(
        sql=sql, declared_grain=[], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.rule_number == 4
    assert 'fact_evaluation' in v.diagnostic.available_columns_for
    cols = v.diagnostic.available_columns_for['fact_evaluation']
    assert 'agent' in cols
    assert 'created_at' in cols


def test_r4_diagnostic_did_you_mean_close_match(catalog, graph):
    """Close-match column → ``did_you_mean`` suggests the catalog column."""
    sql = """SELECT fe.creatd_at FROM analytics.fact_evaluation fe
    WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"""
    v = check_before(
        sql=sql, declared_grain=[], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.did_you_mean
    suggested = v.diagnostic.did_you_mean.get('fe.creatd_at') or \
        v.diagnostic.did_you_mean.get('creatd_at')
    assert suggested == 'created_at'


def test_diagnostic_message_uses_rule_n_prefix_not_raw_token(catalog, graph):
    """User-facing message says 'Rule N — <Name>: …', not raw ``R<n>.<slug>``."""
    sql = """SELECT fe.bogus FROM analytics.fact_evaluation fe
    WHERE fe.tenant_id = :tenant_id AND fe.app_id = :app_id"""
    v = check_before(
        sql=sql, declared_grain=[], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.message.startswith('Rule 4 — Allowed columns:')
    # rule_id still carries the structured token for telemetry
    assert v.diagnostic.rule_id == 'R4.allowed_columns'


def test_r7s_diagnostic_carries_required_scope_predicates(catalog, graph):
    """Missing tenant/app filter → diagnostic lists the required predicates."""
    sql = """SELECT fe.run_id FROM analytics.fact_evaluation fe"""
    v = check_before(
        sql=sql, declared_grain=[], expected_row_bound='small',
        catalog=catalog, graph=graph,
    )
    assert not v.ok
    assert v.diagnostic.rule_number == 7
    assert any(
        'tenant_id' in p for p in v.diagnostic.required_scope_predicates
    )
    assert any(
        'app_id' in p for p in v.diagnostic.required_scope_predicates
    )
