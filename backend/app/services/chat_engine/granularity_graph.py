"""Granularity graph — bouncer's primitive for safe joins and aggregation.

Built once per catalog at boot. Nodes are unique *analytical granularities*
(tables whose ``analytical_grain.columns`` collapse together via one-to-one
relationships are merged into a single node). Edges are many-to-one joins
declared in the catalog's ``relationships[]``.

Reference: Snowflake Cortex Analyst's "Introducing Joins" engineering post,
adapted for Postgres + tenant-scoped facts.

The bouncer uses this graph to answer four structural questions about a
candidate SQL query:

  1. ``allowed_join_exists(left, right)`` — is there a declared edge
     between these two tables in either direction?
  2. ``lowest_grain_table(tables)`` — among the tables joined in this
     query, which one has the finest grain (i.e. is downstream of the
     others)? Aggregates that *don't* live at this grain are wrong.
  3. ``fan_trap(tables)`` — does the join chain combine a coarser-grain
     table with a finer-grain one in a way that inflates measures on
     the coarse side? (Classic example: ``orders × order_items`` while
     summing ``orders.total``.)
  4. ``chasm_trap(tables)`` — does the chain join two finer-grain facts
     through a shared dimension, multiplying their cardinality?
     (Classic example: ``calls × emails`` through ``leads``.)

The structures are immutable; tests build them by hand.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.services.chat_engine.workbench_catalog import (
    Relationship,
    WorkbenchCatalog,
)


@dataclass(frozen=True)
class Edge:
    """One directed many-to-one edge from ``many`` table to ``one`` table.

    ``columns`` is the list of (many_side_col, one_side_col) join keys
    drawn from the catalog ``relationship_columns``. Stored for use by
    the bouncer's "declared joins only" rule.
    """

    many: str
    one: str
    columns: tuple[tuple[str, str], ...]
    relationship_name: str


@dataclass(frozen=True)
class GrainNode:
    """One unique analytical granularity in the graph.

    A node may collapse multiple tables when one-to-one relationships
    bind them — for inside-sales we have no such case today, so each
    table is its own node, but the structure supports it.
    """

    name: str
    members: frozenset[str]
    grain_columns: tuple[str, ...]


class GranularityGraph:
    """Read-only graph over a workbench catalog."""

    def __init__(
        self,
        catalog: WorkbenchCatalog,
        *,
        nodes: dict[str, GrainNode],
        edges: tuple[Edge, ...],
        table_to_node: dict[str, str],
    ) -> None:
        self._catalog = catalog
        self._nodes = nodes
        self._edges = edges
        self._table_to_node = table_to_node

    # ── Lookups ───────────────────────────────────────────────────────

    @property
    def nodes(self) -> dict[str, GrainNode]:
        return dict(self._nodes)

    @property
    def edges(self) -> tuple[Edge, ...]:
        return self._edges

    def node_for(self, table: str) -> GrainNode | None:
        node_name = self._table_to_node.get(table)
        if node_name is None:
            return None
        return self._nodes.get(node_name)

    def has_table(self, table: str) -> bool:
        return table in self._table_to_node

    # ── Structural queries used by the bouncer ───────────────────────

    def declared_join_exists(self, a: str, b: str) -> bool:
        """True iff a many-to-one edge connects ``a`` and ``b`` in either direction."""
        for e in self._edges:
            if (e.many == a and e.one == b) or (e.many == b and e.one == a):
                return True
        return False

    def edge_for(self, a: str, b: str) -> Edge | None:
        """Return the declared edge between ``a`` and ``b`` (either direction)."""
        for e in self._edges:
            if (e.many == a and e.one == b) or (e.many == b and e.one == a):
                return e
        return None

    def lowest_grain_table(self, tables: Iterable[str]) -> str | None:
        """Return the finest-grain table among ``tables`` (the "many" end).

        For a chain ``A -> B -> C`` (many-to-one from left to right),
        the finest grain is ``A``. If two tables share a node (1:1
        collapsed), either name is acceptable — we return the first
        match in the input order. Returns ``None`` for an empty input
        or when no table is in the graph.
        """
        ts = [t for t in tables if t in self._table_to_node]
        if not ts:
            return None
        # Build "downstream-of" relation from edges.
        downstream_of: dict[str, set[str]] = {t: set() for t in ts}
        for e in self._edges:
            if e.many in downstream_of and e.one in downstream_of:
                downstream_of[e.many].add(e.one)
        # A table is "lowest" if it isn't on the *one* side of any
        # other table in the input set.
        on_one_side_of: dict[str, set[str]] = {t: set() for t in ts}
        for t, downs in downstream_of.items():
            for d in downs:
                on_one_side_of[d].add(t)
        for t in ts:
            if not on_one_side_of[t]:
                return t
        # Cycle (impossible with valid many_to_one chains) — fall back
        # to the first table so the caller still gets a deterministic
        # answer rather than ``None``.
        return ts[0]

    def fan_trap_path(self, tables: Iterable[str]) -> tuple[str, str] | None:
        """Detect a fan trap: a measure on the *one* side of a many-to-one
        edge that is multiplied by the join with the *many* side.

        Returns a ``(coarse_table, fine_table)`` tuple pointing at the
        offending edge, or ``None`` if no fan trap exists.

        The check here is structural: if the query joins two tables A
        and B where A is on the *one* side (coarser) and B is on the
        *many* side (finer) AND the SQL aggregates a column on A,
        the same row of A appears multiple times in the join product
        — classic fan trap.

        The bouncer wires this together by combining ``fan_trap_path``
        with the SQL's measured columns. This module reports the *edge*;
        the bouncer decides whether the measure lives on the wrong side.
        """
        ts = [t for t in tables if t in self._table_to_node]
        if len(ts) < 2:
            return None
        ts_set = set(ts)
        for e in self._edges:
            if e.many in ts_set and e.one in ts_set:
                return (e.one, e.many)
        return None

    def chasm_trap_path(
        self, tables: Iterable[str]
    ) -> tuple[str, str, str] | None:
        """Detect a chasm trap: two finer-grain facts joined through a
        shared coarser dimension, multiplying cardinality.

        Returns ``(fact_a, dimension, fact_b)`` when found, ``None``
        otherwise. The classic case: A -> D <- B where both A and B are
        on the many side, and the SQL doesn't aggregate either of them
        separately.
        """
        ts = [t for t in tables if t in self._table_to_node]
        if len(ts) < 3:
            return None
        ts_set = set(ts)
        # Build adjacency from the many side.
        one_for_many: dict[str, set[str]] = {}
        for e in self._edges:
            if e.many in ts_set and e.one in ts_set:
                one_for_many.setdefault(e.many, set()).add(e.one)
        # For each "one" table, find at least two "many" sides among ts.
        many_for_one: dict[str, set[str]] = {}
        for many, ones in one_for_many.items():
            for one in ones:
                many_for_one.setdefault(one, set()).add(many)
        for one, manies in many_for_one.items():
            if len(manies) >= 2:
                a, b = sorted(manies)[:2]
                return (a, one, b)
        return None


# ── Build ─────────────────────────────────────────────────────────────


def build_granularity_graph(catalog: WorkbenchCatalog) -> GranularityGraph:
    """Build the graph from the catalog's tables + relationships.

    Today we treat every table as its own grain node (no 1:1 collapse);
    when a future catalog adds ``one_to_one`` relationships, this
    function would union the relevant table names into a single node.
    The structure is ready for that without code changes elsewhere.
    """
    nodes: dict[str, GrainNode] = {}
    table_to_node: dict[str, str] = {}

    # 1) Group tables by 1:1 relationships (DSU).
    parent: dict[str, str] = {t: t for t in catalog.tables}

    def _find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: str, b: str) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[ra] = rb

    for rel in catalog.relationships:
        if rel.relationship_type == "one_to_one":
            _union(rel.left_table, rel.right_table)

    # 2) Build node objects.
    grouped: dict[str, list[str]] = {}
    for t in catalog.tables:
        grouped.setdefault(_find(t), []).append(t)
    for _root, members in grouped.items():
        # Node name = canonical member (alphabetical first) so it's stable.
        canonical = sorted(members)[0]
        grain_cols: tuple[str, ...] = tuple(
            catalog.tables[canonical].analytical_grain.columns
        )
        node = GrainNode(
            name=canonical,
            members=frozenset(members),
            grain_columns=grain_cols,
        )
        nodes[canonical] = node
        for m in members:
            table_to_node[m] = canonical

    # 3) Build directed edges for many-to-one (and the inverse of one-to-many).
    edges: list[Edge] = []
    for rel in catalog.relationships:
        if rel.relationship_type == "many_to_one":
            edges.append(_edge_from_rel(rel, many=rel.left_table, one=rel.right_table))
        elif rel.relationship_type == "one_to_many":
            edges.append(_edge_from_rel(rel, many=rel.right_table, one=rel.left_table))
        # one_to_one already collapsed; many_to_many forbidden at catalog load.

    return GranularityGraph(
        catalog,
        nodes=nodes,
        edges=tuple(edges),
        table_to_node=table_to_node,
    )


def _edge_from_rel(rel: Relationship, *, many: str, one: str) -> Edge:
    if many == rel.left_table:
        cols = tuple((p.left_column, p.right_column) for p in rel.relationship_columns)
    else:
        cols = tuple((p.right_column, p.left_column) for p in rel.relationship_columns)
    return Edge(many=many, one=one, columns=cols, relationship_name=rel.name)


# ── Convenience: aggregate placement check ────────────────────────────


def aggregate_at_lowest_grain(
    graph: GranularityGraph,
    *,
    tables_in_query: Iterable[str],
    measured_tables: Iterable[str],
) -> bool:
    """Return True iff every measured table is at the lowest grain in the query.

    Used by the bouncer's R4 (graph-aware aggregate placement) rule.
    A measure on a coarser-grain (``one`` side) table is suspicious in
    a multi-table join — it's almost always a fan trap. The bouncer
    pairs this with ``fan_trap_path`` for a precise diagnostic.

    If the lowest-grain table cannot be determined (single-table query
    or empty input), we return True — there's nothing to compare against.
    """
    lowest = graph.lowest_grain_table(tables_in_query)
    if lowest is None:
        return True
    lowest_node = graph.node_for(lowest)
    if lowest_node is None:
        return True
    for t in measured_tables:
        node = graph.node_for(t)
        if node is None:
            # Not in the graph at all — caller will reject for "allowed
            # tables" reasons; we don't double-report.
            continue
        if node.name != lowest_node.name:
            return False
    return True
