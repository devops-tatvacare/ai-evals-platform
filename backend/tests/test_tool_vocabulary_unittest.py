"""Unit tests for the canonical tool vocabulary."""
from __future__ import annotations

import pytest

from app.services.report_builder.analytics.vocabulary import (
    ColumnTarget,
    DimensionSpec,
    build_tool_vocabulary,
    column_error_payload,
    dimension_error_payload,
    entity_type_error_payload,
)


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
def kaira_vocab():
    """Load the real kaira-bot manifest + semantic model."""
    from app.services.chat_engine.manifest import _clear_manifest_cache_for_tests, load_all_manifests
    from app.services.chat_engine.sql_agent import load_semantic_model

    _clear_manifest_cache_for_tests()
    load_all_manifests()

    semantic_model = load_semantic_model('kaira-bot', app_config={})
    return build_tool_vocabulary('kaira-bot', semantic_model)


# ── Dimension resolution ─────────────────────────────────────────────


def test_canonical_dimension_name_resolves_unique(kaira_vocab):
    resolution = kaira_vocab.resolve_dimension('result_status')

    assert resolution.status == 'unique'
    assert isinstance(resolution.canonical, DimensionSpec)
    assert resolution.canonical.name == 'result_status'
    assert resolution.canonical.table == 'analytics_eval_facts'


def test_canonical_dimension_name_case_insensitive(kaira_vocab):
    resolution = kaira_vocab.resolve_dimension('Result_Status')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.name == 'result_status'


def test_manifest_synonym_verdict_resolves_to_result_status(kaira_vocab):
    """The kaira manifest declares `verdict` as a synonym for `result_status`.

    This is the central drift the vocabulary layer fixes: before this phase,
    ``lookup(dimension='verdict')`` returned ``Unknown dimension`` because
    the synonym was declared only at the catalog column level.
    """
    resolution = kaira_vocab.resolve_dimension('verdict')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.name == 'result_status'


def test_manifest_synonym_rule_resolves_to_rule_dimension(kaira_vocab):
    resolution = kaira_vocab.resolve_dimension('rule')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.name == 'rule'
    assert resolution.canonical.expression == 'criterion_label'


def test_unknown_dimension_returns_unknown(kaira_vocab):
    resolution = kaira_vocab.resolve_dimension('not-a-thing')

    assert resolution.status == 'unknown'
    assert resolution.canonical is None
    assert resolution.candidates == ()


def test_empty_term_returns_unknown(kaira_vocab):
    resolution = kaira_vocab.resolve_dimension('   ')

    assert resolution.status == 'unknown'


def test_ambiguous_synonym_surfaces_all_candidates():
    """A synonym declared on two different (table, column) pairs that both
    back semantic dimensions must resolve as ambiguous, not silently pick one.
    """
    from app.services.chat_engine.manifest import AppManifest, CatalogTable, DataSurface, ManifestColumn

    manifest = AppManifest(
        app_id='fake-app',
        catalog_tables={
            'table_a': CatalogTable(
                orm='FakeA',
                columns={
                    'col_a': ManifestColumn(role='dimension', synonyms=['thing']),
                },
            ),
            'table_b': CatalogTable(
                orm='FakeB',
                columns={
                    'col_b': ManifestColumn(role='dimension', synonyms=['thing']),
                },
            ),
        },
        data_surfaces=[],
    )
    semantic_model = {
        'dimensions': [
            {'name': 'col_a', 'table': 'table_a', 'expression': 'col_a'},
            {'name': 'col_b', 'table': 'table_b', 'expression': 'col_b'},
        ],
    }

    vocab = build_tool_vocabulary('fake-app', semantic_model, manifest=manifest)
    resolution = vocab.resolve_dimension('thing')

    assert resolution.status == 'ambiguous'
    assert {c.name for c in resolution.candidates} == {'col_a', 'col_b'}


# ── Column resolution ────────────────────────────────────────────────


def test_column_canonical_name_resolves_unique(kaira_vocab):
    resolution = kaira_vocab.resolve_column('criterion_label')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.table == 'analytics_criterion_facts'
    assert resolution.canonical.column == 'criterion_label'


def test_column_synonym_resolves_unique_when_table_unique(kaira_vocab):
    """``verdict`` is only declared on one table — resolves unambiguously."""
    resolution = kaira_vocab.resolve_column('verdict')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.table == 'analytics_eval_facts'
    assert resolution.canonical.column == 'result_status'


def test_column_synonym_normalizes_whitespace_and_case(kaira_vocab):
    """``Rule Name`` should normalize to the same term as ``rule_name``."""
    a = kaira_vocab.resolve_column('Rule Name')
    b = kaira_vocab.resolve_column('rule_name')

    assert a.status == 'unique'
    assert b.status == 'unique'
    assert a.canonical == b.canonical


def test_column_resolves_per_table_qualifier(kaira_vocab):
    resolution = kaira_vocab.resolve_column('analytics_eval_facts.result_status')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.table == 'analytics_eval_facts'


