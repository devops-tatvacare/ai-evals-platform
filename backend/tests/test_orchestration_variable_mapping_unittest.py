"""Pure-function tests for the variable-mapping resolver.

One shape, end-to-end. Templates carry no mapping shape; nodes declare
their bindings explicitly. The resolver has no fallback path — empty
mappings produce an empty payload (degenerate but valid).
"""
from __future__ import annotations

import pytest

from app.services.orchestration.connections.variable_mapping import (
    VariableMappingConfigError,
    apply_variable_mappings_dict,
    apply_variable_mappings_list,
)


def test_dict_payload_source_resolves_field():
    out = apply_variable_mappings_dict(
        [{"agent_variable": "first_name", "source_kind": "payload", "payload_field": "fn"}],
        {"fn": "Aarti"},
    )
    assert out == {"first_name": "Aarti"}


def test_dict_static_source_passes_literal():
    out = apply_variable_mappings_dict(
        [{"agent_variable": "campaign", "source_kind": "static", "static_value": "fall-2026"}],
        {"fn": "Aarti"},
    )
    assert out == {"campaign": "fall-2026"}


def test_dict_missing_payload_field_yields_empty_string():
    out = apply_variable_mappings_dict(
        [{"agent_variable": "city", "source_kind": "payload", "payload_field": "missing"}],
        {"fn": "Aarti"},
    )
    assert out == {"city": ""}


def test_dict_empty_mappings_yields_empty_dict():
    assert apply_variable_mappings_dict([], {"fn": "Aarti"}) == {}


def test_dict_unknown_source_kind_raises():
    with pytest.raises(VariableMappingConfigError, match="source_kind"):
        apply_variable_mappings_dict(
            [{"agent_variable": "x", "source_kind": "external", "payload_field": "fn"}],
            {"fn": "Aarti"},
        )


def test_dict_missing_agent_variable_raises():
    with pytest.raises(VariableMappingConfigError, match="agent_variable"):
        apply_variable_mappings_dict(
            [{"source_kind": "payload", "payload_field": "fn"}],
            {"fn": "Aarti"},
        )


def test_list_preserves_order_and_shape():
    out = apply_variable_mappings_list(
        [
            {"agent_variable": "a", "source_kind": "payload", "payload_field": "x"},
            {"agent_variable": "b", "source_kind": "static", "static_value": "lit"},
        ],
        {"x": "1"},
    )
    assert out == [{"name": "a", "value": "1"}, {"name": "b", "value": "lit"}]


def test_list_empty_mappings_yields_empty_list():
    assert apply_variable_mappings_list([], {"fn": "Aarti"}) == []


def test_list_unknown_source_kind_raises():
    with pytest.raises(VariableMappingConfigError):
        apply_variable_mappings_list(
            [{"agent_variable": "x", "source_kind": "weird"}],
            {},
        )
