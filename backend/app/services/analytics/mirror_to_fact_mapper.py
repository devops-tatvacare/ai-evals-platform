"""Declarative mirror -> fact projection (Phase 2).

Loads one YAML per ``(app_id, source_table, target_fact, activity_type)``
from ``mirror_to_fact_mappings/``. Steady-state sync (Phase 3) and backfill
(Phase 4) both call ``MirrorToFactMapper.for_table(...)`` and use the
returned ``MirrorToFactMapping`` to project mirror rows into fact rows.

Phase 2 ships the module, the first mapping (``crm_call_record__call``),
and the ``analytics.mapping_state`` table that backs per-mapping
operator-disable. Sync is **not** wired here — that's Phase 3.

Expression grammar (Phase 2, no escape hatch):
  * ``<column>``       -> read the named key from the mirror row
  * ``'<literal>'``    -> single-quoted string literal
  * ``null``           -> literal None
Anything else raises ``MappingDefinitionError`` at load time.

See ADR ``2026-05-12-mirror-to-fact-declarative-mapping`` and
``2026-05-12-attributes-jsonb-schema-contract`` in the obsidian vault.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

_MAPPINGS_DIR = Path(__file__).resolve().parent / "mirror_to_fact_mappings"

_COLUMN_REF_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_LITERAL_RE = re.compile(r"^'([^']*)'$")


class MappingDefinitionError(ValueError):
    """Raised when a mapping YAML is malformed or duplicates another mapping."""


class MappingProjectionError(ValueError):
    """Raised by ``MirrorToFactMapping.project`` when a required field is missing."""


@dataclass(frozen=True)
class _ColumnRef:
    column: str


@dataclass(frozen=True)
class _Literal:
    value: Any


_NULL = _Literal(value=None)


_SENTINEL = object()


@dataclass(frozen=True)
class _RowAccessor:
    """Uniform read interface over Mapping rows and ORM model instances.

    Sync writes ``CrmCallRecord`` ORM rows; backfill walks the mirror via
    Core ``Row._mapping`` dicts; tests pass plain dicts. All three need to
    look the same to the mapper.
    """

    row: Any
    _is_mapping: bool

    def get(self, column: str, *, where: str) -> Any:
        value = self._get_raw(column)
        if value is _SENTINEL:
            raise MappingProjectionError(
                f"{where}: mirror row missing column {column!r}"
            )
        return value

    def get_or_none(self, column: str) -> Any:
        value = self._get_raw(column)
        return None if value is _SENTINEL else value

    def _get_raw(self, column: str) -> Any:
        if self._is_mapping:
            if column in self.row:
                return self.row[column]
            return _SENTINEL
        # ORM model instance: ``hasattr`` triggers ``__getattr__`` side
        # effects on some classes, so we look the column up in
        # ``__class__`` first (mapped columns live there as descriptors)
        # and only then fall back to ``getattr`` for hybrid properties /
        # synonyms.
        if hasattr(type(self.row), column) or hasattr(self.row, column):
            return getattr(self.row, column)
        return _SENTINEL


def _row_accessor(row: Any) -> _RowAccessor:
    if isinstance(row, Mapping):
        return _RowAccessor(row=row, _is_mapping=True)
    return _RowAccessor(row=row, _is_mapping=False)


def _parse_expression(expr: Any, *, where: str) -> _ColumnRef | _Literal:
    """Parse a mapping expression into a column ref or a literal."""
    if expr is None:
        return _NULL
    if not isinstance(expr, str):
        raise MappingDefinitionError(
            f"{where}: expected string expression, got {type(expr).__name__}"
        )
    stripped = expr.strip()
    if stripped.lower() == "null":
        return _NULL
    literal_match = _LITERAL_RE.match(stripped)
    if literal_match is not None:
        return _Literal(value=literal_match.group(1))
    if _COLUMN_REF_RE.match(stripped):
        return _ColumnRef(column=stripped)
    raise MappingDefinitionError(
        f"{where}: unsupported expression {expr!r}; expected a column reference, "
        "'literal' string, or null"
    )


@dataclass(frozen=True)
class MirrorToFactMapping:
    """One declarative projection from a mirror row to a fact row dict.

    Loaded from YAML. ``.enabled(session)`` reads operator state from
    ``analytics.mapping_state``. ``.project(mirror_row, sync_run_id=...)``
    returns a dict whose keys are fact column names. The dict's
    ``attributes`` key carries the per-(table, activity_type) JSONB
    payload; the manifest's ``attribute_schemas`` enforces declared-vs-
    written parity (Phase 7, validator already callable in Phase 2).
    """

    app_id: str
    source_table: str
    target_fact: str
    activity_type: str
    activity_subtype_from: str | None
    _structural: Mapping[str, _ColumnRef | _Literal]
    _attributes: Mapping[str, _ColumnRef | _Literal]
    required_attributes: tuple[str, ...]
    source_path: Path

    @property
    def key(self) -> tuple[str, str, str, str]:
        return (self.app_id, self.source_table, self.target_fact, self.activity_type)

    @property
    def attribute_keys(self) -> tuple[str, ...]:
        return tuple(self._attributes.keys())

    def project(
        self, mirror_row: Any, *, sync_run_id: Any
    ) -> dict[str, Any]:
        """Project one mirror row into a fact row dict.

        ``mirror_row`` may be a ``Mapping`` (dict / SQLAlchemy ``RowMapping``)
        or an ORM model instance — sync writes ORM rows and the existing
        ``_build_call_activity_fact_row`` uses attribute access, so the
        Phase 3 wire-in shouldn't have to copy fields into a dict first.

        Caller is responsible for supplying ``tenant_id`` and ``app_id``;
        those live on the mirror row and aren't part of the declarative
        mapping.
        """
        accessor = _row_accessor(mirror_row)

        fact: dict[str, Any] = {}
        for fact_col, expr in self._structural.items():
            fact[fact_col] = self._resolve(expr, accessor, where=f"structural.{fact_col}")

        attributes: dict[str, Any] = {}
        for attr_key, expr in self._attributes.items():
            attributes[attr_key] = self._resolve(
                expr, accessor, where=f"attributes.{attr_key}"
            )

        source_activity_id = accessor.get_or_none("activity_id")
        for required in self.required_attributes:
            if attributes.get(required) in (None, ""):
                raise MappingProjectionError(
                    f"mapping {self.key}: required attribute {required!r} is missing "
                    f"or empty on mirror row (source_activity_id="
                    f"{source_activity_id!r})"
                )

        fact["attributes"] = attributes
        fact["activity_type"] = self.activity_type
        if self.activity_subtype_from is not None:
            # Read via the strict accessor so a typo in ``activity_subtype_from``
            # raises instead of silently writing NULL — exactly the silent-drop
            # class this plan exists to eliminate (see ADR
            # ``2026-05-12-mirror-to-fact-declarative-mapping``).
            fact["activity_subtype"] = accessor.get(
                self.activity_subtype_from,
                where=f"activity_subtype_from={self.activity_subtype_from!r}",
            )
        fact["sync_run_id"] = sync_run_id
        return fact

    async def enabled(self, session: AsyncSession) -> bool:
        """Read operator-controlled enabled state from ``analytics.mapping_state``.

        Returns ``True`` by default (when no row is present) so a freshly-
        seeded mapping isn't accidentally disabled. The seed migration
        writes an explicit ``enabled=true`` row per mapping, so this
        fallback is defensive.
        """
        # Local import to avoid circulars: the ORM module imports from
        # ``app.models.base`` which transitively pulls in services.
        from app.models.analytics_mapping_state import MappingState

        result = await session.execute(
            select(MappingState.enabled).where(
                MappingState.app_id == self.app_id,
                MappingState.source_table == self.source_table,
                MappingState.target_fact == self.target_fact,
                MappingState.activity_type == self.activity_type,
            )
        )
        row = result.scalar_one_or_none()
        return True if row is None else bool(row)

    @staticmethod
    def _resolve(
        expr: _ColumnRef | _Literal,
        accessor: _RowAccessor,
        *,
        where: str,
    ) -> Any:
        if isinstance(expr, _Literal):
            return expr.value
        return accessor.get(expr.column, where=where)


def _load_mapping_file(path: Path) -> MirrorToFactMapping:
    raw = yaml.safe_load(path.read_text()) or {}
    if not isinstance(raw, dict):
        raise MappingDefinitionError(f"{path}: top-level YAML must be a mapping")

    for key in ("app_id", "source_table", "target_fact", "activity_type"):
        if not raw.get(key):
            raise MappingDefinitionError(f"{path}: missing required field {key!r}")

    structural_raw = raw.get("structural_mapping") or {}
    attributes_raw = raw.get("attributes_mapping") or {}
    if not isinstance(structural_raw, dict):
        raise MappingDefinitionError(f"{path}: structural_mapping must be a mapping")
    if not isinstance(attributes_raw, dict):
        raise MappingDefinitionError(f"{path}: attributes_mapping must be a mapping")

    structural = {
        col: _parse_expression(expr, where=f"{path}:structural_mapping.{col}")
        for col, expr in structural_raw.items()
    }
    attributes = {
        key: _parse_expression(expr, where=f"{path}:attributes_mapping.{key}")
        for key, expr in attributes_raw.items()
    }

    required_attrs_raw = raw.get("required_attributes") or []
    if not isinstance(required_attrs_raw, list):
        raise MappingDefinitionError(
            f"{path}: required_attributes must be a list"
        )
    missing_required = [k for k in required_attrs_raw if k not in attributes]
    if missing_required:
        raise MappingDefinitionError(
            f"{path}: required_attributes references undeclared keys: "
            f"{missing_required}"
        )

    return MirrorToFactMapping(
        app_id=raw["app_id"],
        source_table=raw["source_table"],
        target_fact=raw["target_fact"],
        activity_type=raw["activity_type"],
        activity_subtype_from=raw.get("activity_subtype_from"),
        _structural=structural,
        _attributes=attributes,
        required_attributes=tuple(required_attrs_raw),
        source_path=path,
    )


def load_mappings(directory: Path | None = None) -> list[MirrorToFactMapping]:
    """Load every ``*.yaml`` mapping file from ``directory`` (or the default).

    Raises ``MappingDefinitionError`` on malformed files or duplicate
    ``(app_id, source_table, target_fact, activity_type)`` registration.
    """
    directory = directory or _MAPPINGS_DIR
    mappings: dict[tuple[str, str, str, str], MirrorToFactMapping] = {}
    for path in sorted(directory.glob("*.yaml")):
        mapping = _load_mapping_file(path)
        if mapping.key in mappings:
            existing = mappings[mapping.key]
            raise MappingDefinitionError(
                f"duplicate mapping registration for {mapping.key!r}: "
                f"{existing.source_path} and {path}"
            )
        mappings[mapping.key] = mapping
    return list(mappings.values())


@dataclass(frozen=True)
class _Registry:
    by_lookup_key: Mapping[tuple[str, str, str], MirrorToFactMapping]
    all: tuple[MirrorToFactMapping, ...]


def _build_registry(
    directory: Path | None = None,
) -> _Registry:
    mappings = load_mappings(directory)
    # Lookup key is (app_id, source_table, activity_type). ``target_fact`` is
    # part of the dedup key but ``for_table`` doesn't take it — the registry
    # refuses two mappings that project the same source+activity_type into
    # different fact tables because the lookup API can't disambiguate.
    by_lookup: dict[tuple[str, str, str], MirrorToFactMapping] = {}
    for mapping in mappings:
        lookup = (mapping.app_id, mapping.source_table, mapping.activity_type)
        if lookup in by_lookup:
            other = by_lookup[lookup]
            raise MappingDefinitionError(
                f"two mappings project {lookup!r} into different fact tables "
                f"({other.target_fact} <- {other.source_path.name} vs "
                f"{mapping.target_fact} <- {mapping.source_path.name}); the "
                f"for_table(app_id, source_table, activity_type) API cannot "
                f"disambiguate"
            )
        by_lookup[lookup] = mapping
    return _Registry(by_lookup_key=by_lookup, all=tuple(mappings))


class MirrorToFactMapper:
    """Process-wide registry of mirror -> fact mappings.

    Construct once at boot (Phase 3 wiring) or via ``default()`` in tests.
    The registry is immutable after construction; reloading at runtime is
    out of scope for Phase 2.
    """

    _default: "MirrorToFactMapper | None" = None

    def __init__(self, directory: Path | None = None) -> None:
        self._registry = _build_registry(directory)

    @classmethod
    def default(cls) -> "MirrorToFactMapper":
        if cls._default is None:
            cls._default = cls()
        return cls._default

    @classmethod
    def reset_default(cls) -> None:
        """Test hook: drop the cached default registry."""
        cls._default = None

    def for_table(
        self, app_id: str, source_table: str, activity_type: str
    ) -> MirrorToFactMapping:
        """Look up the mapping for ``(app_id, source_table, activity_type)``.

        Raises ``KeyError`` if no mapping is registered.
        """
        key = (app_id, source_table, activity_type)
        try:
            return self._registry.by_lookup_key[key]
        except KeyError as exc:
            raise KeyError(
                f"no mirror->fact mapping registered for {key!r}"
            ) from exc

    @property
    def all_mappings(self) -> tuple[MirrorToFactMapping, ...]:
        return self._registry.all


# ── manifest cross-check (callable validator; Phase 7 wires it into boot) ─


def validate_against_manifest(
    mapping: MirrorToFactMapping,
    attribute_schemas: Mapping[str, Mapping[str, Any]] | None,
) -> list[str]:
    """Return a list of error strings; empty list means the cross-check passes.

    ``attribute_schemas`` is the per-``activity_type`` schema block declared
    on the target fact's manifest entry (Phase 7 introduces it on the
    Pydantic model + YAML; in Phase 2 it doesn't exist on production
    manifests yet, so this function is callable but not boot-wired).

    Errors:
      * mapping writes an attributes key that's not declared in the schema
        for the mapping's ``activity_type``;
      * mapping declares a ``required_attributes`` key that the schema
        doesn't carry (otherwise the manifest and the mapping disagree on
        what's mandatory).
    """
    errors: list[str] = []
    if not attribute_schemas:
        errors.append(
            f"manifest does not declare attribute_schemas for target "
            f"{mapping.target_fact!r}"
        )
        return errors

    type_schema = attribute_schemas.get(mapping.activity_type)
    if type_schema is None:
        errors.append(
            f"manifest attribute_schemas has no entry for activity_type "
            f"{mapping.activity_type!r}"
        )
        return errors

    declared_keys = set(type_schema.keys())
    for written_key in mapping.attribute_keys:
        if written_key not in declared_keys:
            errors.append(
                f"mapping writes attributes key {written_key!r} but the "
                f"manifest schema for activity_type {mapping.activity_type!r} "
                f"does not declare it"
            )
    for required_key in mapping.required_attributes:
        if required_key not in declared_keys:
            errors.append(
                f"required attribute {required_key!r} is not declared in the "
                f"manifest schema for activity_type {mapping.activity_type!r}"
            )
    return errors


__all__ = [
    "MappingDefinitionError",
    "MappingProjectionError",
    "MirrorToFactMapping",
    "MirrorToFactMapper",
    "load_mappings",
    "validate_against_manifest",
]
