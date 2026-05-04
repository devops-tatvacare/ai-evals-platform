"""Phase 11 — typed predicate AST shared by qualification, routing, and event-match nodes.

Used by:
  - ``filter.eligibility``      — pass / skip
  - ``logic.conditional``       — true / false
  - ``logic.wait`` ``event_match`` — match inbound event payloads on resume

Wire-shape (recursive, JSON-serializable). All four forms are dicts so that
existing definitions parse with no migration:

  Leaf:      {"field": "...", "op": "...", "value": ...}
  Conjunction: {"and": [predicate, ...]}
  Disjunction: {"or":  [predicate, ...]}
  Negation:    {"not": predicate}

Supported leaf ops:
  eq, neq, gte, gt, lte, lt, in, not_in, contains, exists, missing

Missing fields evaluate to False for every leaf op except ``missing`` (true)
and ``exists`` (false). Malformed operator/value shapes still raise
``PredicateError`` so publish-time validation and runtime execution fail
explicitly when a predicate drifts out of contract.

This module replaces ``nodes/_predicate.py``'s ad-hoc evaluator with:
  - a typed ``Predicate`` AST (Pydantic discriminated union),
  - a pure ``evaluate()`` function,
  - a ``parse()`` helper for constructing a typed AST from raw JSON,
  - a ``required_fields()`` walker used by the descriptor and validator
    to surface the predicate's payload-field dependencies in the inspector.

The legacy ``evaluate_predicate(dict, payload)`` API in
``nodes/_predicate.py`` continues to delegate here so handlers can switch to
the typed AST opportunistically.
"""
from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator


class PredicateError(ValueError):
    pass


LeafOp = Literal[
    "eq", "neq", "gte", "gt", "lte", "lt", "in", "not_in", "contains", "exists", "missing",
]
_LEAF_OPS: set[str] = {"eq", "neq", "gte", "gt", "lte", "lt", "in", "not_in", "contains", "exists", "missing"}


class LeafPredicate(BaseModel):
    field: str
    op: LeafOp
    value: Any = None

    @field_validator("field")
    @classmethod
    def _non_empty_field(cls, v: str) -> str:
        if not v:
            raise PredicateError("leaf predicate 'field' must be a non-empty string")
        return v

    @model_validator(mode="after")
    def _validate_value_shape(self) -> "LeafPredicate":
        if self.op in {"exists", "missing"}:
            if self.value is not None:
                raise PredicateError(f"{self.op!r} does not accept a value")
            return self
        if self.op in {"in", "not_in"}:
            if not isinstance(self.value, list) or len(self.value) == 0:
                raise PredicateError(f"{self.op!r} requires a non-empty list value")
            return self
        if self.op == "contains" and not isinstance(self.value, str):
            raise PredicateError("'contains' requires a string value")
        if self.value is None:
            raise PredicateError(f"{self.op!r} requires a value")
        return self


class AndPredicate(BaseModel):
    and_: list["Predicate"] = Field(alias="and", min_length=1)

    model_config = {"populate_by_name": True}


class OrPredicate(BaseModel):
    or_: list["Predicate"] = Field(alias="or", min_length=1)

    model_config = {"populate_by_name": True}


class NotPredicate(BaseModel):
    not_: "Predicate" = Field(alias="not")

    model_config = {"populate_by_name": True}


Predicate = Union[LeafPredicate, AndPredicate, OrPredicate, NotPredicate]

# Resolve forward refs.
AndPredicate.model_rebuild()
OrPredicate.model_rebuild()
NotPredicate.model_rebuild()


def parse(raw: Any) -> Predicate:
    """Parse a JSON predicate dict into the typed AST.

    Raises PredicateError on malformed input — the message names the offending
    branch so authoring tools can surface a clear error.
    """
    if not isinstance(raw, dict):
        raise PredicateError(f"predicate must be dict, got {type(raw).__name__}")

    if "and" in raw:
        clauses = raw["and"]
        if not isinstance(clauses, list) or not clauses:
            raise PredicateError("'and' requires non-empty list of clauses")
        return AndPredicate(**{"and": [parse(c) for c in clauses]})
    if "or" in raw:
        clauses = raw["or"]
        if not isinstance(clauses, list) or not clauses:
            raise PredicateError("'or' requires non-empty list of clauses")
        return OrPredicate(**{"or": [parse(c) for c in clauses]})
    if "not" in raw:
        return NotPredicate(**{"not": parse(raw["not"])})

    # Leaf
    op = raw.get("op")
    field = raw.get("field")
    if op is None or field is None:
        raise PredicateError(f"leaf predicate must have 'field' and 'op': {raw!r}")
    if op not in _LEAF_OPS:
        raise PredicateError(f"unsupported op: {op!r}")
    try:
        return LeafPredicate(field=field, op=op, value=raw.get("value"))
    except ValidationError as exc:
        messages = "; ".join(
            error.get("msg", "invalid predicate")
            for error in exc.errors()
        )
        raise PredicateError(messages) from exc


