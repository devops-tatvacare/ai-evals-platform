"""Per-SELECT scope walker shared by sql_bouncer (R4) and semantic_lowering."""
from __future__ import annotations

from dataclasses import dataclass, field

import sqlglot.expressions as exp


@dataclass(slots=True)
class ScopeBindings:
    """One SELECT scope's directly-visible bindings."""

    catalog_aliases: dict[str, str] = field(default_factory=dict)
    cte_aliases: set[str] = field(default_factory=set)
    projection_aliases: set[str] = field(default_factory=set)


def compute_scope_bindings(select_node: exp.Select) -> ScopeBindings:
    """Walk one SELECT's direct FROM/JOIN/WITH + own projection list; does NOT recurse into nested SELECTs."""
    bindings = ScopeBindings()

    for cte in _ctes_in_scope(select_node):
        bindings.cte_aliases.add(cte.lower())

    sources: list[exp.Expression] = []
    from_clause = select_node.args.get('from')
    if isinstance(from_clause, exp.From):
        if isinstance(from_clause.this, exp.Expression):
            sources.append(from_clause.this)
        sources.extend(from_clause.expressions)
    for join in select_node.args.get('joins') or []:
        if isinstance(join, exp.Join):
            this = join.this
            if isinstance(this, exp.Expression):
                sources.append(this)

    for source in sources:
        if isinstance(source, exp.Table):
            name = (source.name or '').lower()
            if not name:
                continue
            if name in bindings.cte_aliases:
                alias = (source.alias or source.name or '').lower()
                if alias:
                    bindings.cte_aliases.add(alias)
                continue
            alias = (source.alias or source.name or '').lower()
            bindings.catalog_aliases.setdefault(alias, name)
        elif isinstance(source, exp.Subquery):
            alias = (source.alias_or_name or '').lower()
            if alias:
                bindings.cte_aliases.add(alias)

    for e in select_node.expressions:
        if isinstance(e, exp.Alias) and e.alias:
            bindings.projection_aliases.add(e.alias.lower())

    return bindings


def visible_projection_names(root: exp.Expression) -> frozenset[str]:
    """Explicit-alias projection names from any Select in the AST; bare columns excluded so bogus outer projections cannot seed their own acceptance."""
    names: set[str] = set()
    for sel in root.find_all(exp.Select):
        for e in sel.expressions:
            if isinstance(e, exp.Alias) and e.alias:
                names.add(e.alias.lower())
    return frozenset(names)


def _ctes_in_scope(select_node: exp.Select) -> list[str]:
    names: list[str] = []
    node: exp.Expression | None = select_node
    while node is not None:
        with_arg = node.args.get('with') if hasattr(node, 'args') else None
        if isinstance(with_arg, exp.With):
            for cte in with_arg.expressions or []:
                if isinstance(cte, exp.CTE):
                    names.append(cte.alias_or_name)
        node = node.parent
    return names


__all__ = [
    'ScopeBindings',
    'compute_scope_bindings',
    'visible_projection_names',
]
