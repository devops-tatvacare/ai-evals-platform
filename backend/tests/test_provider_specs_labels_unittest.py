"""Phase 13 / Phase A: every provider field carries professional UI labels.

The connection form (DynamicConfigForm) renders ``prop.title`` as the field
label. Before Phase A, raw keys like ``api_key`` / ``from_phone`` reached the
operator. This test locks in the contract that every spec field has a
non-empty ``title`` and ``description`` and that titles read as Title Case
sentences (no snake_case bleed-through).
"""
from __future__ import annotations

import pytest

from app.services.orchestration.connections.provider_specs import (
    PROVIDER_SPECS,
    to_json_schema,
)


def _is_title_cased(s: str) -> bool:
    """Permissive title-case: every word starts with a capital letter or
    is an allowed lowercase short connector / acronym fragment.

    Acronyms like ``API``, ``URL``, ``ID``, ``DLT`` are explicitly allowed.
    Short connectors (``of``, ``the``, ``and``, ``or``, ``for``) may stay
    lowercase mid-title.
    """
    allowed_lowercase = {"of", "the", "and", "or", "for", "to"}
    words = s.split()
    if not words:
        return False
    for idx, word in enumerate(words):
        # First word must start with an uppercase letter or be an all-caps
        # acronym.
        if idx == 0:
            if not (word[0].isupper() or word.isupper()):
                return False
            continue
        if word.lower() in allowed_lowercase:
            continue
        if not (word[0].isupper() or word.isupper()):
            return False
    return True


def test_every_provider_field_has_title_and_description():
    for provider, spec in PROVIDER_SPECS.items():
        for field in spec.fields:
            assert field.title, f"{provider}.{field.name}: title must be non-empty"
            assert field.description, (
                f"{provider}.{field.name}: description must be non-empty"
            )


@pytest.mark.parametrize("provider", sorted(PROVIDER_SPECS.keys()))
def test_titles_are_title_cased(provider: str):
    spec = PROVIDER_SPECS[provider]
    for field in spec.fields:
        assert _is_title_cased(field.title), (
            f"{provider}.{field.name}: title {field.title!r} is not Title Cased"
        )


@pytest.mark.parametrize("provider", sorted(PROVIDER_SPECS.keys()))
def test_json_schema_emits_title(provider: str):
    schema = to_json_schema(provider)
    for key, prop in schema["properties"].items():
        assert prop.get("title"), (
            f"{provider}.{key}: emitted JSON Schema property must include 'title'"
        )


def test_wati_channel_numbers_is_optional_string_array():
    schema = to_json_schema("wati")
    prop = schema["properties"]["channel_numbers"]
    assert prop["type"] == "array"
    assert prop["items"]["type"] == "string"
    # Items carry an ``x-format: e164`` hint so the form can render an inline
    # validation error per Phase A.2.
    assert prop["items"].get("x-format") == "e164"
    assert "channel_numbers" not in schema["required"]


def test_bolna_from_phone_is_optional():
    schema = to_json_schema("bolna")
    assert "from_phone" in schema["properties"]
    assert "from_phone" not in schema["required"]
