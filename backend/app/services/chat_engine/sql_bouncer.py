"""SQL bouncer — deterministic safety surface for the data_specialist.

One module, two public entry points:

  * ``check_before(sql, ...) -> Verdict``      — pre-execution
  * ``check_after(rows, ...) -> Verdict``      — post-execution

Both return a ``Verdict`` discriminated as ``ok`` or ``invalid`` with a
structured diagnostic (``rule_id``, ``message``, optional ``hint``,
optional ``offending_tables``). The bouncer is deterministic — there are
no LLM calls, no I/O, no network. Same input ⇒ same verdict.

Backed by sqlglot's PostgreSQL dialect parser for AST awareness. Regex
validation is explicitly out of scope here; the regex-based legacy
helpers in ``sql_agent.py`` keep working for unrelated callers
(``analytics/chart_executor.py``) but Sherlock no longer routes through
them when a workbench catalog is present.

Rules (see plan §Phase 2 / design §4):

Pre-execution
  R1  read-only         — single SELECT or WITH-SELECT; no DDL / DML /
                          stacked statements / comments
  R2  allowed tables    — every base table must be a declared catalog
                          table; ``information_schema`` / ``pg_*`` rejected
  R3  declared joins    — every JOIN edge between two catalog tables must
                          exist in ``relationships[]``
  R4  allowed columns   — every referenced column must be a declared
                          logical column on the table reached via its
                          alias (passthrough or derived)
  R5  GROUP BY complete — every non-aggregated SELECT column appears in
                          GROUP BY
  R6  graph-aware agg   — aggregates must live at the lowest-grain table
                          in the query (or the query has only one node)
  R7  honest LIMIT      — server owns the cap; the LLM's LIMIT is ignored
                          (recorded in telemetry but bouncer rewrites)
  R8a fan trap          — coarse-grain table joined to fine-grain side
                          while aggregating the coarse side's measure
  R8b chasm trap        — two fine-grain facts joined through a shared
                          coarser dimension without separate aggregation
  R7s tenant/app scope  — every joined catalog-table alias must be
                          filtered by ``tenant_id = :tenant_id`` and
                          ``app_id = :app_id`` in the WHERE / ON tree

Post-execution
  R9  grain match       — declared_grain values are present in result
                          columns when more than one row is returned
  R10 no duplicate grain — distinct (grain) tuples across rows
  R11 row-limit truth   — propagate ``more_rows_exist`` / ``displayed_row_count``
  R12 not-all-null      — every result column has at least one non-null
                          value across the rows (otherwise reject)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import sqlglot
import sqlglot.expressions as exp
from sqlglot.errors import ParseError

from app.services.chat_engine.granularity_graph import (
    GranularityGraph,
    aggregate_at_lowest_grain,
)
from app.services.chat_engine.manifest import AppManifest
from app.services.chat_engine.workbench_catalog import (
    WorkbenchCatalog,
    WorkbenchTable,
)

logger = logging.getLogger(__name__)

ExpectedRowBound = Literal["single", "small", "medium", "large", "unbounded"]


# Server-owned row caps. The LLM declares an expected bound; the server
# chooses the cap. The bouncer rewrites the SQL to ``LIMIT cap + 1`` so
# we can detect truncation honestly.
ROW_CAPS: dict[ExpectedRowBound, int] = {
    "single": 1,
    "small": 50,
    "medium": 500,
    "large": 5_000,
    "unbounded": 50_000,
}
DEFAULT_ROW_CAP = ROW_CAPS["medium"]


# ── Verdict types ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class Diagnostic:
    rule_id: str
    message: str
    hint: str | None = None
    offending_tables: tuple[str, ...] = ()
    offending_columns: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"rule_id": self.rule_id, "message": self.message}
        if self.hint:
            d["hint"] = self.hint
        if self.offending_tables:
            d["offending_tables"] = list(self.offending_tables)
        if self.offending_columns:
            d["offending_columns"] = list(self.offending_columns)
        return d


@dataclass(frozen=True)
class Verdict:
    status: Literal["ok", "invalid"]
    diagnostic: Diagnostic | None = None
    # Pre-check side outputs:
    safe_sql: str | None = None
    limit_applied: int | None = None
    row_cap: int | None = None
    declared_grain: tuple[str, ...] = ()
    expected_row_bound: ExpectedRowBound | None = None
    # Post-check side outputs:
    more_rows_exist: bool | None = None
    displayed_row_count: int | None = None

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_telemetry(self) -> dict[str, Any]:
        out: dict[str, Any] = {"status": self.status}
        if self.diagnostic is not None:
            out["diagnostic"] = self.diagnostic.to_dict()
            out["rule_id"] = self.diagnostic.rule_id
        if self.declared_grain:
            out["declared_grain"] = list(self.declared_grain)
        if self.expected_row_bound is not None:
            out["expected_row_bound"] = self.expected_row_bound
        if self.row_cap is not None:
            out["row_cap"] = self.row_cap
        if self.limit_applied is not None:
            out["limit_applied"] = self.limit_applied
        if self.more_rows_exist is not None:
            out["more_rows_exist"] = self.more_rows_exist
        if self.displayed_row_count is not None:
            out["displayed_row_count"] = self.displayed_row_count
        return out


# ── Internal AST helpers ──────────────────────────────────────────────


@dataclass
class _AliasBinding:
    alias: str
    table: str  # catalog table name (lowercased)


@dataclass
class _ParsedSelect:
    """Flattened view of a parsed SQL statement.

    ``cte_names`` are bare names of WITH-clause aliases; references to
    these are allowed even though they're not catalog tables.
    """

    root: exp.Expression
    select_expr: exp.Select
    base_tables: list[_AliasBinding] = field(default_factory=list)
    cte_names: set[str] = field(default_factory=set)


# Postgres dialect for sqlglot. Centralized so future swaps stay easy.
_DIALECT = "postgres"


def _parse(sql: str) -> exp.Expression | None:
    try:
        parsed = sqlglot.parse(sql, read=_DIALECT)
    except ParseError:
        return None
    # ``sqlglot.parse`` returns a list (one per statement). Stacked
    # statements have len > 1 and are rejected by R1.
    if not parsed or any(p is None for p in parsed):
        return None
    if len(parsed) > 1:
        return None
    root = parsed[0]
    assert root is not None
    return root


def _flatten_select(root: exp.Expression) -> _ParsedSelect | None:
    """Return the ``Select`` to analyze plus base-table + CTE bindings.

    Accepts:
      * SELECT ...
      * WITH cte AS (SELECT ...) SELECT ...
    Rejects anything else (callers turn this into an R1 violation).

    Note on sqlglot shape: a top-level WITH parses as a ``Select`` whose
    ``args['with']`` holds the CTE list — there is no wrapping ``With``
    node. We pull CTE names from ``select.args['with'].expressions``.
    """
    cte_names: set[str] = set()
    select: exp.Select | None = None

    if isinstance(root, exp.Select):
        select = root
    elif isinstance(root, exp.With) and isinstance(root.this, exp.Select):
        select = root.this
        for cte in root.expressions:
            if isinstance(cte, exp.CTE):
                cte_names.add(cte.alias_or_name.lower())
    else:
        # Wrapped in parentheses, or a Subquery wrapper.
        inner = root.this if hasattr(root, "this") else None
        if isinstance(inner, exp.Select):
            select = inner
        else:
            return None

    if select is None:
        return None

    # Collect CTE names from the ``with`` arg of the Select (sqlglot's
    # actual representation for top-level CTEs).
    with_arg = select.args.get("with")
    if with_arg is not None:
        for cte in with_arg.expressions or []:
            if isinstance(cte, exp.CTE):
                cte_names.add(cte.alias_or_name.lower())

    # Collect derived-table aliases (``FROM (subquery) t``). The bouncer
    # doesn't crack open the subquery's projection — it skips column
    # references prefixed by these aliases at the R4 step.
    derived_aliases: set[str] = set()
    for sq in select.find_all(exp.Subquery):
        a = sq.alias_or_name
        if a:
            derived_aliases.add(a.lower())

    bindings = _collect_base_tables(select, cte_names)
    return _ParsedSelect(
        root=root,
        select_expr=select,
        base_tables=bindings,
        cte_names=cte_names | derived_aliases,
    )


def _collect_base_tables(
    select: exp.Select, cte_names: set[str]
) -> list[_AliasBinding]:
    """Walk ``select`` (FROM + JOINs + subqueries) collecting catalog-table aliases.

    CTE references are skipped — they're not catalog tables; their own
    bodies are analyzed separately by the bouncer when present.
    Function-table sources (``jsonb_array_elements(...) t``) are skipped
    by name match — they're allowed but not tracked as catalog tables.
    """
    bindings: list[_AliasBinding] = []
    seen: set[tuple[str, str]] = set()
    for table in select.find_all(exp.Table):
        # Skip table-typed nodes that are actually CTE references.
        name = (table.name or "").lower()
        if not name:
            continue
        if name in cte_names:
            continue
        alias = (table.alias or table.name or "").lower()
        key = (alias, name)
        if key in seen:
            continue
        seen.add(key)
        bindings.append(_AliasBinding(alias=alias, table=name))
    return bindings


def _select_columns(select: exp.Select) -> list[exp.Expression]:
    """Return SELECT projection expressions (aliases unwrapped)."""
    cols: list[exp.Expression] = []
    for e in select.expressions:
        if isinstance(e, exp.Alias):
            cols.append(e.this)
        else:
            cols.append(e)
    return cols


def _is_aggregate(expr: exp.Expression) -> bool:
    """True iff the expression *contains* an aggregate function call."""
    if isinstance(expr, (exp.AggFunc,)):
        return True
    return any(isinstance(node, exp.AggFunc) for node in expr.walk())


def _column_refs(expr: exp.Expression) -> list[exp.Column]:
    return [c for c in expr.find_all(exp.Column)]


def _column_alias(col: exp.Column) -> str | None:
    """Return the alias prefix of a column reference (``ef`` in ``ef.agent``)."""
    table_part = col.args.get("table")
    if isinstance(table_part, exp.Identifier):
        return table_part.name.lower()
    return None


def _alias_table_map(parsed: _ParsedSelect) -> dict[str, str]:
    """Map query aliases and bare table names to catalog table names."""
    alias_map: dict[str, str] = {}
    for b in parsed.base_tables:
        if b.alias:
            alias_map[b.alias] = b.table
        alias_map.setdefault(b.table, b.table)
    return alias_map


def expand_logical_columns(sql: str, catalog: WorkbenchCatalog) -> str:
    """Render executable SQL by replacing derived logical columns.

    The LLM writes catalog logical names such as ``call_opening_score``;
    Postgres needs the physical expression from the catalog. Passthrough
    columns are left untouched.
    """
    cleaned = _strip_trailing_semicolons(sql).strip()
    root = _parse(cleaned)
    if root is None:
        return cleaned
    parsed = _flatten_select(root)
    if parsed is None:
        return cleaned

    alias_to_table = _alias_table_map(parsed)
    select_alias_names = {
        e.alias.lower()
        for e in parsed.select_expr.expressions
        if isinstance(e, exp.Alias) and e.alias
    }

    def _replacement(node: exp.Expression) -> exp.Expression:
        if not isinstance(node, exp.Column):
            return node
        col_name = node.name.lower()
        if col_name in _UNIVERSAL_COLUMNS or col_name in select_alias_names:
            return node
        alias = _column_alias(node)
        if alias is not None and alias in parsed.cte_names:
            return node

        logical = None
        qualifier: str | None = alias
        if alias is not None:
            table_name = alias_to_table.get(alias)
            table = catalog.tables.get(table_name or "")
            logical = table.logical_column(col_name) if table is not None else None
        elif not parsed.cte_names:
            matches: list[tuple[str, WorkbenchTable, Any]] = []
            for binding in parsed.base_tables:
                table = catalog.tables.get(binding.table)
                if table is None:
                    continue
                candidate = table.logical_column(col_name)
                if candidate is not None:
                    matches.append((binding.alias or binding.table, table, candidate))
            if len(matches) == 1:
                qualifier, _table, logical = matches[0]

        if logical is None or not logical.is_derived or logical.expr is None:
            return node
        return _physical_expr_for_logical(logical.expr, qualifier)

    expanded = root.transform(_replacement, copy=True)
    return expanded.sql(dialect=_DIALECT)


def _physical_expr_for_logical(expr_sql: str, qualifier: str | None) -> exp.Expression:
    try:
        expr = sqlglot.parse_one(expr_sql, read=_DIALECT)
    except ParseError as exc:
        raise ValueError(f"invalid workbench logical expression: {expr_sql}") from exc

    if qualifier is None:
        return expr

    def _qualify(node: exp.Expression) -> exp.Expression:
        if isinstance(node, exp.Column) and _column_alias(node) is None:
            return exp.column(node.name, table=qualifier)
        return node

    return expr.transform(_qualify, copy=True)


def _has_postgres_comment(sql: str) -> bool:
    """Cheap pre-AST scan for ``--`` line comments and ``/* ... */`` blocks.

    The AST parser ignores comments; we explicitly reject them at the
    bouncer level so an LLM cannot smuggle context-shifting prose past
    R1's "no comments" rule (which is part of the read-only contract).
    """
    in_single = False
    in_double = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if not in_single and not in_double:
            if ch == "'":
                in_single = True
            elif ch == '"':
                in_double = True
            elif ch == "-" and nxt == "-":
                return True
            elif ch == "/" and nxt == "*":
                return True
        else:
            if in_single and ch == "'" and nxt != "'":
                in_single = False
            elif in_double and ch == '"' and nxt != '"':
                in_double = False
        i += 1
    return False


def _strip_trailing_semicolons(sql: str) -> str:
    s = sql.rstrip()
    while s.endswith(";"):
        s = s[:-1].rstrip()
    return s


# ── Pre-execution rules ───────────────────────────────────────────────


_DISALLOWED_SCHEMAS: frozenset[str] = frozenset(
    {"information_schema", "pg_catalog"}
)
_DISALLOWED_TABLE_PREFIXES: tuple[str, ...] = ("pg_",)


def _r1_readonly(sql: str) -> Verdict | None:
    """R1 — single read-only statement; no DDL/DML; no comments."""
    text = _strip_trailing_semicolons(sql).strip()
    if not text:
        return _fail(
            "R1.read_only",
            "submit_sql called with empty SQL",
        )
    if _has_postgres_comment(text):
        return _fail(
            "R1.no_comments",
            "SQL must not contain comments (-- or /* ... */).",
        )
    # Stacked statements: any non-whitespace after a semicolon = stacked.
    if ";" in text:
        # Allow exactly one trailing semicolon (stripped above); anything
        # else means stacked.
        return _fail(
            "R1.stacked_statements",
            "stacked statements are not allowed; submit one SELECT only",
        )

    root = _parse(text)
    if root is None:
        return _fail(
            "R1.parse_error",
            "SQL failed to parse as a single read-only PostgreSQL statement",
        )
    if isinstance(root, (exp.Insert, exp.Update, exp.Delete, exp.Merge)):
        return _fail("R1.dml_not_allowed", "DML statements are not allowed")
    if isinstance(
        root,
        (
            exp.Create,
            exp.Drop,
            exp.Alter,
            exp.AlterColumn,
            exp.TruncateTable,
            exp.Grant,
        ),
    ):
        return _fail("R1.ddl_not_allowed", "DDL statements are not allowed")
    parsed = _flatten_select(root)
    if parsed is None:
        return _fail(
            "R1.not_select",
            "only a single SELECT (or WITH ... SELECT) is allowed",
        )
    return None


def _r2_allowed_tables(parsed: _ParsedSelect, catalog: WorkbenchCatalog) -> Verdict | None:
    """R2 — every base table must be a declared catalog table.

    ``information_schema`` and ``pg_*`` are explicitly rejected.
    """
    catalog_names = {n.lower() for n in catalog.tables}
    bad: list[str] = []
    for b in parsed.base_tables:
        # Allow schema-qualified names whose unqualified name matches a
        # catalog table (e.g. ``analytics.fact_evaluation``).
        if b.table in catalog_names:
            continue
        if any(b.table.startswith(p) for p in _DISALLOWED_TABLE_PREFIXES):
            bad.append(b.table)
            continue
        bad.append(b.table)
    if bad:
        return _fail(
            "R2.allowed_tables",
            f"unknown or disallowed tables referenced: {sorted(set(bad))}",
            offending_tables=tuple(sorted(set(bad))),
            hint="use only catalog tables; check the workbench catalog for the list",
        )
    # Schema sanity — reject explicit information_schema/pg_catalog refs.
    for table in parsed.select_expr.find_all(exp.Table):
        db = (table.db or "").lower()
        if db in _DISALLOWED_SCHEMAS:
            return _fail(
                "R2.disallowed_schema",
                f"references to {db}.* are not allowed",
                offending_tables=(f"{db}.{table.name}",),
            )
    return None


def _r3_declared_joins(
    parsed: _ParsedSelect, graph: GranularityGraph
) -> Verdict | None:
    """R3 — joined catalog tables must use declared relationship keys."""
    tables = [b.table for b in parsed.base_tables if graph.has_table(b.table)]
    if len(tables) <= 1:
        return None
    # Treat the first table as the seed and require every other table to
    # connect to *some* table already accepted.
    accepted = {tables[0]}
    pending = list(tables[1:])
    while pending:
        progressed = False
        for t in list(pending):
            if any(graph.declared_join_exists(t, a) for a in accepted):
                accepted.add(t)
                pending.remove(t)
                progressed = True
        if not progressed:
            return _fail(
                "R3.undeclared_join",
                f"undeclared join: {sorted(pending)} are not connected "
                f"to {sorted(accepted)} via any declared relationship",
                offending_tables=tuple(sorted(pending)),
                hint="add a many_to_one relationship in the catalog or use a different table",
            )
    bad_pairs = _join_pairs_missing_declared_keys(parsed, graph)
    if bad_pairs:
        return _fail(
            "R3.declared_join_columns",
            "joined catalog tables must be joined on their declared relationship columns",
            offending_tables=tuple(sorted(bad_pairs)),
            hint="use the relationship columns declared in the workbench catalog",
        )
    return None


def _join_pairs_missing_declared_keys(
    parsed: _ParsedSelect, graph: GranularityGraph
) -> set[str]:
    alias_to_table = {
        alias: table
        for alias, table in _alias_table_map(parsed).items()
        if graph.has_table(table)
    }
    tables = sorted(set(alias_to_table.values()))
    if len(tables) <= 1:
        return set()

    required_pairs: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for idx, left in enumerate(tables):
        for right in tables[idx + 1:]:
            edge = graph.edge_for(left, right)
            if edge is not None:
                required_pairs[(left, right)] = {
                    (many_col.lower(), one_col.lower())
                    for many_col, one_col in edge.columns
                }

    satisfied: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for eq in parsed.select_expr.find_all(exp.EQ):
        left, right = eq.this, eq.expression
        if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
            continue
        left_alias = _column_alias(left)
        right_alias = _column_alias(right)
        if left_alias is None or right_alias is None:
            continue
        left_table = alias_to_table.get(left_alias)
        right_table = alias_to_table.get(right_alias)
        if (
            left_table is None
            or right_table is None
            or left_table == right_table
        ):
            continue
        match = _matched_declared_edge_key(
            graph,
            left_table=left_table,
            left_col=left.name,
            right_table=right_table,
            right_col=right.name,
        )
        if match is not None:
            pair, key = match
            satisfied.setdefault(pair, set()).add(key)

    return {
        f"{left}<->{right}"
        for (left, right), required_keys in required_pairs.items()
        if not required_keys.issubset(satisfied.get((left, right), set()))
    }


def _matched_declared_edge_key(
    graph: GranularityGraph,
    *,
    left_table: str,
    left_col: str,
    right_table: str,
    right_col: str,
) -> tuple[tuple[str, str], tuple[str, str]] | None:
    edge = graph.edge_for(left_table, right_table)
    if edge is None:
        return None
    l_col = left_col.lower()
    r_col = right_col.lower()
    pair = tuple(sorted((left_table, right_table)))
    for many_col, one_col in edge.columns:
        many_col = many_col.lower()
        one_col = one_col.lower()
        if left_table == edge.many and right_table == edge.one:
            if l_col == many_col and r_col == one_col:
                return pair, (many_col, one_col)
        elif left_table == edge.one and right_table == edge.many:
            if l_col == one_col and r_col == many_col:
                return pair, (many_col, one_col)
    return None


def _r4_allowed_columns(
    parsed: _ParsedSelect, catalog: WorkbenchCatalog
) -> Verdict | None:
    """R4 — every referenced column must be a declared logical column.

    Alias-aware: ``ef.agent`` resolves to ``fact_evaluation.agent`` if
    ``ef`` aliases ``fact_evaluation``. Unqualified columns are checked
    against the union of all in-scope catalog tables.

    Columns that the LLM uses as aliases in the SELECT/projection list
    (``AS foo``) are exempt — those don't have to exist in the catalog.
    Common always-allowed columns: tenant_id, app_id (every fact table
    declares these in the manifest even if not in logical columns) — we
    treat them as universal.
    """
    bindings = {b.alias: b.table for b in parsed.base_tables if b.alias}
    # Map bare table name -> table name (for ``fact_evaluation.agent``).
    table_names = {b.table: b.table for b in parsed.base_tables}
    alias_map: dict[str, WorkbenchTable] = {}
    for alias, t in bindings.items():
        if t in catalog.tables:
            alias_map[alias] = catalog.tables[t]
    for t_name, t in table_names.items():
        if t in catalog.tables:
            alias_map.setdefault(t_name, catalog.tables[t])

    in_scope_columns: set[str] = set()
    for t in alias_map.values():
        for c in t.all_logical_columns():
            in_scope_columns.add(c.name.lower())

    bad: list[str] = []

    select_alias_names = {
        e.alias.lower()
        for e in parsed.select_expr.expressions
        if isinstance(e, exp.Alias) and e.alias
    }

    for col in parsed.select_expr.find_all(exp.Column):
        col_name = col.name.lower()
        # Always-allowed.
        if col_name in _UNIVERSAL_COLUMNS:
            continue
        # SELECT-projection aliases referenced downstream (ORDER BY foo, …).
        if col_name in select_alias_names:
            continue
        # CTE references — column may belong to a CTE we don't expand.
        alias = _column_alias(col)
        if alias is not None and alias in parsed.cte_names:
            continue
        # Alias-prefixed column: must be declared on the bound table.
        if alias is not None:
            t = alias_map.get(alias)
            if t is None:
                bad.append(f"{alias}.{col.name}")
                continue
            if t.logical_column(col.name) is None and col_name not in _UNIVERSAL_COLUMNS:
                bad.append(f"{alias}.{col.name}")
            continue
        # Unqualified: must exist on at least one in-scope catalog table.
        if col_name not in in_scope_columns:
            bad.append(col.name)
    if bad:
        return _fail(
            "R4.allowed_columns",
            f"unknown or undeclared columns referenced: {sorted(set(bad))}",
            offending_columns=tuple(sorted(set(bad))),
            hint="use only logical columns declared in the workbench catalog",
        )
    return None


_UNIVERSAL_COLUMNS: frozenset[str] = frozenset(
    {"tenant_id", "app_id"}
)


# ── R4 JSONB-key grammar ──────────────────────────────────────────────
#
# Inside-sales fact tables carry an ``attributes`` JSONB column whose
# legal key set is declared per discriminator value (e.g. per
# ``activity_type``) in the manifest's ``attribute_schemas``. R4 ensures
# the SQL only reads keys that have been declared, so the data specialist
# cannot fish for undeclared (potentially PII or stale) keys.
#
# Grammar (per design §6.2):
#   ALLOWED iff EITHER
#     (a) WHERE has activity_type = '<t>' AND <key> is declared for <t>;
#     (b) WHERE has activity_type IN (<list>) AND <key> is declared for
#         every <t> in <list>;
#     (c) no activity_type filter AND <key> is declared for EVERY
#         activity_type the table supports (universal).
#   ALSO REJECT: jsonb_object_keys(attributes), unfiltered JSONB scans.

# Permission that unlocks PII reads at the bouncer level. Callers
# without this permission can still issue SQL — they just can't reference
# columns or JSONB keys the manifest marks ``pii: true``. The user-facing
# API-layer masking (Phase 11) lives separately; this is defense in depth.
_PII_VISIBILITY_PERMISSION = "analytics:pii-visibility"


_JSONB_CAST_COMPATIBILITY: dict[str, frozenset[str]] = {
    # Map ``data_type`` declared in attribute_schemas → the set of SQL
    # cast target types that are semantically compatible. The cast lands
    # on a TEXT value pulled out of the JSONB; we accept any cast whose
    # target maps onto the declared data class.
    "quantitative": frozenset({
        "int", "integer", "bigint", "smallint",
        "numeric", "decimal", "real", "double precision", "float",
    }),
    "temporal": frozenset({
        "date", "timestamp", "timestamptz",
        "timestamp with time zone", "timestamp without time zone",
        "interval",
    }),
    "boolean": frozenset({"boolean", "bool"}),
    "ordinal": frozenset({"int", "integer", "bigint", "smallint", "text"}),
    "nominal": frozenset({"text", "varchar", "uuid"}),
    "geo": frozenset({"text", "point"}),
}


def _normalize_cast_target(name: str) -> str:
    """Lowercase + collapse whitespace so 'TIMESTAMP  WITH  TIME ZONE'
    matches the keyset above."""
    return " ".join(name.lower().split())


def _cast_target_of(node: exp.Expression) -> str | None:
    """If ``node`` is wrapped in a ``CAST(... AS X)`` / ``::X``, return X.

    Walks up through the parent chain until it finds the immediate Cast
    parent or runs out of parents. None when the JSONB read is bare.
    """
    parent = node.parent
    while parent is not None:
        if isinstance(parent, exp.Cast):
            target = parent.to
            if isinstance(target, exp.DataType):
                return _normalize_cast_target(target.sql(dialect=_DIALECT))
            return _normalize_cast_target(str(target))
        # Skip transparent wrappers (Paren, Alias) — they don't carry a type.
        if isinstance(parent, (exp.Paren, exp.Alias)):
            parent = parent.parent
            continue
        return None
    return None


def _extract_jsonb_key(node: exp.Expression) -> str | None:
    """If ``node`` is ``attributes ->> 'k'`` / ``-> 'k'`` / ``#>> 'k'``
    / ``#> 'k'``, return ``k`` (string key). Otherwise None.

    sqlglot represents the path as either a string-literal ``expression``
    or a ``JSONPath(expressions=[JSONPathRoot(), JSONPathKey(this='k')])``
    node depending on dialect/version. We handle both. Multi-step paths
    return the FIRST key encountered (the innermost ``->``); the rule
    will be re-evaluated for any subsequent step. Numeric array indexes
    return None — those don't target declared keys.
    """
    if not isinstance(node, (exp.JSONExtract, exp.JSONExtractScalar)):
        return None
    this = node.this
    if not isinstance(this, exp.Column) or this.name.lower() != "attributes":
        return None
    path = node.expression
    if isinstance(path, exp.Literal) and path.is_string:
        return str(path.this)
    # sqlglot JSONPath shape.
    if path is not None:
        for step in path.find_all(exp.JSONPathKey):
            val = step.this
            if isinstance(val, str):
                return val
    return None


def _activity_type_filter(parsed: _ParsedSelect) -> tuple[str, set[str] | None]:
    """Return ``(mode, values)`` describing the SELECT's activity_type filter.

    - ``("equality", {"call"})`` for ``activity_type = 'call'``
    - ``("in", {"call", "email"})`` for ``activity_type IN ('call', 'email')``
    - ``("unfiltered", None)`` if no equality / IN predicate on
      activity_type is present (the rule then requires universal key
      declaration).
    """
    where = parsed.select_expr.args.get("where")
    if where is None:
        return ("unfiltered", None)
    eq_values: set[str] = set()
    for eq in where.find_all(exp.EQ):
        col = eq.left if isinstance(eq.left, exp.Column) else None
        lit = eq.right if isinstance(eq.right, exp.Literal) else None
        if col is None or lit is None:
            continue
        if col.name.lower() != "activity_type":
            continue
        if not lit.is_string:
            continue
        eq_values.add(lit.this)
    in_values: set[str] = set()
    for in_node in where.find_all(exp.In):
        col = in_node.this if isinstance(in_node.this, exp.Column) else None
        if col is None or col.name.lower() != "activity_type":
            continue
        for v in in_node.expressions:
            if isinstance(v, exp.Literal) and v.is_string:
                in_values.add(v.this)
    if eq_values and not in_values:
        return ("equality", eq_values)
    if in_values and not eq_values:
        return ("in", in_values)
    if eq_values and in_values:
        return ("in", eq_values | in_values)
    return ("unfiltered", None)


def _r4_jsonb_keys(
    parsed: _ParsedSelect,
    manifest: "AppManifest | None",
) -> Verdict | None:
    """R4 JSONB grammar — declared-keys-only access to ``attributes``.

    No-op when ``manifest`` is None (e.g. apps without a Phase-7
    attribute_schemas migration yet) — the existing R4 column rule still
    applies. When the manifest is present, every observed
    ``attributes->>'k'`` reference must be declared for the active
    discriminator scope, and ``jsonb_object_keys(attributes)`` is
    rejected outright (it would expose undeclared keys).
    """
    if manifest is None:
        return None

    # Reject jsonb_object_keys(attributes) — meta-introspection bypasses
    # the declared-keys discipline entirely.
    for func in parsed.select_expr.find_all(exp.Anonymous):
        fname = (func.this or "").lower() if isinstance(func.this, str) else ""
        if fname == "jsonb_object_keys":
            for arg in func.expressions:
                if isinstance(arg, exp.Column) and arg.name.lower() == "attributes":
                    return _fail(
                        "R4.jsonb_meta_introspection",
                        "jsonb_object_keys(attributes) is not allowed — "
                        "reading the key set would expose undeclared keys.",
                        hint="reference declared keys explicitly via attributes->>'<key>'",
                    )

    # Collect every (table, key) pair the SQL reads off ``attributes``.
    # Table resolution: attribute access without an alias prefix is
    # attributed to whichever in-scope catalog table actually has
    # ``attributes`` declared. Multiple such tables → ambiguous; the
    # rule conservatively rejects (the LLM should alias-prefix).
    parsed_tables = {b.table for b in parsed.base_tables}
    candidate_tables = [
        t for t in parsed_tables
        if t in manifest.catalog_tables
        and "attributes" in manifest.catalog_tables[t].columns
    ]

    # Each tuple: (table, key, cast_target_normalized_or_None)
    accessed_keys: list[tuple[str, str, str | None]] = []
    # JSONExtractScalar = ->> ; JSONExtract = -> / #> / #>>
    jsonb_nodes: list[exp.Expression] = []
    jsonb_nodes.extend(parsed.select_expr.find_all(exp.JSONExtractScalar))
    jsonb_nodes.extend(parsed.select_expr.find_all(exp.JSONExtract))
    for node in jsonb_nodes:
        key = _extract_jsonb_key(node)
        if key is None:
            continue
        cast_target = _cast_target_of(node)
        col = node.this  # the "attributes" column
        alias = _column_alias(col) if isinstance(col, exp.Column) else None
        if alias is not None:
            # Resolve alias → table.
            bound = next(
                (b.table for b in parsed.base_tables if b.alias == alias),
                None,
            )
            if bound is None:
                return _fail(
                    "R4.jsonb_unbound_alias",
                    f"attributes->>{key!r} prefixed with unknown alias "
                    f"{alias!r}",
                    hint="qualify with a table alias bound in FROM/JOIN",
                )
            if bound not in candidate_tables:
                return _fail(
                    "R4.jsonb_unknown_table",
                    f"attributes->>{key!r} references {bound!r} which has "
                    f"no declared attribute_schemas",
                )
            accessed_keys.append((bound, key, cast_target))
            continue
        # Unaliased: must resolve unambiguously.
        if len(candidate_tables) != 1:
            return _fail(
                "R4.jsonb_ambiguous_table",
                f"unqualified attributes->>{key!r} is ambiguous — "
                f"FROM lists {sorted(parsed_tables)}; alias-prefix the "
                f"column with the table that owns the attribute_schemas.",
            )
        accessed_keys.append((candidate_tables[0], key, cast_target))

    if not accessed_keys:
        return None

    mode, values = _activity_type_filter(parsed)

    def _cast_compatible(declared_data_type: str | None, target: str) -> bool:
        if declared_data_type is None:
            # No declared type means any cast is acceptable — operator
            # didn't constrain the key's shape.
            return True
        allowed = _JSONB_CAST_COMPATIBILITY.get(declared_data_type)
        if allowed is None:
            return True  # unknown declared type → permissive (warn-worthy upstream)
        return target in allowed

    for table_name, key, cast_target in accessed_keys:
        table = manifest.catalog_tables[table_name]
        schemas = table.attribute_schemas
        if not schemas:
            return _fail(
                "R4.jsonb_no_schema",
                f"{table_name}.attributes->>{key!r}: table has no "
                f"attribute_schemas declared.",
            )
        # Resolve the scoped-discriminator values for this key access.
        if mode in ("equality", "in") and values is not None:
            scoped_values = values
            missing_for = [v for v in scoped_values if key not in (schemas.get(v) or {})]
            if missing_for:
                return _fail(
                    "R4.jsonb_undeclared_key",
                    f"{table_name}.attributes->>{key!r}: not declared for "
                    f"activity_type(s) {sorted(missing_for)}",
                    hint=(
                        f"declare {key!r} in attribute_schemas for those "
                        f"activity_types, or scope the SELECT to activity_types "
                        f"where the key is declared"
                    ),
                )
        else:
            # Unfiltered: key must be universal across every declared
            # discriminator value (excluding _default which means "no
            # discriminator").
            all_discriminators = [d for d in schemas.keys() if d != "_default"]
            if not all_discriminators:
                if key in (schemas.get("_default") or {}):
                    scoped_values = {"_default"}
                else:
                    return _fail(
                        "R4.jsonb_undeclared_key",
                        f"{table_name}.attributes->>{key!r}: not declared in "
                        f"_default schema.",
                    )
            else:
                missing_for = [
                    d for d in all_discriminators
                    if key not in (schemas.get(d) or {})
                ]
                if missing_for:
                    return _fail(
                        "R4.jsonb_unfiltered_access",
                        f"{table_name}.attributes->>{key!r}: read without an "
                        f"activity_type filter, and the key is not declared "
                        f"for activity_type(s) {sorted(missing_for)}.",
                        hint=(
                            "add WHERE activity_type = '...' (or IN (...)) "
                            "covering only activity_types that declare this key"
                        ),
                    )
                scoped_values = set(all_discriminators)

        # Cast-type validation. The cast target (when present) must be
        # compatible with the declared data_type of the key under every
        # scoped discriminator value. The JSONB read itself yields TEXT;
        # the cast is what types it.
        if cast_target is not None:
            for v in scoped_values:
                key_schema = (schemas.get(v) or {}).get(key)
                if key_schema is None:
                    continue
                if not _cast_compatible(key_schema.data_type, cast_target):
                    return _fail(
                        "R4.jsonb_cast_mismatch",
                        f"{table_name}.attributes->>{key!r} cast to "
                        f"{cast_target!r} disagrees with declared "
                        f"data_type={key_schema.data_type!r} for "
                        f"activity_type={v!r}.",
                        hint=(
                            "cast targets must align with the key's declared "
                            "data_type (quantitative→numeric/int, "
                            "temporal→timestamp, boolean→bool, etc.)"
                        ),
                    )
    return None


def _r4_pii_visibility(
    parsed: _ParsedSelect,
    manifest: "AppManifest | None",
    permissions: frozenset[str] | None,
) -> Verdict | None:
    """Reject SQL that touches a manifest-tagged ``pii: true`` column or
    JSONB key when the caller lacks the ``analytics:pii-visibility``
    permission.

    No-op when ``manifest`` is None (apps without Phase-7 attribute_schemas
    yet) or when ``permissions`` is None (callsite hasn't been updated to
    pass them — treat as legacy / privileged context). When permissions is
    a frozenset (even empty), enforcement kicks in.

    Covers two surfaces:
      * Typed columns where ``ManifestColumn.pii`` is True — checked
        against ``Column`` references in the parsed SELECT.
      * JSONB keys where ``AttributeKeySchema.pii`` is True — checked
        against ``attributes->>'k'`` reads under the active activity_type
        scope.
    """
    if manifest is None or permissions is None:
        return None
    if _PII_VISIBILITY_PERMISSION in permissions:
        return None  # caller has clearance; no further checks needed.

    # Build (table, in-scope) and PII-key sets per table.
    in_scope_tables = {b.table: b for b in parsed.base_tables}
    pii_columns_by_table: dict[str, set[str]] = {}
    pii_keys_by_table: dict[str, dict[str, set[str]]] = {}
    for tname in in_scope_tables.keys():
        t = manifest.catalog_tables.get(tname)
        if t is None:
            continue
        pii_columns_by_table[tname] = {
            cname for cname, col in t.columns.items() if col.pii
        }
        per_disc: dict[str, set[str]] = {}
        for disc, key_block in t.attribute_schemas.items():
            keys = {k for k, schema in key_block.items() if schema.pii}
            if keys:
                per_disc[disc] = keys
        if per_disc:
            pii_keys_by_table[tname] = per_disc

    if not any(pii_columns_by_table.values()) and not pii_keys_by_table:
        return None

    # Typed-column references.
    alias_to_table = {
        b.alias: b.table for b in parsed.base_tables if b.alias
    }
    for col in parsed.select_expr.find_all(exp.Column):
        col_name = col.name
        alias = _column_alias(col)
        if alias is not None:
            owner = alias_to_table.get(alias) or (
                alias if alias in in_scope_tables else None
            )
        elif len(pii_columns_by_table) == 1:
            owner = next(iter(pii_columns_by_table))
        else:
            # Unqualified column with multiple PII-bearing tables in
            # scope is ambiguous — fall back to scanning all of them.
            owner = None
        if owner is not None:
            if col_name in pii_columns_by_table.get(owner, set()):
                return _fail(
                    "R4.pii_typed_column",
                    f"{owner}.{col_name} is PII-tagged and requires "
                    f"{_PII_VISIBILITY_PERMISSION!r}.",
                )
            continue
        # Unqualified — only fire when ANY in-scope PII table declares it.
        for tname, pii_cols in pii_columns_by_table.items():
            if col_name in pii_cols:
                return _fail(
                    "R4.pii_typed_column",
                    f"{tname}.{col_name} (unqualified) is PII-tagged and "
                    f"requires {_PII_VISIBILITY_PERMISSION!r}.",
                )

    # JSONB-key references.
    jsonb_nodes: list[exp.Expression] = []
    jsonb_nodes.extend(parsed.select_expr.find_all(exp.JSONExtractScalar))
    jsonb_nodes.extend(parsed.select_expr.find_all(exp.JSONExtract))
    if jsonb_nodes:
        mode, values = _activity_type_filter(parsed)
        for node in jsonb_nodes:
            key = _extract_jsonb_key(node)
            if key is None:
                continue
            col = node.this
            alias = _column_alias(col) if isinstance(col, exp.Column) else None
            if alias is not None:
                owner = alias_to_table.get(alias)
            else:
                # Unaliased: only resolve when exactly one PII-keyed
                # table is in scope.
                if len(pii_keys_by_table) == 1:
                    owner = next(iter(pii_keys_by_table))
                else:
                    owner = None
            if owner is None or owner not in pii_keys_by_table:
                continue
            per_disc = pii_keys_by_table[owner]
            if mode in ("equality", "in") and values is not None:
                scoped = values
            else:
                # Unfiltered → key applies under every declared
                # discriminator value with PII-tagged keys.
                scoped = set(per_disc.keys())
            for v in scoped:
                if key in per_disc.get(v, set()):
                    return _fail(
                        "R4.pii_jsonb_key",
                        f"{owner}.attributes->>{key!r} is PII-tagged for "
                        f"activity_type={v!r} and requires "
                        f"{_PII_VISIBILITY_PERMISSION!r}.",
                    )
    return None


def _r5_group_by_complete(parsed: _ParsedSelect) -> Verdict | None:
    """R5 — every non-aggregated SELECT column must appear in GROUP BY.

    Implementation: when the SELECT list has at least one aggregate
    AND at least one non-aggregate projection, the non-aggregate
    expression's text must appear in the GROUP BY clause (sqlglot's
    canonicalization handles ``ef.agent`` vs ``agent``).
    """
    group_clause = parsed.select_expr.args.get("group")
    has_group = bool(
        group_clause
        and getattr(group_clause, "expressions", None)
    )
    has_agg = any(_is_aggregate(p) for p in _select_columns(parsed.select_expr))
    if not has_agg:
        return None
    non_aggs = [
        p for p in _select_columns(parsed.select_expr)
        if not _is_aggregate(p)
    ]
    if not non_aggs:
        return None
    if not has_group:
        return _fail(
            "R5.missing_group_by",
            "non-aggregated SELECT columns are present but GROUP BY is missing",
            hint="add GROUP BY for every dimension column projected alongside an aggregate",
        )
    group_keys: set[str] = set()
    for g in (group_clause.expressions if group_clause is not None else []):
        group_keys.add(_canon_key(g))
    missing: list[str] = []
    for na in non_aggs:
        if _canon_key(na) not in group_keys:
            missing.append(na.sql(dialect=_DIALECT))
    if missing:
        return _fail(
            "R5.incomplete_group_by",
            f"non-aggregated columns missing from GROUP BY: {missing}",
            offending_columns=tuple(missing),
        )
    return None


def _canon_key(e: exp.Expression) -> str:
    """A canonical comparison key for grouping/aggregation."""
    if isinstance(e, exp.Column):
        return e.name.lower()
    return e.sql(dialect=_DIALECT).lower()


def _r6_agg_lowest_grain(
    parsed: _ParsedSelect, graph: GranularityGraph
) -> Verdict | None:
    """R6 — aggregates must live at the lowest-grain table among joined tables."""
    tables = [b.table for b in parsed.base_tables if graph.has_table(b.table)]
    if len(tables) <= 1:
        return None
    measured_tables: set[str] = set()
    for p in _select_columns(parsed.select_expr):
        if not _is_aggregate(p):
            continue
        # Find the alias prefix of each column inside this aggregate.
        for col in _column_refs(p):
            alias = _column_alias(col)
            if alias is None:
                continue
            # Resolve alias -> catalog table.
            for b in parsed.base_tables:
                if b.alias == alias and graph.has_table(b.table):
                    measured_tables.add(b.table)
    if not measured_tables:
        return None
    if not aggregate_at_lowest_grain(
        graph,
        tables_in_query=tables,
        measured_tables=measured_tables,
    ):
        lowest = graph.lowest_grain_table(tables)
        return _fail(
            "R6.aggregate_at_coarser_grain",
            f"aggregating on {sorted(measured_tables)} while the lowest-grain "
            f"table in the query is {lowest!r}",
            offending_tables=tuple(sorted(measured_tables)),
            hint=(
                "move the aggregate to the lowest-grain table or restructure the join"
            ),
        )
    return None


def _r8a_fan_trap(
    parsed: _ParsedSelect, graph: GranularityGraph
) -> Verdict | None:
    """R8a — measure on the coarse side of a many-to-one edge.

    Surfaces as a fan trap when the SELECT aggregates a measure from the
    *one* side of a declared edge while joining the *many* side; the
    measure is multiplied across rows. R6 already covers this when the
    edge is between two catalog tables in the graph, so R8a focuses on
    the inverse pattern (aggregating on the ONE side specifically).
    """
    tables = [b.table for b in parsed.base_tables if graph.has_table(b.table)]
    if len(tables) <= 1:
        return None
    fan = graph.fan_trap_path(tables)
    if fan is None:
        return None
    coarse, fine = fan
    # If the SELECT aggregates a column on the coarse table -> fan trap.
    coarse_alias = None
    for b in parsed.base_tables:
        if b.table == coarse:
            coarse_alias = b.alias or b.table
            break
    if coarse_alias is None:
        return None
    for p in _select_columns(parsed.select_expr):
        if not _is_aggregate(p):
            continue
        for col in _column_refs(p):
            a = _column_alias(col)
            if a == coarse_alias:
                return _fail(
                    "R8a.fan_trap",
                    f"fan trap: aggregating on {coarse!r} while joining the "
                    f"finer-grain table {fine!r} multiplies the measure",
                    offending_tables=(coarse, fine),
                    hint=(
                        "aggregate on the fine-grain side or pre-aggregate the coarse side first"
                    ),
                )
    return None


def _r8b_chasm_trap(
    parsed: _ParsedSelect, graph: GranularityGraph
) -> Verdict | None:
    """R8b — two fine-grain facts joined through one shared dimension.

    The classic example is the ``calls × emails`` cardinality blow-up
    through ``leads``. We reject these cross-fact joins outright; the
    LLM is expected to ask each fact separately and combine results in
    the supervisor narrative.
    """
    tables = [b.table for b in parsed.base_tables if graph.has_table(b.table)]
    if len(tables) <= 2:
        return None
    chasm = graph.chasm_trap_path(tables)
    if chasm is None:
        return None
    fact_a, dim, fact_b = chasm
    return _fail(
        "R8b.chasm_trap",
        f"chasm trap: joining {fact_a!r} and {fact_b!r} through {dim!r} "
        f"multiplies their cardinalities",
        offending_tables=(fact_a, dim, fact_b),
        hint=(
            "query each fact separately; the supervisor can combine results "
            "downstream without inflating cardinality"
        ),
    )


def _r7s_tenant_app_scope(
    parsed: _ParsedSelect, catalog: WorkbenchCatalog
) -> Verdict | None:
    """R7s — every catalog-table alias must be tenant + app filtered.

    Walks WHERE and JOIN ON predicates to ensure every catalog-bound
    alias appears on the left side of ``tenant_id = :tenant_id`` and
    ``app_id = :app_id``. Unqualified ``tenant_id = :tenant_id`` is
    only acceptable when exactly one catalog table is in scope.
    """
    catalog_bindings = [
        b for b in parsed.base_tables if b.table in catalog.tables
    ]
    if not catalog_bindings:
        return None
    # Collect equality predicates that are guaranteed by the boolean tree.
    # Predicates under OR are not guaranteed unless every branch contains them.
    tenant_aliases, app_aliases = _guaranteed_scope_aliases(parsed.select_expr)
    # If exactly one catalog binding, an unqualified filter is enough.
    if len(catalog_bindings) == 1:
        b = catalog_bindings[0]
        ok_tenant = (None in tenant_aliases) or (b.alias in tenant_aliases) or (
            b.table in tenant_aliases
        )
        ok_app = (None in app_aliases) or (b.alias in app_aliases) or (
            b.table in app_aliases
        )
        if not (ok_tenant and ok_app):
            return _fail(
                "R7s.tenant_app_scope",
                f"missing tenant_id/app_id filter for {b.table!r}",
                offending_tables=(b.table,),
                hint="add tenant_id = :tenant_id AND app_id = :app_id to the WHERE clause",
            )
        return None
    # Multiple catalog tables: every alias must be explicitly scoped.
    for b in catalog_bindings:
        alias_key = b.alias or b.table
        if alias_key not in tenant_aliases or alias_key not in app_aliases:
            return _fail(
                "R7s.tenant_app_scope_per_alias",
                f"alias {alias_key!r} (table {b.table!r}) is not filtered by "
                f"tenant_id/app_id; multi-table joins must scope every alias",
                offending_tables=(b.table,),
                hint=(
                    f"add {alias_key}.tenant_id = :tenant_id AND "
                    f"{alias_key}.app_id = :app_id"
                ),
            )
    return None


def _guaranteed_scope_aliases(select: exp.Select) -> tuple[set[str | None], set[str | None]]:
    tenant_aliases: set[str | None] = set()
    app_aliases: set[str | None] = set()
    roots: list[exp.Expression] = []
    for where in select.find_all(exp.Where):
        roots.append(where.this)
    for join in select.find_all(exp.Join):
        on_expr = join.args.get("on")
        if on_expr is not None:
            roots.append(on_expr)

    for root in roots:
        tenant, app = _scope_aliases_required_by(root)
        tenant_aliases.update(tenant)
        app_aliases.update(app)
    return tenant_aliases, app_aliases


def _scope_aliases_required_by(
    expr: exp.Expression,
) -> tuple[set[str | None], set[str | None]]:
    if isinstance(expr, exp.And):
        left_tenant, left_app = _scope_aliases_required_by(expr.this)
        right_tenant, right_app = _scope_aliases_required_by(expr.expression)
        return left_tenant | right_tenant, left_app | right_app
    if isinstance(expr, exp.Or):
        left_tenant, left_app = _scope_aliases_required_by(expr.this)
        right_tenant, right_app = _scope_aliases_required_by(expr.expression)
        return left_tenant & right_tenant, left_app & right_app
    if isinstance(expr, exp.Paren) and expr.this is not None:
        return _scope_aliases_required_by(expr.this)
    if isinstance(expr, exp.EQ):
        left, right = expr.this, expr.expression
        if not isinstance(left, exp.Column):
            return set(), set()
        if _is_named_param(right, "tenant_id"):
            return {_column_alias(left)}, set()
        if _is_named_param(right, "app_id"):
            return set(), {_column_alias(left)}
    return set(), set()


def _is_named_param(expr: exp.Expression, name: str) -> bool:
    """True iff ``expr`` is a named ``:name`` placeholder matching ``name``.

    sqlglot represents bare ``:foo`` as ``Placeholder(this='foo')`` for
    the Postgres dialect; older fixtures also see ``Parameter(this=Var('foo'))``.
    Both shapes are handled.
    """
    if isinstance(expr, exp.Placeholder):
        inner = expr.this
        if isinstance(inner, str):
            return inner.lower() == name.lower()
        if isinstance(inner, exp.Var):
            return inner.name.lower() == name.lower()
    if isinstance(expr, exp.Parameter):
        inner = expr.this
        if isinstance(inner, exp.Var):
            return inner.name.lower() == name.lower()
        if isinstance(inner, str):
            return inner.lower() == name.lower()
    return False


def _r7_apply_server_limit(
    parsed: _ParsedSelect,
    *,
    cap: int,
) -> tuple[str, int]:
    """R7 — wrap the query with ``LIMIT cap + 1``.

    Any top-level LIMIT/OFFSET the LLM put on the query is stripped before
    wrapping, so the server-owned cap can honestly detect one extra row.
    """
    inner = _strip_top_level_limit_offset(parsed.root)
    safe = (
        f"SELECT * FROM ({inner}) AS bouncer_limited_result "
        f"LIMIT {cap + 1}"
    )
    return safe, cap + 1


def _strip_top_level_limit_offset(root: exp.Expression) -> str:
    stripped = root.copy()
    target = stripped if isinstance(stripped, exp.Select) else None
    if target is None:
        flat = _flatten_select(stripped)
        target = flat.select_expr if flat is not None else None
    if target is not None:
        target.set("limit", None)
        target.set("offset", None)
    return stripped.sql(dialect=_DIALECT)


# ── Public API: check_before ──────────────────────────────────────────


def check_before(
    *,
    sql: str,
    declared_grain: list[str],
    expected_row_bound: ExpectedRowBound,
    catalog: WorkbenchCatalog,
    graph: GranularityGraph,
    row_cap_override: int | None = None,
    manifest: AppManifest | None = None,
    permissions: frozenset[str] | None = None,
) -> Verdict:
    """Run the pre-execution gauntlet over ``sql``.

    Returns a ``Verdict`` whose ``safe_sql`` is the LIMIT-rewritten SQL
    when ``status == "ok"``. Callers execute ``safe_sql`` and then call
    ``check_after`` on the resulting rows.
    """
    if expected_row_bound not in ROW_CAPS:
        return _attach_meta(
            _fail(
                "R7.invalid_expected_row_bound",
                f"expected_row_bound must be one of {sorted(ROW_CAPS)}, got {expected_row_bound!r}",
                hint="use single, small, medium, large, or unbounded",
            ),
            declared_grain,
            "medium",
        )

    # R1: read-only, single statement, no comments.
    if (v := _r1_readonly(sql)) is not None:
        return _attach_meta(v, declared_grain, expected_row_bound)

    text = _strip_trailing_semicolons(sql).strip()
    root = _parse(text)
    if root is None:
        return _attach_meta(
            _fail("R1.parse_error", "SQL failed to parse"),
            declared_grain,
            expected_row_bound,
        )
    parsed = _flatten_select(root)
    if parsed is None:
        return _attach_meta(
            _fail("R1.not_select", "only SELECT or WITH ... SELECT is allowed"),
            declared_grain,
            expected_row_bound,
        )

    # R2 → R8b run in order. First failure short-circuits.
    for check in (
        lambda: _r2_allowed_tables(parsed, catalog),
        lambda: _r3_declared_joins(parsed, graph),
        lambda: _r4_allowed_columns(parsed, catalog),
        lambda: _r4_jsonb_keys(parsed, manifest),
        lambda: _r4_pii_visibility(parsed, manifest, permissions),
        lambda: _r5_group_by_complete(parsed),
        lambda: _r6_agg_lowest_grain(parsed, graph),
        lambda: _r7s_tenant_app_scope(parsed, catalog),
        lambda: _r8a_fan_trap(parsed, graph),
        lambda: _r8b_chasm_trap(parsed, graph),
    ):
        result = check()
        if result is not None:
            return _attach_meta(result, declared_grain, expected_row_bound)

    # R7: server-owned LIMIT.
    cap = row_cap_override if row_cap_override is not None else ROW_CAPS.get(
        expected_row_bound, DEFAULT_ROW_CAP
    )
    safe_sql, limit_applied = _r7_apply_server_limit(parsed, cap=cap)
    return Verdict(
        status="ok",
        safe_sql=safe_sql,
        limit_applied=limit_applied,
        row_cap=cap,
        declared_grain=tuple(declared_grain),
        expected_row_bound=expected_row_bound,
    )


# ── Post-execution rules ──────────────────────────────────────────────


def check_after(
    *,
    rows: list[dict[str, Any]],
    declared_grain: list[str],
    expected_row_bound: ExpectedRowBound,
    row_cap: int,
) -> Verdict:
    """Run the post-execution gauntlet on ``rows``.

    Caller must pass the exact ``row_cap`` used in ``check_before``
    (i.e. ``Verdict.row_cap``). Rows must be the *raw* execution result
    — the bouncer trims to ``row_cap`` and sets ``more_rows_exist`` when
    the raw set has ``cap + 1`` rows.
    """
    grain = tuple(declared_grain)
    # R11 first — propagate honest pagination.
    more = len(rows) > row_cap
    displayed = rows[:row_cap] if more else rows
    displayed_count = len(displayed)

    if not displayed:
        # Empty result is a valid ok-verdict; downstream renders an
        # "empty" chart card. R12 (all-null) only triggers on non-empty
        # rows that have explicit columns.
        return Verdict(
            status="ok",
            declared_grain=grain,
            expected_row_bound=expected_row_bound,
            row_cap=row_cap,
            more_rows_exist=False,
            displayed_row_count=0,
        )

    # R9 — every declared grain column must be present in the result.
    sample_keys = {k.lower() for k in displayed[0].keys()}
    missing_grain = [g for g in grain if g.lower() not in sample_keys]
    # Allow grain mismatch when the result has a single row (KPI shape)
    # — there is no duplicate-row risk.
    if missing_grain and len(displayed) > 1:
        return _attach_post_meta(
            _fail(
                "R9.grain_missing",
                f"declared_grain columns missing from result: {missing_grain}",
                offending_columns=tuple(missing_grain),
                hint="include every declared_grain column in the SELECT projection",
            ),
            grain,
            expected_row_bound,
            row_cap=row_cap,
            more_rows_exist=more,
            displayed_row_count=displayed_count,
        )

    # R10 — distinct grain tuples.
    if grain and len(displayed) > 1 and not missing_grain:
        seen: set[tuple[Any, ...]] = set()
        for r in displayed:
            key = tuple(r.get(g) for g in grain)
            if key in seen:
                return _attach_post_meta(
                    _fail(
                        "R10.duplicate_grain",
                        f"duplicate rows for declared_grain={list(grain)}; "
                        f"first duplicate at key {key!r}",
                        offending_columns=tuple(grain),
                        hint=(
                            "the query is at a finer grain than declared_grain; "
                            "either tighten declared_grain or add aggregation"
                        ),
                    ),
                    grain,
                    expected_row_bound,
                    row_cap=row_cap,
                    more_rows_exist=more,
                    displayed_row_count=displayed_count,
                )
            seen.add(key)

    # R12 — at least one non-null value per column.
    if displayed:
        cols = list(displayed[0].keys())
        all_null = [
            c for c in cols
            if all(r.get(c) is None for r in displayed)
        ]
        if all_null and len(cols) > 0:
            # All-null result columns indicate the query selected fields
            # that are NULL for every row in scope — refuse rather than
            # render a misleading chart of nulls.
            return _attach_post_meta(
                _fail(
                    "R12.all_null_columns",
                    f"result columns are entirely NULL: {all_null}",
                    offending_columns=tuple(all_null),
                    hint=(
                        "filter the query to exclude rows where these "
                        "columns are NULL, or pick a different column"
                    ),
                ),
                grain,
                expected_row_bound,
                row_cap=row_cap,
                more_rows_exist=more,
                displayed_row_count=displayed_count,
            )

    return Verdict(
        status="ok",
        declared_grain=grain,
        expected_row_bound=expected_row_bound,
        row_cap=row_cap,
        more_rows_exist=more,
        displayed_row_count=displayed_count,
    )


# ── Small helpers ────────────────────────────────────────────────────


def _fail(
    rule_id: str,
    message: str,
    *,
    hint: str | None = None,
    offending_tables: tuple[str, ...] = (),
    offending_columns: tuple[str, ...] = (),
) -> Verdict:
    return Verdict(
        status="invalid",
        diagnostic=Diagnostic(
            rule_id=rule_id,
            message=message,
            hint=hint,
            offending_tables=offending_tables,
            offending_columns=offending_columns,
        ),
    )


def _attach_meta(
    v: Verdict,
    declared_grain: list[str],
    expected_row_bound: ExpectedRowBound,
) -> Verdict:
    cap = ROW_CAPS.get(expected_row_bound, DEFAULT_ROW_CAP)
    return Verdict(
        status=v.status,
        diagnostic=v.diagnostic,
        safe_sql=v.safe_sql,
        limit_applied=v.limit_applied if v.limit_applied is not None else cap + 1,
        row_cap=v.row_cap if v.row_cap is not None else cap,
        declared_grain=tuple(declared_grain),
        expected_row_bound=expected_row_bound,
    )


def _attach_post_meta(
    v: Verdict,
    grain: tuple[str, ...],
    expected_row_bound: ExpectedRowBound,
    *,
    row_cap: int,
    more_rows_exist: bool,
    displayed_row_count: int,
) -> Verdict:
    return Verdict(
        status=v.status,
        diagnostic=v.diagnostic,
        declared_grain=grain,
        expected_row_bound=expected_row_bound,
        row_cap=row_cap,
        more_rows_exist=more_rows_exist,
        displayed_row_count=displayed_row_count,
    )


def trim_rows(rows: list[dict[str, Any]], row_cap: int) -> list[dict[str, Any]]:
    """Helper used by the data_specialist handler when post-check returns ok."""
    return rows[:row_cap]


def apply_server_limit(sql: str, *, row_cap: int) -> str:
    """Wrap ``sql`` with a server-owned ``LIMIT cap + 1``.

    Used after ``prepare_query`` has injected parameters and access
    filters; the bouncer's ``check_before`` returns the same shape on
    raw input. Exposed publicly so the data_specialist handler can
    re-apply the cap once the SQL has been prepared.
    """
    cleaned = _strip_trailing_semicolons(sql).strip()
    root = _parse(cleaned)
    if root is not None:
        cleaned = _strip_top_level_limit_offset(root)
    return (
        f"SELECT * FROM ({cleaned}) AS bouncer_limited_result "
        f"LIMIT {row_cap + 1}"
    )


# ── Re-exports for tests / wiring ────────────────────────────────────


__all__ = [
    "Diagnostic",
    "ExpectedRowBound",
    "ROW_CAPS",
    "Verdict",
    "apply_server_limit",
    "check_after",
    "check_before",
    "expand_logical_columns",
    "trim_rows",
]
