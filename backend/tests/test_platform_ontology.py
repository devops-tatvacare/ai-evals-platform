"""Phase 1 / M1 — platform ontology persistence tests.

Covers the plan-pinned assertions:
1. Ontology classes are seeded (7-class backbone + sub-classes).
2. Entity safety flags exist and include ``explicit_only`` for ``run_name``.
3. ``PlatformOntology.list_entity_types`` filters by tenant and app.
"""
from __future__ import annotations

import uuid
from typing import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base
from app.models.sherlock_ontology import (
    SherlockOntologyEntityType,
    SherlockOntologyClass,
    SherlockEntityResolver,
)
from app.services.sherlock.platform_ontology import (
    PLATFORM_ONTOLOGY_CLASSES,
    PlatformOntology,
)


@pytest.fixture
async def sqlite_session() -> AsyncIterator[AsyncSession]:
    """Async SQLite session with only the ontology tables created.

    Full ``Base.metadata.create_all`` fails under SQLite because several
    platform tables rely on PG-specific DDL (JSONB, GIN indexes); we
    only need the three ontology tables here so we create them
    explicitly.

    Roadmap 01 §9.5: platform models declare ``schema='platform'``.
    SQLite has no schema concept, so we use SQLAlchemy's
    ``schema_translate_map`` to map ``platform`` → ``None`` at the
    connection layer. The mapping covers both DDL (``create_all``) and
    runtime queries (FK lookups) issued through the same engine.
    """
    engine = create_async_engine(
        'sqlite+aiosqlite:///:memory:',
        future=True,
    ).execution_options(schema_translate_map={'platform': None, 'analytics': None})
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn,
                tables=[
                    SherlockOntologyClass.__table__,  # type: ignore[list-item]
                    SherlockOntologyEntityType.__table__,  # type: ignore[list-item]
                    SherlockEntityResolver.__table__,  # type: ignore[list-item]
                ],
            )
        )
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as session:
        yield session
    await engine.dispose()


def _make_class(name: str, *, parent_id: uuid.UUID | None = None) -> SherlockOntologyClass:
    return SherlockOntologyClass(
        id=uuid.uuid4(),
        name=name,
        parent_id=parent_id,
        description=None,
        version=1,
    )


def _make_entity(
    *,
    name: str,
    class_id: uuid.UUID,
    safety: str,
    app_id: str | None = None,
    tenant_id: uuid.UUID | None = None,
) -> SherlockOntologyEntityType:
    return SherlockOntologyEntityType(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        app_id=app_id,
        name=name,
        ontology_class_id=class_id,
        role='dimension',
        safety=safety,
        description=None,
        examples=[],
        is_active=True,
    )


@pytest.mark.asyncio
async def test_classes_seeded(sqlite_session: AsyncSession) -> None:
    """Plan §5.1: the 7-class backbone is platform-authoritative."""
    name_to_id: dict[str, uuid.UUID] = {}
    # First pass: parents
    for spec in PLATFORM_ONTOLOGY_CLASSES:
        if spec['parent'] is None:
            row = _make_class(spec['name'])
            sqlite_session.add(row)
            name_to_id[spec['name']] = row.id
    await sqlite_session.flush()
    for spec in PLATFORM_ONTOLOGY_CLASSES:
        if spec['parent'] is not None:
            row = _make_class(spec['name'], parent_id=name_to_id[spec['parent']])
            sqlite_session.add(row)
            name_to_id[spec['name']] = row.id
    await sqlite_session.flush()

    ontology = PlatformOntology(sqlite_session)
    classes = await ontology.list_classes()
    names = {c.name for c in classes}
    # The 7 top-level classes MUST be present.
    assert {'scope', 'subject', 'interaction', 'evaluation', 'artifact', 'operation', 'extension'} <= names
    # Sub-classes are persisted with parent_name resolved.
    eval_run = next(c for c in classes if c.name == 'evaluation.run')
    assert eval_run.parent_name == 'evaluation'
    artifact_chart = next(c for c in classes if c.name == 'artifact.chart')
    assert artifact_chart.parent_name == 'artifact'


