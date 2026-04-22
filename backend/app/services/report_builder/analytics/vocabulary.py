"""Canonical tool vocabulary for Sherlock.

One place that assembles, from the three owners declared in
docs/plans/2026-04-21-sherlock-contract-hardening-phase-1.md:

- Semantic model (analytics dimensions/metrics)
- App manifest (catalog tables/columns, data surfaces, entity types, per-column synonyms)
- Section catalog (blueprint block types)

…the allowed values that tool handlers must validate against, and the alias
resolution layer that turns user-facing terms (``verdict``, ``rule``,
``criterion``) into canonical identifiers (``result_status``,
``criterion_label``).

The ambiguity policy is explicit: ``resolve_*`` returns one of three states
(``unique`` / ``ambiguous`` / ``unknown``). Handlers must reject ambiguous
and unknown terms with structured errors rather than silently picking one.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from app.services.chat_engine.manifest import AppManifest, ManifestColumn, get_manifest
from app.services.chat_engine.sql_agent import _normalize_dimensions
from app.services.report_builder.section_catalog import SECTION_CATALOG


# ── Specs ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DimensionSpec:
    name: str
    table: str
    expression: str
    description: str = ""


@dataclass(frozen=True)
class SurfaceSpec:
    key: str
    backed_by: str
    entity_types: tuple[str, ...]


@dataclass(frozen=True)
class BlockTypeSpec:
    key: str
    label: str


@dataclass(frozen=True)
class ColumnTarget:
    """One possible canonical (table, column) target for an alias."""
    table: str
    column: str
    role: str
    semantic_type: str | None = None


# ── Alias resolution ─────────────────────────────────────────────────

ResolutionStatus = Literal['unique', 'ambiguous', 'unknown']


@dataclass(frozen=True)
class DimensionResolution:
    status: ResolutionStatus
    term: str
    canonical: DimensionSpec | None = None
    candidates: tuple[DimensionSpec, ...] = ()


@dataclass(frozen=True)
class ColumnResolution:
    status: ResolutionStatus
    term: str
    canonical: ColumnTarget | None = None
    candidates: tuple[ColumnTarget, ...] = ()


def _normalize_alias(term: str) -> str:
    """Case/whitespace-normalize a user-facing term for alias lookup."""
    return '_'.join(term.strip().lower().split())


# ── Vocabulary ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class ToolVocabulary:
    app_id: str
    dimensions: Mapping[str, DimensionSpec]
    surfaces: Mapping[str, SurfaceSpec]
    block_types: Mapping[str, BlockTypeSpec]
    entity_types: frozenset[str]

    # Internal indices. Terms are always normalized via _normalize_alias.
    dimension_alias_index: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    column_alias_index: Mapping[str, tuple[ColumnTarget, ...]] = field(default_factory=dict)
    # ORM class name -> manifest catalog-table name, for reverse lookup from
    # catalog tool handlers that hold an ORM class but need manifest semantics.
    orm_to_table: Mapping[str, str] = field(default_factory=dict)

    # -- Dimension alias resolution -----------------------------------

    def resolve_dimension(self, term: str) -> DimensionResolution:
        if not term or not term.strip():
            return DimensionResolution(status='unknown', term=term)

        # Canonical-name match always wins over aliases.
        canonical = self.dimensions.get(term.strip().lower())
        if canonical is not None:
            return DimensionResolution(status='unique', term=term, canonical=canonical)

        hits = self.dimension_alias_index.get(_normalize_alias(term), ())
        if not hits:
            return DimensionResolution(status='unknown', term=term)
        if len(hits) == 1:
            return DimensionResolution(status='unique', term=term, canonical=self.dimensions[hits[0]])
        return DimensionResolution(
            status='ambiguous',
            term=term,
            candidates=tuple(self.dimensions[name] for name in hits),
        )

    # -- Column alias resolution --------------------------------------

    def resolve_column(
        self,
        term: str,
        *,
        preferred_table: str | None = None,
    ) -> ColumnResolution:
        """Resolve a column name or synonym to a canonical ``(table, column)``.

        ``preferred_table`` narrows an otherwise-ambiguous match to the
        given table if possible. An ambiguous match that cannot be narrowed
        stays ambiguous — the caller must return a disambiguation error.
        """
        if not term or not term.strip():
            return ColumnResolution(status='unknown', term=term)

        # Canonical (table.column or bare column) match first.
        stripped = term.strip()
        if '.' in stripped:
            table, column = stripped.split('.', 1)
            targets = self.column_alias_index.get(_normalize_alias(column), ())
            scoped = tuple(t for t in targets if t.table == table and t.column == column)
            if scoped:
                return ColumnResolution(status='unique', term=term, canonical=scoped[0])

        targets = self.column_alias_index.get(_normalize_alias(stripped), ())
        if not targets:
            return ColumnResolution(status='unknown', term=term)

        if preferred_table is not None:
            scoped = tuple(t for t in targets if t.table == preferred_table)
            if len(scoped) == 1:
                return ColumnResolution(status='unique', term=term, canonical=scoped[0])
            if len(scoped) > 1:
                return ColumnResolution(status='ambiguous', term=term, candidates=scoped)
            # Fall through to the unscoped candidates to report ambiguity.

        if len(targets) == 1:
            return ColumnResolution(status='unique', term=term, canonical=targets[0])
        return ColumnResolution(status='ambiguous', term=term, candidates=targets)

    # -- Entity-type validation ---------------------------------------

    def validate_entity_type(self, entity_type: str) -> bool:
        return entity_type in self.entity_types

    def surface_accepts_entity_type(self, surface_key: str, entity_type: str) -> bool:
        surface = self.surfaces.get(surface_key)
        if surface is None:
            return False
        return entity_type in surface.entity_types


# ── Builder ──────────────────────────────────────────────────────────


def build_tool_vocabulary(
    app_id: str,
    semantic_model: dict[str, Any],
    *,
    manifest: AppManifest | None = None,
) -> ToolVocabulary:
    """Assemble the canonical vocabulary for one app.

    Reads the manifest (catalog tables, surfaces, per-column synonyms), the
    semantic model (analytics dimensions), and the global section catalog
    (blueprint block types). Fails loudly if the manifest does not exist.
    """
    if manifest is None:
        manifest = get_manifest(app_id)

    # Dimensions from the semantic model.
    dimensions: dict[str, DimensionSpec] = {}
    for dim in _normalize_dimensions(semantic_model):
        name = str(dim['name'])
        dimensions[name.lower()] = DimensionSpec(
            name=name,
            table=str(dim['table']),
            expression=str(dim['expression']),
            description=str(dim.get('description') or ''),
        )

    # Surfaces + entity types.
    surfaces: dict[str, SurfaceSpec] = {}
    surface_entity_types: set[str] = set()
    for surface in manifest.data_surfaces:
        surfaces[surface.key] = SurfaceSpec(
            key=surface.key,
            backed_by=surface.backed_by,
            entity_types=tuple(surface.entity_types),
        )
        surface_entity_types.update(surface.entity_types)

    # Block types from the section catalog (global, not per-app).
    block_types: dict[str, BlockTypeSpec] = {
        entry.key: BlockTypeSpec(key=entry.key, label=entry.label)
        for entry in SECTION_CATALOG
    }

    # Entity-type universe = manifest-surface entity types ∪ semantic dimension names.
    # Both are legitimate targets for resolve_entity — a surface may carry its
    # own resolver, and any semantic dimension is resolvable as a fallback.
    entity_types = frozenset(surface_entity_types | set(dimensions.keys()))

    # ── Alias indices ────────────────────────────────────────────────
    # Every per-column synonym in the manifest becomes:
    #   1. A column-alias entry pointing at (table, column).
    #   2. A dimension-alias entry *iff* a semantic dimension exists whose
    #      (table, expression) matches this column — i.e. the column is
    #      exposed as a dimension.
    dimension_alias_index: dict[str, list[str]] = {}
    column_alias_index: dict[str, list[ColumnTarget]] = {}

    # (table, expression) → canonical dimension name, for reverse lookup.
    dimension_by_column: dict[tuple[str, str], str] = {}
    for dim in dimensions.values():
        dimension_by_column[(dim.table, dim.expression)] = dim.name.lower()

    orm_to_table: dict[str, str] = {}

    for table_name, table in manifest.catalog_tables.items():
        if table.orm:
            orm_to_table[table.orm] = table_name
        for column_name, column in table.columns.items():
            target = ColumnTarget(
                table=table_name,
                column=column_name,
                role=column.role,
                semantic_type=column.semantic_type,
            )
            # Canonical column name also indexes itself — enables lookup by
            # "criterion_label" without having to know every synonym.
            column_alias_index.setdefault(_normalize_alias(column_name), []).append(target)
            for synonym in _synonyms_for(column):
                column_alias_index.setdefault(_normalize_alias(synonym), []).append(target)

            dim_name = dimension_by_column.get((table_name, column_name))
            if dim_name is not None:
                # The canonical dimension name is already resolvable via
                # ToolVocabulary.resolve_dimension()'s canonical-first branch,
                # so only index explicit synonyms here.
                for synonym in _synonyms_for(column):
                    dimension_alias_index.setdefault(_normalize_alias(synonym), []).append(dim_name)

    return ToolVocabulary(
        app_id=app_id,
        dimensions=dimensions,
        surfaces=surfaces,
        block_types=block_types,
        entity_types=entity_types,
        dimension_alias_index={
            term: tuple(dict.fromkeys(names))  # dedupe, preserve order
            for term, names in dimension_alias_index.items()
        },
        column_alias_index={
            term: tuple(_dedupe_targets(targets))
            for term, targets in column_alias_index.items()
        },
        orm_to_table=orm_to_table,
    )


def _synonyms_for(column: ManifestColumn) -> list[str]:
    return [str(s) for s in column.synonyms if isinstance(s, str) and s.strip()]


def _dedupe_targets(targets: list[ColumnTarget]) -> list[ColumnTarget]:
    seen: set[tuple[str, str]] = set()
    out: list[ColumnTarget] = []
    for target in targets:
        key = (target.table, target.column)
        if key in seen:
            continue
        seen.add(key)
        out.append(target)
    return out


# ── Error-payload helpers ─────────────────────────────────────────────
# Handlers use these to return uniform structured errors for vocabulary
# violations. Centralizing the shape keeps "fail loudly" consistent across
# the tool surface.


def dimension_error_payload(
    resolution: DimensionResolution,
    vocab: ToolVocabulary,
) -> dict[str, Any]:
    if resolution.status == 'ambiguous':
        return {
            'status': 'error',
            'error': (
                f"Ambiguous dimension {resolution.term!r}: maps to multiple "
                f"canonical dimensions. Pick one of "
                f"{[c.name for c in resolution.candidates]!r} and call lookup again."
            ),
            'reason': 'ambiguous_dimension',
            'term': resolution.term,
            'candidates': [c.name for c in resolution.candidates],
        }
    return {
        'status': 'error',
        'error': f'Unknown dimension: {resolution.term}',
        'reason': 'unknown_dimension',
        'term': resolution.term,
        'available_dimensions': sorted(vocab.dimensions.keys()),
    }


def column_error_payload(
    resolution: ColumnResolution,
    *,
    preferred_table: str | None = None,
) -> dict[str, Any]:
    if resolution.status == 'ambiguous':
        return {
            'status': 'error',
            'error': (
                f"Ambiguous column {resolution.term!r}: maps to multiple "
                f"canonical columns. Pick one of "
                f"{[f'{c.table}.{c.column}' for c in resolution.candidates]!r} "
                f"(or pass a specific ``table`` argument)."
            ),
            'reason': 'ambiguous_column',
            'term': resolution.term,
            'candidates': [
                {'table': c.table, 'column': c.column} for c in resolution.candidates
            ],
        }
    scoped = f' in table {preferred_table!r}' if preferred_table else ''
    return {
        'status': 'error',
        'error': f'Unknown column {resolution.term!r}{scoped}.',
        'reason': 'unknown_column',
        'term': resolution.term,
        'preferred_table': preferred_table,
    }


def entity_type_error_payload(
    entity_type: str,
    vocab: ToolVocabulary,
    *,
    surface_key: str | None = None,
) -> dict[str, Any]:
    if surface_key is not None:
        surface = vocab.surfaces.get(surface_key)
        available = sorted(surface.entity_types) if surface else []
        return {
            'status': 'error',
            'error': (
                f"Surface {surface_key!r} does not accept entity_type "
                f"{entity_type!r}. Allowed entity types for this surface: "
                f"{available!r}."
            ),
            'reason': 'invalid_entity_type_for_surface',
            'surface_key': surface_key,
            'entity_type': entity_type,
            'allowed_entity_types': available,
        }
    return {
        'status': 'error',
        'error': (
            f"Unknown entity_type {entity_type!r}. Allowed: "
            f"{sorted(vocab.entity_types)!r}."
        ),
        'reason': 'unknown_entity_type',
        'entity_type': entity_type,
        'allowed_entity_types': sorted(vocab.entity_types),
    }
