"""Phase 1 / M3 — scoped-bundle extensibility proof (plan §9, §10 M3, §11.3).

These are the four plan-pinned acceptance gates for M3. Each asserts
that the in-tree stub vector pack lights up through pack discovery +
``App.config.chat.capabilities`` alone — no Harness Core / Bundle /
ScopeGuard edits required.

Do NOT monkeypatch the registry or the discovery path. If any of these
tests need a shortcut to make the stub pack appear, that's a regression
in the extension contract the rewrite is claiming to ship.
"""
from __future__ import annotations

import ast
import uuid
from pathlib import Path
from typing import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base
from app.models.sherlock_ontology import (
    SherlockEntityType,
    SherlockOntologyClass,
    SherlockResolver,
)
from app.services.chat_engine.capability_pack import (
    CAPABILITY_PACK_REGISTRY,
    _discover_pack_modules,
    ensure_packs_registered,
)
from app.services.sherlock.bundle import BundleBuilder
from app.services.sherlock.bundle_types import PackProjection, ScopeContext


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def sqlite_session() -> AsyncIterator[AsyncSession]:
    """In-memory ontology tables so ``BundleBuilder`` has a live reader.

    Roadmap 01 §9.5: platform models declare ``schema='platform'``;
    SQLite has no schema concept, so map ``platform`` → ``None`` via
    ``schema_translate_map``."""
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
    """Analytics projection reads the manifest; stub pack needs it cleared
    between tests so cached state cannot pollute the extensibility proof."""
    from app.services.chat_engine.manifest import (
        _clear_manifest_cache_for_tests,
        load_all_manifests,
    )

    _clear_manifest_cache_for_tests()
    load_all_manifests()
    yield
    _clear_manifest_cache_for_tests()


def _scope(
    *,
    effective_app_id: str = 'kaira-bot',
    pack_ids: tuple[str, ...] = ('analytics', 'stub_vector'),
) -> ScopeContext:
    return ScopeContext(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        allowed_app_ids=(effective_app_id,),
        requested_app_ids=(effective_app_id,),
        effective_app_id=effective_app_id,
        effective_pack_ids=pack_ids,
        scope_hints={},
        scope_denials=(),
        app_aliases=(effective_app_id,),
    )


# ---------------------------------------------------------------------------
# M3 gate 1 — pack registers via the real auto-discovery path
# ---------------------------------------------------------------------------


def test_stub_pack_registers_without_harness_edit() -> None:
    """Plan §11.3 — stub pack is picked up by ``_discover_pack_modules``
    and appears in ``CAPABILITY_PACK_REGISTRY`` without any harness-core
    file importing or listing it by hand.
    """
    # ``_discover_pack_modules`` walks ``app/services/**/*_pack.py`` at
    # runtime. The stub pack must appear in that tuple purely by file
    # convention, not by a hand-maintained list.
    modules = _discover_pack_modules()
    assert 'app.services.stub_vector.stub_vector_pack' in modules, (
        'stub_vector_pack.py did not get picked up by the pack discovery '
        'walker — the file must live under app/services/ and end in '
        '_pack.py for the extensibility contract to hold.'
    )

    # Registration fires as a side effect of importing the module.
    ensure_packs_registered()
    assert 'stub_vector' in CAPABILITY_PACK_REGISTRY

    # And — critically — no Harness Core / Bundle / ScopeGuard file
    # references the stub pack by id. If this ever regresses, the
    # "config-only extension" claim is false.
    repo_root = Path(__file__).resolve().parents[1]
    harness_core_paths = [
        repo_root / 'app' / 'services' / 'chat_engine' / 'capability_pack.py',
        repo_root / 'app' / 'services' / 'chat_engine' / 'openai_agents_adapter.py',
        repo_root / 'app' / 'services' / 'report_builder' / 'chat_handler.py',
        repo_root / 'app' / 'services' / 'sherlock' / 'bundle.py',
        repo_root / 'app' / 'services' / 'sherlock' / 'bundle_types.py',
        repo_root / 'app' / 'services' / 'sherlock' / 'scope_guard.py',
        repo_root / 'app' / 'services' / 'sherlock' / 'platform_ontology.py',
    ]
    for path in harness_core_paths:
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        assert 'stub_vector' not in text, (
            f'{path.relative_to(repo_root)} mentions the stub pack by id — '
            'that breaks the M3 promise that Harness Core / Bundle / '
            'ScopeGuard require zero edits to light up a new pack.'
        )


# ---------------------------------------------------------------------------
# M3 gate 2 — stub pack's tool appears in the final bundle tool specs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stub_pack_tool_appears_in_bundle_tool_specs(
    sqlite_session: AsyncSession,
) -> None:
    """Plan §11.3 — once the app enables the stub pack in
    ``App.config.chat.capabilities``, its tool spec is merged into
    ``ScopedBundle.tool_specs`` alongside analytics.
    """
    ensure_packs_registered()
    scope = _scope(pack_ids=('analytics', 'stub_vector'))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    tool_names = [spec['name'] for spec in bundle.tool_specs]
    assert 'stub_vector_search' in tool_names, (
        'stub_vector_search is missing from bundle tool specs — the '
        'BundleBuilder tool-spec merge must not special-case known packs.'
    )
    # Sanity: analytics tools still there — the stub didn't overwrite them.
    assert any(
        name in tool_names for name in ('discover', 'lookup', 'resolve_entity')
    ), 'analytics tools disappeared after adding the stub pack — merge bug'

    # Stub-contributed enum lands in the merged bounded-enum map too.
    assert 'corpus' in bundle.tool_schema_enums
    assert set(bundle.tool_schema_enums['corpus']) == {'evidence', 'run_notes'}