def test_preferred_table_narrows_ambiguous_to_unique():
    """If a synonym exists on two tables but the caller specifies one, pick that one."""
    from app.services.chat_engine.manifest import AppManifest, CatalogTable, ManifestColumn

    manifest = AppManifest(
        app_id='fake-app',
        catalog_tables={
            'table_a': CatalogTable(
                orm='FakeA',
                columns={'col_a': ManifestColumn(role='dimension', synonyms=['thing'])},
            ),
            'table_b': CatalogTable(
                orm='FakeB',
                columns={'col_b': ManifestColumn(role='dimension', synonyms=['thing'])},
            ),
        },
        data_surfaces=[],
    )

    vocab = build_tool_vocabulary('fake-app', {'dimensions': []}, manifest=manifest)
    resolution = vocab.resolve_column('thing', preferred_table='table_b')

    assert resolution.status == 'unique'
    assert resolution.canonical is not None
    assert resolution.canonical.table == 'table_b'


def test_unknown_column_returns_unknown(kaira_vocab):
    resolution = kaira_vocab.resolve_column('not-a-column')

    assert resolution.status == 'unknown'


# ── Entity-type validation ───────────────────────────────────────────


def test_manifest_entity_types_are_recognized(kaira_vocab):
    # Every entity_type declared on any data_surface must validate.
    for surface in kaira_vocab.surfaces.values():
        for entity_type in surface.entity_types:
            assert kaira_vocab.validate_entity_type(entity_type), (
                f"expected {entity_type!r} to validate as a known entity type "
                f"(declared on surface {surface.key!r})"
            )


def test_unknown_entity_type_fails_validation(kaira_vocab):
    assert not kaira_vocab.validate_entity_type('not_an_entity_type')


def test_surface_accepts_entity_type_only_if_declared(kaira_vocab):
    # Find any real surface + entity_type pair to probe.
    some_surface = next(iter(kaira_vocab.surfaces.values()))
    assert some_surface.entity_types, 'test needs a surface with at least one entity_type'
    declared = some_surface.entity_types[0]

    assert kaira_vocab.surface_accepts_entity_type(some_surface.key, declared)
    # A globally-valid entity type that is *not* declared on this surface
    # must be rejected.
    global_extras = kaira_vocab.entity_types - set(some_surface.entity_types)
    if global_extras:
        outsider = next(iter(global_extras))
        assert not kaira_vocab.surface_accepts_entity_type(some_surface.key, outsider)


def test_surface_accepts_entity_type_rejects_unknown_surface(kaira_vocab):
    assert not kaira_vocab.surface_accepts_entity_type('no-such-surface', 'run_id')


# ── Error payload shapes ─────────────────────────────────────────────


def test_dimension_error_payload_for_ambiguous_lists_candidates(kaira_vocab):
    from app.services.report_builder.analytics.vocabulary import DimensionResolution

    resolution = DimensionResolution(
        status='ambiguous',
        term='thing',
        candidates=(
            DimensionSpec(name='col_a', table='t_a', expression='col_a'),
            DimensionSpec(name='col_b', table='t_b', expression='col_b'),
        ),
    )
    payload = dimension_error_payload(resolution, kaira_vocab)

    assert payload['status'] == 'error'
    assert payload['reason'] == 'ambiguous_dimension'
    assert sorted(payload['candidates']) == ['col_a', 'col_b']


def test_dimension_error_payload_for_unknown_lists_available(kaira_vocab):
    from app.services.report_builder.analytics.vocabulary import DimensionResolution

    payload = dimension_error_payload(
        DimensionResolution(status='unknown', term='xyz'),
        kaira_vocab,
    )

    assert payload['reason'] == 'unknown_dimension'
    assert 'result_status' in payload['available_dimensions']


def test_column_error_payload_for_ambiguous_lists_fq_candidates(kaira_vocab):
    from app.services.report_builder.analytics.vocabulary import ColumnResolution

    resolution = ColumnResolution(
        status='ambiguous',
        term='thing',
        candidates=(
            ColumnTarget(table='t_a', column='col_a', role='dimension'),
            ColumnTarget(table='t_b', column='col_b', role='dimension'),
        ),
    )
    payload = column_error_payload(resolution)

    assert payload['reason'] == 'ambiguous_column'
    assert {'table': 't_a', 'column': 'col_a'} in payload['candidates']


def test_entity_type_error_payload_scoped_to_surface(kaira_vocab):
    some_surface = next(iter(kaira_vocab.surfaces.values()))
    payload = entity_type_error_payload(
        'bogus_entity',
        kaira_vocab,
        surface_key=some_surface.key,
    )

    assert payload['reason'] == 'invalid_entity_type_for_surface'
    assert payload['surface_key'] == some_surface.key
    assert payload['allowed_entity_types'] == sorted(some_surface.entity_types)