@pytest.mark.asyncio
async def test_entity_type_safety_flags_present(sqlite_session: AsyncSession) -> None:
    """Plan §5.1: every entity type carries a safety flag; run_name is
    explicit_only."""
    eval_class = _make_class('evaluation.run')
    sqlite_session.add(eval_class)
    await sqlite_session.flush()

    sqlite_session.add_all([
        _make_entity(name='run_name', class_id=eval_class.id, safety='explicit_only'),
        _make_entity(name='run_id', class_id=eval_class.id, safety='safe_first_pass'),
        _make_entity(name='app_alias', class_id=eval_class.id, safety='unsafe'),
    ])
    await sqlite_session.flush()

    ontology = PlatformOntology(sqlite_session)
    entities = await ontology.list_entity_types()
    by_name = {e.name: e for e in entities}
    assert by_name['run_name'].safety == 'explicit_only'
    assert by_name['run_id'].safety == 'safe_first_pass'
    assert by_name['app_alias'].safety == 'unsafe'
    # Every row carries a non-empty safety.
    assert all(e.safety for e in entities)


@pytest.mark.asyncio
async def test_scoping_filters_by_tenant_and_app(sqlite_session: AsyncSession) -> None:
    """Plan §5.1: tenant/app scoping is enforced by the reader."""
    eval_class = _make_class('evaluation.run')
    sqlite_session.add(eval_class)
    await sqlite_session.flush()

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    sqlite_session.add_all([
        _make_entity(name='baseline', class_id=eval_class.id, safety='safe_first_pass'),
        _make_entity(name='kaira_only', class_id=eval_class.id, safety='safe_first_pass', app_id='kaira-bot'),
        _make_entity(name='voice_only', class_id=eval_class.id, safety='safe_first_pass', app_id='voice-rx'),
        _make_entity(name='tenant_a_overlay', class_id=eval_class.id, safety='safe_first_pass', tenant_id=tenant_a),
        _make_entity(name='tenant_b_overlay', class_id=eval_class.id, safety='safe_first_pass', tenant_id=tenant_b, app_id='kaira-bot'),
    ])
    await sqlite_session.flush()

    ontology = PlatformOntology(sqlite_session)

    # Baseline-only call: no tenant, no app → only platform-baseline row.
    rows = await ontology.list_entity_types()
    names = {r.name for r in rows}
    assert names == {'baseline'}

    # App-specific call surfaces baseline + app row.
    rows = await ontology.list_entity_types(app_id='kaira-bot')
    names = {r.name for r in rows}
    assert names == {'baseline', 'kaira_only'}

    # Other app does NOT leak the kaira-only row.
    rows = await ontology.list_entity_types(app_id='voice-rx')
    names = {r.name for r in rows}
    assert names == {'baseline', 'voice_only'}

    # Tenant overlay: tenant_a gets its own overlay + baseline + its app row.
    rows = await ontology.list_entity_types(tenant_id=tenant_a, app_id='kaira-bot')
    names = {r.name for r in rows}
    assert names == {'baseline', 'kaira_only', 'tenant_a_overlay'}

    # Tenant B does NOT see tenant A's overlay.
    rows = await ontology.list_entity_types(tenant_id=tenant_b, app_id='kaira-bot')
    names = {r.name for r in rows}
    assert 'tenant_a_overlay' not in names
    assert 'tenant_b_overlay' in names


@pytest.mark.asyncio
async def test_version_participates_in_ontology(sqlite_session: AsyncSession) -> None:
    """Cache-key component: ``PlatformOntology.version()`` advances with seeds."""
    ontology = PlatformOntology(sqlite_session)
    assert await ontology.version() == 0

    low = _make_class('scope')
    high = _make_class('evaluation')
    high.version = 3
    sqlite_session.add_all([low, high])
    await sqlite_session.flush()

    assert await ontology.version() == 3
