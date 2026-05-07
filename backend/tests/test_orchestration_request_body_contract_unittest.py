"""Phase 11 (Commit 2) — structured request body contract tests."""
from __future__ import annotations

from app.services.orchestration.request_body_contract import (
    is_payload_reference,
    migrate_legacy_body_template,
    referenced_fields,
    resolve,
)


def test_is_payload_reference_recognises_canonical_form():
    assert is_payload_reference({"$payload": "name"}) is True
    assert is_payload_reference({"$payload": "name", "extra": 1}) is False
    assert is_payload_reference({"payload": "name"}) is False
    assert is_payload_reference("plain string") is False
    assert is_payload_reference({"$payload": 42}) is False  # value must be a string


def test_resolve_substitutes_payload_references():
    body = {
        "name": {"$payload": "first_name"},
        "score": {"$payload": "mql_score"},
        "static": "value",
        "nested": {
            "deep": {"$payload": "city"},
            "list": [{"$payload": "phone"}, "literal"],
        },
    }
    payload = {"first_name": "Aarti", "mql_score": 5, "city": "Mumbai", "phone": "+91"}
    out = resolve(body, payload)
    assert out == {
        "name": "Aarti",
        "score": 5,
        "static": "value",
        "nested": {
            "deep": "Mumbai",
            "list": ["+91", "literal"],
        },
    }


def test_missing_field_resolves_to_none():
    body = {"name": {"$payload": "first_name"}, "phone": {"$payload": "phone"}}
    out = resolve(body, {"first_name": "Aarti"})
    assert out == {"name": "Aarti", "phone": None}


def test_referenced_fields_collects_all_payload_keys():
    body = {
        "a": {"$payload": "x"},
        "b": [{"$payload": "y"}, {"c": {"$payload": "z"}}],
        "lit": 1,
    }
    assert referenced_fields(body) == {"x", "y", "z"}


def test_migrate_json_template_promotes_whole_string_tokens():
    legacy = '{"recipient": "{{recipient_id}}", "name": "{{first_name}}", "static": "v"}'
    body = migrate_legacy_body_template(legacy)
    assert body == {
        "recipient": {"$payload": "recipient_id"},
        "name": {"$payload": "first_name"},
        "static": "v",
    }


def test_migrate_preserves_partial_token_strings():
    """A string with a token embedded in extra text is not safely a
    single payload reference — preserve the legacy template literally
    so the operator can re-author it."""
    legacy = '{"greeting": "hi {{first_name}}!"}'
    body = migrate_legacy_body_template(legacy)
    # Inner string keeps its template form (still legacy substitution).
    assert body == {"greeting": "hi {{first_name}}!"}


def test_migrate_non_json_template_falls_back_to_string():
    legacy = "this is plain text {{var}} with tokens"
    body = migrate_legacy_body_template(legacy)
    assert body == legacy


def test_migrate_empty_template_returns_empty_string():
    assert migrate_legacy_body_template("") == ""
    assert migrate_legacy_body_template("   ") == ""
