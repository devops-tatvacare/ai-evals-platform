"""Phase 1 / M1 — BundleBuilder tests.

Plan-pinned assertions:
8.  ``BundleBuilder`` calls ``contribute_projection()`` for active packs.
9.  Bundle projection merging is deterministic.
10. Cache invalidates on pack-version bump.
11. Analytics projection marks ``run_name`` as ``explicit_only``.
12. Manifest-backed surfaces remain pack-owned inputs to projection/bundle
    assembly (not absorbed into the platform layer).
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

from app.auth import AuthContext
from app.models import Base
from app.models.sherlock_ontology import (
    SherlockEntityType,
    SherlockOntologyClass,
    SherlockResolver,
)
from app.services.chat_engine.capability_pack import (
    CAPABILITY_PACK_REGISTRY,
    ensure_packs_registered,
)
from app.services.sherlock.bundle import BundleBuilder
from app.services.sherlock.bundle_types import (
    ClassProjection,
    PackProjection,
    ScopeContext,
)
from app.services.sherlock.scope_guard import ScopeGuard


@pytest.fixture
async def sqlite_session() -> AsyncIterator[AsyncSession]:
    """Roadmap 01 §9.5: platform models declare ``schema='platform'``.
    SQLite has no schema concept, so we use SQLAlchemy's
    ``schema_translate_map`` to map ``platform`` → ``None`` at the
    connection layer. The mapping covers both DDL (``create_all``) and
    runtime queries (FK lookups) issued through the same engine."""
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
                    SherlockEntityType.__table__,  # type: ignore[list-item]
                    SherlockResolver.__table__,  # type: ignore[list-item]
                ],
            )
        )
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as session:
        yield session
    await engine.dispose()


@pytest.fixture(autouse=True)
def _load_manifests():
    """Analytics projection reads the manifest; make sure the cache is
    populated for the apps we exercise in these tests."""
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )

    _clear_manifest_cache_for_tests()
    load_all_manifests()
    yield
    _clear_manifest_cache_for_tests()


def _scope(effective_app_id: str = 'kaira-bot', *, pack_ids: tuple[str, ...] = ('analytics',)) -> ScopeContext:
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    return ScopeContext(
        tenant_id=tenant_id,
        user_id=user_id,
        allowed_app_ids=('kaira-bot',),
        requested_app_ids=('kaira-bot',),
        effective_app_id=effective_app_id,
        effective_pack_ids=pack_ids,
        scope_hints={},
        scope_denials=(),
        app_aliases=('kaira-bot', 'Kaira Bot'),
    )


class _FakePack:
    """Minimal pack used to observe contribute_projection calls."""

    pack_id = 'fake_pack'
    pack_version = '1.0.0'
    reason_codes = frozenset()
    artifact_contracts: dict = {}
    artifact_extras_contracts: dict = {}

    def __init__(self) -> None:
        self.calls: list[str] = []

    def tool_specs(self):
        return [{'name': 'fake_tool', 'inputSchema': {'type': 'object'}}]

    def tool_handlers(self):
        return {}

    def validate_arguments(self, tool_name, args):
        return None

    def describe_tools(self, app_id):
        return {'fake_tool': 'stub'}

    def build_outcome(self, tool_name, raw_result):
        from app.services.chat_engine.artifact import Outcome
        return Outcome()

    def describe_job(self, job):
        return '- job'

    def contribute_projection(self, scope):
        self.calls.append(scope.effective_app_id)
        return PackProjection(
            pack_id=self.pack_id,
            pack_version=self.pack_version,
            projected_classes=(
                ClassProjection(ontology_class='artifact', storage='fake_storage'),
            ),
            tool_specs=tuple(self.tool_specs()),
            tool_schema_enums={'mode': ('a', 'b')},
            question_hints='fake hint',
        )


@pytest.mark.asyncio
async def test_builder_calls_contribute_projection_per_active_pack(
    sqlite_session: AsyncSession,
) -> None:
    """Plan-assertion 8."""
    ensure_packs_registered()
    fake = _FakePack()
    # register_pack only fires the first time; explicitly overwrite the
    # registry slot here so repeated test runs don't accumulate stale
    # instances.
    CAPABILITY_PACK_REGISTRY['fake_pack'] = fake  # type: ignore[assignment]

    scope = _scope(pack_ids=('analytics', 'fake_pack'))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    # Fake pack's hook fired with the scope's effective app id.
    assert fake.calls == ['kaira-bot']
    # Projections for every active pack that implements the hook are
    # present; analytics + fake => 2 projections.
    pack_ids = {p.pack_id for p in bundle.pack_projections}
    assert pack_ids == {'analytics', 'fake_pack'}


@pytest.mark.asyncio
async def test_projection_merging_is_deterministic(sqlite_session: AsyncSession) -> None:
    """Plan-assertion 9."""
    ensure_packs_registered()
    fake = _FakePack()
    CAPABILITY_PACK_REGISTRY['fake_pack'] = fake  # type: ignore[assignment]

    scope = _scope(pack_ids=('fake_pack', 'analytics'))
    builder = BundleBuilder(sqlite_session)
    bundle_a = await builder.build(scope)
    builder.clear_cache()
    bundle_b = await builder.build(scope)

    # Two fresh builds produce identical merged shapes regardless of
    # pack-iteration order.
    assert [s['name'] for s in bundle_a.tool_specs] == [s['name'] for s in bundle_b.tool_specs]
    assert bundle_a.tool_schema_enums == bundle_b.tool_schema_enums
    # Merge is dedup'd by tool name — even if we registered the fake
    # pack's tool twice the name would only show up once.
    names = [s['name'] for s in bundle_a.tool_specs]
    assert len(names) == len(set(names))


@pytest.mark.asyncio
async def test_cache_hit_on_identical_scope(sqlite_session: AsyncSession) -> None:
    ensure_packs_registered()
    scope = _scope(pack_ids=('analytics',))
    builder = BundleBuilder(sqlite_session)

    first = await builder.build(scope)
    second = await builder.build(scope)

    # Cache hit == same object returned for an identical scope.
    assert first is second


@pytest.mark.asyncio
async def test_cache_invalidates_on_pack_version_bump(sqlite_session: AsyncSession) -> None:
    """Plan-assertion 10."""
    ensure_packs_registered()
    fake = _FakePack()
    CAPABILITY_PACK_REGISTRY['fake_pack'] = fake  # type: ignore[assignment]

    scope = _scope(pack_ids=('fake_pack',))
    builder = BundleBuilder(sqlite_session)
    first = await builder.build(scope)

    # Bump the pack version — new cache key, new bundle instance.
    fake.pack_version = '2.0.0'
    second = await builder.build(scope)

    assert first is not second
    assert first.cache_key != second.cache_key


def test_cache_key_shape_is_stable() -> None:
    scope = _scope()
    key_a = BundleBuilder.cache_key_for(scope, ontology_version=1, pack_versions={'analytics': '1.0'})
    key_b = BundleBuilder.cache_key_for(scope, ontology_version=1, pack_versions={'analytics': '1.0'})
    key_c = BundleBuilder.cache_key_for(scope, ontology_version=2, pack_versions={'analytics': '1.0'})

    assert key_a == key_b
    assert key_a != key_c
    # Pack version map is frozen so dict-insert order does not matter.
    key_d = BundleBuilder.cache_key_for(
        scope, ontology_version=1,
        pack_versions={'analytics': '1.0', 'report_builder': '2.0'},
    )
    key_e = BundleBuilder.cache_key_for(
        scope, ontology_version=1,
        pack_versions={'report_builder': '2.0', 'analytics': '1.0'},
    )
    assert key_d == key_e


@pytest.mark.asyncio
async def test_analytics_projection_marks_run_name_explicit_only(
    sqlite_session: AsyncSession,
) -> None:
    """Plan-assertion 11."""
    ensure_packs_registered()
    scope = _scope(pack_ids=('analytics',))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    analytics_proj = next(p for p in bundle.pack_projections if p.pack_id == 'analytics')
    run_class = next(
        c for c in analytics_proj.projected_classes
        if c.ontology_class == 'evaluation.run'
    )
    assert run_class.field_safety.get('run_name') == 'explicit_only'


@pytest.mark.asyncio
async def test_manifest_surfaces_remain_pack_owned_inputs(
    sqlite_session: AsyncSession,
) -> None:
    """Plan-assertion 12.

    Platform ontology tables never absorb ``data_surfaces``; the bundle
    reads them through the pack's projection ``semantic_slice``. No
    platform-layer entity_type row may claim ownership of a surface key.
    """
    ensure_packs_registered()
    scope = _scope(pack_ids=('analytics',))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    analytics_proj = next(p for p in bundle.pack_projections if p.pack_id == 'analytics')
    surfaces = analytics_proj.semantic_slice['data_surfaces']
    # The kaira-bot manifest declares >=1 data surface. The projection
    # carried it through pack-owned, not platform-owned.
    assert len(surfaces) >= 1
    # Sanity: surface rows are dicts with the manifest-declared keys,
    # not hallucinated platform shapes.
    first = surfaces[0]
    for key in ('key', 'backed_by', 'entity_types', 'entity_field_map', 'fields'):
        assert key in first
    # Platform-layer entity_types never include surface keys.
    for entity in bundle.entity_types:
        assert entity.name not in {s['key'] for s in surfaces}


@pytest.mark.asyncio
async def test_scope_guard_to_bundle_end_to_end(sqlite_session: AsyncSession) -> None:
    """Sanity: ScopeGuard output is a valid input to BundleBuilder."""
    ensure_packs_registered()
    guard = ScopeGuard([
        {
            'slug': 'kaira-bot',
            'is_active': True,
            'config': {
                'displayName': 'Kaira Bot',
                'chat': {'capabilities': ['analytics', 'report_builder']},
            },
        },
    ])
    auth = AuthContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email='test@example.com',
        role_id=uuid.uuid4(),
        is_owner=False,
        permissions=frozenset(),
        app_access=frozenset({'kaira-bot'}),
    )
    scope = guard.resolve(auth=auth, requested_app_id='kaira-bot')

    builder = BundleBuilder(sqlite_session)
    bundle = await builder.build(scope)

    assert bundle.scope.effective_app_id == 'kaira-bot'
    assert bundle.tool_specs  # analytics + report_builder contributed tool specs
