"""Platform-owned ontology reader (plan §4, §5.1).

Phase 1 (M1) scope:
- fixed list of 7 ontology classes (the platform backbone);
- DB-backed reader over ``sherlock_ontology_classes /
  sherlock_ontology_entity_types / sherlock_entity_resolvers``;
- scope filter (``tenant_id``, ``app_id``) so the bundle layer gets only
  rows that apply to this request;
- ``ontology_version()`` helper that returns the max platform-baseline
  version across classes — participates in the bundle cache key.

No writes here; the migration/seed path lives in
``app.services.seed_defaults.seed_sherlock_ontology``.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sherlock_ontology import (
    SherlockOntologyEntityType,
    SherlockOntologyClass,
    SherlockEntityResolver,
)
from app.services.sherlock.bundle_types import (
    EntityTypeRecord,
    OntologyClassRecord,
    ResolverRecord,
)


# ---------------------------------------------------------------------------
# Platform backbone (plan §4.1, §5.1)
# ---------------------------------------------------------------------------
#
# The seeder reads this list verbatim — edit here, re-seed, bump the
# platform ontology version. Kept as a module-level constant so both the
# seed path and tests can import the canonical set.


PLATFORM_ONTOLOGY_CLASSES: tuple[dict[str, Any], ...] = (
    {
        'name': 'scope',
        'parent': None,
        'description': 'Tenant / user / app / capability scope under which a turn runs.',
    },
    {
        'name': 'subject',
        'parent': None,
        'description': 'A domain subject — patient, agent, customer, evaluator.',
    },
    {
        'name': 'interaction',
        'parent': None,
        'description': 'A recorded interaction — call, chat thread, adversarial session.',
    },
    {
        'name': 'evaluation',
        'parent': None,
        'description': 'An evaluation act or its result.',
    },
    {
        'name': 'evaluation.run',
        'parent': 'evaluation',
        'description': 'One batch / thread / adversarial evaluation run.',
    },
    {
        'name': 'evaluation.judgment',
        'parent': 'evaluation',
        'description': 'A per-item verdict produced inside a run.',
    },
    {
        'name': 'artifact',
        'parent': None,
        'description': 'A produced asset — chart, report, note, dashboard.',
    },
    {
        'name': 'artifact.chart',
        'parent': 'artifact',
        'description': 'A Vega-Lite / Recharts chart artifact.',
    },
    {
        'name': 'operation',
        'parent': None,
        'description': 'Platform-wide operational concept — job, schedule, permission.',
    },
    {
        'name': 'extension',
        'parent': None,
        'description': 'Tenant / pack extension point — reserved for overlays.',
    },
)


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------


def _row_to_class(row: SherlockOntologyClass, parent_name: str | None) -> OntologyClassRecord:
    return OntologyClassRecord(
        id=row.id,
        name=row.name,
        parent_name=parent_name,
        description=row.description,
        version=row.version,
    )


def _row_to_entity(row: SherlockOntologyEntityType, class_name: str) -> EntityTypeRecord:
    examples = tuple(row.examples or [])
    return EntityTypeRecord(
        id=row.id,
        tenant_id=row.tenant_id,
        app_id=row.app_id,
        name=row.name,
        ontology_class_name=class_name,
        role=row.role,
        safety=row.safety,
        description=row.description,
        examples=examples,
    )


def _row_to_resolver(row: SherlockEntityResolver) -> ResolverRecord:
    return ResolverRecord(
        id=row.id,
        tenant_id=row.tenant_id,
        app_id=row.app_id,
        key=row.key,
        entity_type=row.entity_type,
        description=row.description,
        source=row.source,
        config=dict(row.config or {}),
        safety=row.safety,
    )


@dataclass(frozen=True)
class _ScopedOntologyView:
    """Return shape for :meth:`PlatformOntology.scoped`."""

    classes: tuple[OntologyClassRecord, ...]
    entity_types: tuple[EntityTypeRecord, ...]
    resolvers: tuple[ResolverRecord, ...]
    version: int


class PlatformOntology:
    """DB-backed reader for the platform ontology tables.

    Stateless over an injected AsyncSession; callers supply the session
    so tests can hand in their own. The live harness will use the
    request-bound session in M2.
    """

    def __init__(self, db: AsyncSession):
        self._db = db

    async def list_classes(self) -> tuple[OntologyClassRecord, ...]:
        rows = (
            await self._db.execute(select(SherlockOntologyClass).order_by(SherlockOntologyClass.name))
        ).scalars().all()
        by_id: dict[uuid.UUID, SherlockOntologyClass] = {row.id: row for row in rows}
        records: list[OntologyClassRecord] = []
        for row in rows:
            parent_name: str | None = None
            if row.parent_id is not None:
                parent = by_id.get(row.parent_id)
                parent_name = parent.name if parent is not None else None
            records.append(_row_to_class(row, parent_name))
        return tuple(records)

    async def list_entity_types(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        app_id: str | None = None,
    ) -> tuple[EntityTypeRecord, ...]:
        """Return baseline + tenant-overlay + app-specific rows.

        Filtering rules:
        - baseline rows (``tenant_id IS NULL`` AND ``app_id IS NULL``)
          always apply;
        - app-specific rows (``tenant_id IS NULL`` AND ``app_id = ?``)
          apply when ``app_id`` is supplied;
        - tenant overlay rows (``tenant_id = ?`` AND ``app_id IS NULL``
          or equal to the supplied app) apply when ``tenant_id`` is
          supplied.
        """
        stmt = select(SherlockOntologyEntityType, SherlockOntologyClass).join(
            SherlockOntologyClass,
            SherlockOntologyClass.id == SherlockOntologyEntityType.ontology_class_id,
        ).where(SherlockOntologyEntityType.is_active.is_(True))

        rows = (await self._db.execute(stmt)).all()
        records: list[EntityTypeRecord] = []
        for entity_row, class_row in rows:
            if not _row_in_scope(
                entity_row.tenant_id, entity_row.app_id,
                tenant_id=tenant_id, app_id=app_id,
            ):
                continue
            records.append(_row_to_entity(entity_row, class_row.name))
        # Baseline-first ordering; app-specific / tenant overlays come
        # after so the ``safety_by_entity`` flatten in ScopedBundle
        # applies overlays last-writer-wins.
        records.sort(key=lambda r: (
            0 if r.tenant_id is None and r.app_id is None else
            1 if r.tenant_id is None and r.app_id is not None else 2,
            r.name,
        ))
        return tuple(records)

    async def list_resolvers(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        app_id: str | None = None,
    ) -> tuple[ResolverRecord, ...]:
        stmt = select(SherlockEntityResolver).where(SherlockEntityResolver.is_active.is_(True))
        rows = (await self._db.execute(stmt)).scalars().all()
        records: list[ResolverRecord] = []
        for row in rows:
            if not _row_in_scope(
                row.tenant_id, row.app_id,
                tenant_id=tenant_id, app_id=app_id,
            ):
                continue
            records.append(_row_to_resolver(row))
        records.sort(key=lambda r: (
            0 if r.tenant_id is None and r.app_id is None else
            1 if r.tenant_id is None and r.app_id is not None else 2,
            r.key,
        ))
        return tuple(records)

    async def version(self) -> int:
        """Maximum ``version`` across platform-baseline ontology classes.

        Bundle cache includes this in its key so a seed bump forces a
        rebuild. Returns 0 when the ontology is empty — a fresh checkout
        will bootstrap to 1 on first seed.
        """
        result = await self._db.execute(
            select(SherlockOntologyClass.version)
        )
        versions = [v for (v,) in result.all() if v is not None]
        return max(versions) if versions else 0

    async def scoped(
        self,
        *,
        tenant_id: uuid.UUID | None,
        app_id: str | None,
    ) -> _ScopedOntologyView:
        """One-shot fetch used by :class:`BundleBuilder`.

        Executes three selects in sequence against the injected session.
        Cheap enough for request-scope; the bundle itself caches by key.
        """
        classes = await self.list_classes()
        entity_types = await self.list_entity_types(tenant_id=tenant_id, app_id=app_id)
        resolvers = await self.list_resolvers(tenant_id=tenant_id, app_id=app_id)
        ver = await self.version()
        return _ScopedOntologyView(
            classes=classes,
            entity_types=entity_types,
            resolvers=resolvers,
            version=ver,
        )


def _row_in_scope(
    row_tenant: uuid.UUID | None,
    row_app: str | None,
    *,
    tenant_id: uuid.UUID | None,
    app_id: str | None,
) -> bool:
    # Tenant filter: baseline always passes; tenant overlays only pass
    # when the caller supplies the same tenant_id.
    if row_tenant is not None:
        if tenant_id is None or row_tenant != tenant_id:
            return False
    # App filter: NULL = applies to every app. Specific slug must match
    # the requested app_id. If the caller does not supply an app_id,
    # only NULL-app rows pass (platform baseline).
    if row_app is not None:
        if app_id is None or row_app != app_id:
            return False
    return True


async def platform_ontology_version(db: AsyncSession) -> int:
    """Module-level convenience wrapper — used by BundleBuilder's cache
    key composition when it does not already hold a :class:`PlatformOntology`
    instance.
    """
    return await PlatformOntology(db).version()


__all__ = [
    'PLATFORM_ONTOLOGY_CLASSES',
    'PlatformOntology',
    'platform_ontology_version',
]