# ---------------------------------------------------------------------------
# M3 gate 3 — projection merges alongside analytics (same bundle)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stub_pack_projection_merged_alongside_analytics(
    sqlite_session: AsyncSession,
) -> None:
    """Plan §11.3 — both projections land in ``bundle.pack_projections``
    and carry their ontology-class projections independently. Analytics
    keeps ``evaluation.run``; the stub keeps its own
    ``artifact.embedding`` + ``interaction.evidence`` rows.
    """
    ensure_packs_registered()
    scope = _scope(pack_ids=('analytics', 'stub_vector'))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    projections_by_id = {p.pack_id: p for p in bundle.pack_projections}
    assert set(projections_by_id) == {'analytics', 'stub_vector'}

    stub_proj = projections_by_id['stub_vector']
    assert isinstance(stub_proj, PackProjection)
    stub_classes = {cp.ontology_class for cp in stub_proj.projected_classes}
    assert stub_classes == {'artifact.embedding', 'interaction.evidence'}

    # The stub's semantic_slice is pack-owned — the platform layer never
    # absorbed it. Analytics' slice stays independent.
    assert set(stub_proj.semantic_slice['corpora']) == {'evidence', 'run_notes'}
    analytics_proj = projections_by_id['analytics']
    assert 'corpora' not in dict(analytics_proj.semantic_slice)

    # Question hints from both packs compose via the deterministic merge.
    assert 'stub_vector_search' in bundle.question_hints


# ---------------------------------------------------------------------------
# M3 gate 4 — disabling analytics leaves the stub pack functional
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disabling_analytics_leaves_stub_pack_functional(
    sqlite_session: AsyncSession,
) -> None:
    """Plan §11.3 — an app may enable ONLY the stub pack and still get
    a working bundle. No Harness Core path may assume analytics is
    present; the merge must be pack-agnostic.
    """
    ensure_packs_registered()
    scope = _scope(pack_ids=('stub_vector',))
    builder = BundleBuilder(sqlite_session)

    bundle = await builder.build(scope)

    # Exactly one projection: the stub pack.
    assert {p.pack_id for p in bundle.pack_projections} == {'stub_vector'}

    # The stub pack's tool surface is fully usable.
    tool_names = [spec['name'] for spec in bundle.tool_specs]
    assert tool_names == ['stub_vector_search']
    assert bundle.tool_schema_enums['corpus']

    # And the pack's handler round-trips a valid §6.2 envelope without
    # any harness-core glue — handler lives entirely in the pack module.
    pack = CAPABILITY_PACK_REGISTRY['stub_vector']
    handler = pack.tool_handlers()['stub_vector_search']
    envelope = await handler(query='kaira smoke run', corpus='run_notes')
    dumped = envelope.model_dump(mode='json')
    assert dumped['status'] == 'ok'
    assert dumped['outcome']['kind'] == 'artifact'
    assert dumped['outcome']['artifact']['contract'] == 'stub_vector.evidence.v1'
    # Deterministic top-hit: "kaira smoke" tokens match chunk run-notes/001.
    hits = dumped['payload']['evidence']['hits']
    assert hits and hits[0]['chunk_id'] == 'run-notes/001'


# ---------------------------------------------------------------------------
# Bonus — cheap static guard that the add-a-pack doc stayed honest.
# ---------------------------------------------------------------------------


def test_add_a_pack_doc_matches_shipped_code() -> None:
    """``docs/sherlock-add-a-pack.md`` must cite the real artefacts the
    extension path uses. Breaking this signals doc/code drift.
    """
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / 'docs' / 'sherlock-add-a-pack.md'
    assert doc.exists(), 'docs/sherlock-add-a-pack.md is missing — M3 ships it.'
    text = doc.read_text(encoding='utf-8')
    for marker in (
        '_pack.py',
        'contribute_projection',
        'App.config.chat.capabilities',
        'stub_vector',
    ):
        assert marker in text, (
            f'sherlock-add-a-pack.md must mention {marker!r} — the M3 doc '
            'pins the real shipped path.'
        )


# ---------------------------------------------------------------------------
# Parse-level guard — stub pack module has no forbidden harness-core
# imports (i.e. it does not reach into the turn loop or the bundle
# internals). Cheap AST check so the extensibility claim can't silently
# regress.
# ---------------------------------------------------------------------------


def test_stub_pack_has_no_harness_core_reach_in() -> None:
    path = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'stub_vector' / 'stub_vector_pack.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    forbidden = {
        'app.services.report_builder.chat_handler',
        'app.services.chat_engine.openai_agents_adapter',
        'app.services.sherlock.scope_guard',
        'app.services.sherlock.bundle',
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            assert node.module not in forbidden, (
                f'stub_vector_pack imports {node.module!r} — a pack must '
                'never reach into harness-core internals.'
            )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                assert alias.name not in forbidden, (
                    f'stub_vector_pack imports {alias.name!r} — forbidden.'
                )
