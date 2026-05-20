"""Semantic-model lowering for workbench SQL.

Translates LOGICAL SQL (the names the LLM writes against the workbench
catalog) into PHYSICAL SQL (what Postgres executes). One rule, walked
uniformly across every SELECT scope in the AST:

    for every Column reference:
        resolve (qualifier, name) → (catalog table, logical_column)
        if logical_column.is_derived (.expr ≠ name):
            substitute the AST node with the parsed .expr
        else:
            leave unchanged

Resolution is per-scope: each enclosing SELECT contributes its own
FROM/JOIN bindings. Nested SELECTs (CTE bodies, FROM-subqueries,
correlated subqueries) resolve against their own bindings, not the
outer query's. References qualified by a CTE name are never rewritten
— the bouncer's R4 already validated those projections.

This is the third leg of the bouncer pipeline; see
``app/services/chat_engine/sql_bouncer.py`` for the surrounding
``check_before`` (validates logical SQL) and ``check_after``
(validates result rows). Lowering sits between them, just before
``prepare_query`` parameter binding.

Why a dedicated module: lowering is a deterministic translation
concern. The bouncer is a rule-evaluation concern. Mixing them in
sql_bouncer.py (1781 LOC) buried this step and let an over-broad
SELECT-alias skip cause silent bugs (kaira-bot ``persona_tactic``,
2026-05-18). One file, one responsibility, one rule.

The pattern mirrors Snowflake Cortex / Databricks Genie / dbt
MetricFlow / Looker: LLM writes against semantic names; a
deterministic compiler lowers to warehouse-physical SQL. The LLM never
sees the JSONB / CASE-WHEN / arithmetic shapes; the manifest is the
only source of truth.
"""
from __future__ import annotations

import sqlglot
import sqlglot.expressions as exp
from sqlglot.errors import ParseError

from app.services.chat_engine.scope import (
    ScopeBindings as _ScopeBindings,
    compute_scope_bindings as _compute_scope_bindings,
)
from app.services.chat_engine.sql_bouncer import (
    _UNIVERSAL_COLUMNS,
    _DIALECT,
    _column_alias,
    _parse,
    _strip_trailing_semicolons,
)
from app.services.chat_engine.workbench_catalog import (
    LogicalColumn,
    WorkbenchCatalog,
    WorkbenchTable,
)


def lower_sql(sql: str, catalog: WorkbenchCatalog) -> str:
    """Lower workbench-logical SQL to Postgres-physical SQL.

    Inputs:
      * ``sql``      — caller-supplied SQL referencing manifest logical
                       column names (the form the bouncer validates).
      * ``catalog``  — parsed workbench catalog for the active app.

    Output: equivalent SQL with every derived logical column reference
    substituted with its declared ``expr`` (qualified by the table
    alias the reference was bound to). Passthrough columns, CTE column
    projections, parameter placeholders, and references the manifest
    does not know about are left unchanged — the bouncer's R4 already
    rejected anything illegitimate before lowering runs.

    Idempotent: lowering a physical SQL is a no-op because no remaining
    Column nodes still match a derived manifest entry.
    """
    cleaned = _strip_trailing_semicolons(sql).strip()
    root = _parse(cleaned)
    if root is None:
        return cleaned

    # Per-scope binding cache, keyed by Select node identity. Computed
    # lazily as the walker first encounters each scope.
    scope_cache: dict[int, _ScopeBindings] = {}

    def _bindings_for(select_node: exp.Select) -> _ScopeBindings:
        key = id(select_node)
        cached = scope_cache.get(key)
        if cached is not None:
            return cached
        bindings = _compute_scope_bindings(select_node)
        scope_cache[key] = bindings
        return bindings

    def _resolve(node: exp.Expression) -> exp.Expression:
        if not isinstance(node, exp.Column):
            return node
        col_name = node.name.lower()
        if col_name in _UNIVERSAL_COLUMNS:
            return node

        scope = node.find_ancestor(exp.Select)
        if scope is None:
            return node
        bindings = _bindings_for(scope)

        qualifier: str | None = _column_alias(node)

        # Qualified by a CTE / derived subquery in scope: leave alone.
        if qualifier is not None and qualifier in bindings.cte_aliases:
            return node

        logical: LogicalColumn | None = None
        if qualifier is not None:
            table_name = bindings.catalog_aliases.get(qualifier)
            table = catalog.tables.get(table_name or '')
            logical = table.logical_column(col_name) if table is not None else None
        else:
            # Unqualified: search THIS scope's base tables for an
            # unambiguous match. Ambiguity (same logical name on two
            # joined tables) is left unchanged — either the query is
            # malformed (Postgres complains) or the columns are
            # passthroughs (no harm in leaving them).
            matches: list[tuple[str, WorkbenchTable, LogicalColumn]] = []
            for alias, table_name in bindings.catalog_aliases.items():
                table = catalog.tables.get(table_name)
                if table is None:
                    continue
                candidate = table.logical_column(col_name)
                if candidate is not None:
                    matches.append((alias, table, candidate))
            if len(matches) == 1:
                qualifier, _table, logical = matches[0]

        if logical is None or not logical.is_derived or logical.expr is None:
            return node
        return _expand_expr(logical.expr, qualifier)

    expanded = root.transform(_resolve, copy=True)
    return expanded.sql(dialect=_DIALECT)


def _expand_expr(expr_sql: str, qualifier: str | None) -> exp.Expression:
    """Parse a logical column's ``expr`` and qualify its bare references.

    If the expr references column names without a table prefix, attach
    the qualifier (the alias the original reference was bound to) so
    JOIN scopes resolve correctly.
    """
    try:
        expr = sqlglot.parse_one(expr_sql, read=_DIALECT)
    except ParseError as exc:
        raise ValueError(f'invalid workbench logical expression: {expr_sql}') from exc
    if qualifier is None:
        return expr

    def _qualify(node: exp.Expression) -> exp.Expression:
        if isinstance(node, exp.Column) and _column_alias(node) is None:
            return exp.column(node.name, table=qualifier)
        return node

    return expr.transform(_qualify, copy=True)


__all__ = ['lower_sql']
