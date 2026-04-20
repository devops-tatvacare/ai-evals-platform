"""Regression tests for the section_id -> componentId fallback in report composition.

User-authored blueprints (saved from Sherlock) use generic section IDs like
``summary-cards`` / ``narrative``, while an app's analytics profile emits
payloads keyed by its canonical ids (e.g. ``voice-rx-summary``). Without the
type-based fallback, the composer silently skipped every section and produced
empty reports.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.services.reports.config_models import PresentationSectionConfig
from app.services.reports.report_composer import compose_sections
from app.services.reports.report_generation_service import _serialize_section_payloads


class _FakeBaseSection:
    def __init__(self, section_id: str, component_type: str, data: Any) -> None:
        self.id = section_id
        self.type = component_type
        self._data = data

    def model_dump(self, by_alias: bool = False) -> dict:  # noqa: ARG002
        return {'data': self._data, 'id': self.id, 'type': self.type}


def test_serialize_indexes_payloads_by_id_and_component_type():
    base_sections = [
        _FakeBaseSection('voice-rx-summary', 'summary_cards', 'summary-data'),
        _FakeBaseSection('voice-rx-metrics', 'metric_breakdown', 'metrics-data'),
    ]
    indexed = _serialize_section_payloads(base_sections)

    assert indexed['voice-rx-summary'] == 'summary-data'
    assert indexed['voice-rx-metrics'] == 'metrics-data'
    assert indexed['summary_cards'] == 'summary-data'
    assert indexed['metric_breakdown'] == 'metrics-data'


def test_serialize_does_not_overwrite_existing_id_keys_with_type_collision():
    # An app that happens to name a section 'summary_cards' (same as its type)
    # must not be shadowed by the type-alias.
    base_sections = [
        _FakeBaseSection('summary_cards', 'summary_cards', 'canonical-payload'),
    ]
    indexed = _serialize_section_payloads(base_sections)
    assert indexed['summary_cards'] == 'canonical-payload'


def test_compose_sections_resolves_user_blueprint_via_component_type_fallback(monkeypatch):
    """A Sherlock-saved blueprint (generic section IDs) must resolve to the
    app's canonical payloads via component-type fallback.
    """
    payloads = {
        # App profile emits app-namespaced ids
        'voice-rx-summary': {'key': 'accuracy', 'value': 91},
        'voice-rx-metrics': {'metric': 'pass_rate', 'value': 0.91},
        # Serializer also indexes by component type
        'summary_cards': {'key': 'accuracy', 'value': 91},
        'metric_breakdown': {'metric': 'pass_rate', 'value': 0.91},
    }

    # Stub compose_sections' downstream builder so we don't depend on pydantic shape.
    built: list[tuple[str, Any]] = []

    def _fake_build_section(config, data):
        built.append((getattr(config, 'section_id', None) or getattr(config, 'id'), data))
        return SimpleNamespace(id=config.section_id, data=data)

    monkeypatch.setattr(
        'app.services.reports.report_composer.build_section',
        _fake_build_section,
    )

    user_configs = [
        PresentationSectionConfig(
            section_id='summary-cards',
            component_id='summary_cards',
            title='Summary Cards',
            description=None,
            variant='',
            printable=True,
        ),
        PresentationSectionConfig(
            section_id='metric-breakdown',
            component_id='metric_breakdown',
            title='Metric Breakdown',
            description=None,
            variant='',
            printable=True,
        ),
    ]

    out = compose_sections(user_configs, payloads)
    assert [entry[0] for entry in built] == ['summary-cards', 'metric-breakdown']
    assert len(out) == 2


def test_compose_sections_skips_when_neither_id_nor_type_matches(monkeypatch):
    payloads = {'voice-rx-summary': 'something'}
    monkeypatch.setattr(
        'app.services.reports.report_composer.build_section',
        lambda *_args, **_kwargs: None,
    )
    user_configs = [
        PresentationSectionConfig(
            section_id='mystery-section',
            component_id='mystery_type',
            title='Mystery',
            description=None,
            variant='',
            printable=True,
        ),
    ]
    assert compose_sections(user_configs, payloads) == []