def evaluate(predicate: Any, payload: dict[str, Any]) -> bool:
    """Evaluate a predicate (raw JSON or typed AST) against a recipient payload."""
    if isinstance(predicate, (LeafPredicate, AndPredicate, OrPredicate, NotPredicate)):
        return _evaluate_typed(predicate, payload)
    return _evaluate_typed(parse(predicate), payload)


def _evaluate_typed(node: Predicate, payload: dict[str, Any]) -> bool:
    if isinstance(node, AndPredicate):
        return all(_evaluate_typed(c, payload) for c in node.and_)
    if isinstance(node, OrPredicate):
        return any(_evaluate_typed(c, payload) for c in node.or_)
    if isinstance(node, NotPredicate):
        return not _evaluate_typed(node.not_, payload)
    return _evaluate_leaf(node, payload)


def _evaluate_leaf(leaf: LeafPredicate, payload: dict[str, Any]) -> bool:
    actual = payload.get(leaf.field)

    if leaf.op == "exists":
        return actual is not None
    if leaf.op == "missing":
        return actual is None
    if actual is None:
        return False

    op = leaf.op
    value = leaf.value
    if op == "eq":
        return actual == value
    if op == "neq":
        return actual != value
    if op == "gte":
        try:
            return actual >= value
        except TypeError as exc:
            raise PredicateError(
                f"'gte' incompatible for field {leaf.field!r}: "
                f"{type(actual).__name__} vs {type(value).__name__}"
            ) from exc
    if op == "gt":
        try:
            return actual > value
        except TypeError as exc:
            raise PredicateError(
                f"'gt' incompatible for field {leaf.field!r}: "
                f"{type(actual).__name__} vs {type(value).__name__}"
            ) from exc
    if op == "lte":
        try:
            return actual <= value
        except TypeError as exc:
            raise PredicateError(
                f"'lte' incompatible for field {leaf.field!r}: "
                f"{type(actual).__name__} vs {type(value).__name__}"
            ) from exc
    if op == "lt":
        try:
            return actual < value
        except TypeError as exc:
            raise PredicateError(
                f"'lt' incompatible for field {leaf.field!r}: "
                f"{type(actual).__name__} vs {type(value).__name__}"
            ) from exc
    if op == "in":
        return actual in value
    if op == "not_in":
        return actual not in value
    if op == "contains":
        if not isinstance(actual, str):
            raise PredicateError(
                f"'contains' requires string payload field {leaf.field!r}, "
                f"got {type(actual).__name__}"
            )
        return value in actual
    raise PredicateError(f"unhandled op: {op!r}")  # unreachable


def required_fields(predicate: Any) -> list[str]:
    """Walk a predicate AST and return the sorted set of payload field references.

    Used to populate ``required_payload_fields`` for predicate-driven nodes
    when the descriptor surfaces them in the builder inspector.
    """
    if isinstance(predicate, (LeafPredicate, AndPredicate, OrPredicate, NotPredicate)):
        typed: Predicate = predicate
    else:
        typed = parse(predicate)
    out: set[str] = set()
    _collect_fields(typed, out)
    return sorted(out)


def _collect_fields(node: Predicate, out: set[str]) -> None:
    if isinstance(node, AndPredicate):
        for c in node.and_:
            _collect_fields(c, out)
        return
    if isinstance(node, OrPredicate):
        for c in node.or_:
            _collect_fields(c, out)
        return
    if isinstance(node, NotPredicate):
        _collect_fields(node.not_, out)
        return
    out.add(node.field)


__all__ = [
    "PredicateError",
    "LeafOp",
    "LeafPredicate",
    "AndPredicate",
    "OrPredicate",
    "NotPredicate",
    "Predicate",
    "parse",
    "evaluate",
    "required_fields",
]
