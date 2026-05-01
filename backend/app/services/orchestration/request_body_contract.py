"""Phase 11 — structured request body contract for ``core.webhook_out`` and other
outbound HTTP nodes.

Replaces the legacy ``body_template: str`` (``{{var}}`` substitution) with a
typed JSON-shaped object whose leaves are either:

  - JSON literals (strings, numbers, booleans, null, nested objects, arrays), or
  - field references of the form ``{"$payload": "field_name"}``

Resolution turns a structured body + recipient payload into the JSON
object handed to the HTTP client. Missing fields render as ``null`` (an
explicit choice — silently skipping or stringifying ``None`` was the
behavior of the legacy template and led to invalid JSON downstream).

Used by:
  - ``nodes/core_webhook_out.py``                  — render request bodies
  - ``definition_normalizer.py``                   — migrate legacy
    ``body_template`` strings into the structured shape
"""
from __future__ import annotations

import json
from typing import Any


_PAYLOAD_REF_KEY = "$payload"


def is_payload_reference(node: Any) -> bool:
    """True iff ``node`` is a single-key dict with the ``$payload`` reference."""
    return (
        isinstance(node, dict)
        and len(node) == 1
        and _PAYLOAD_REF_KEY in node
        and isinstance(node[_PAYLOAD_REF_KEY], str)
    )


def referenced_fields(body: Any) -> set[str]:
    """Set of recipient payload fields read by ``body``. Used by the validator
    to surface required-payload-fields metadata for the descriptor."""
    out: set[str] = set()
    _collect_refs(body, out)
    return out


def _collect_refs(node: Any, into: set[str]) -> None:
    if is_payload_reference(node):
        into.add(node[_PAYLOAD_REF_KEY])
        return
    if isinstance(node, dict):
        for v in node.values():
            _collect_refs(v, into)
        return
    if isinstance(node, list):
        for v in node:
            _collect_refs(v, into)


def resolve(body: Any, payload: dict[str, Any]) -> Any:
    """Render ``body`` against the recipient ``payload``.

    Field references are replaced with the corresponding payload value;
    missing fields render as ``None`` (Python null → JSON null when
    serialized). Nested objects and arrays are walked recursively.
    Literals pass through unchanged.
    """
    if is_payload_reference(body):
        return payload.get(body[_PAYLOAD_REF_KEY])
    if isinstance(body, dict):
        return {k: resolve(v, payload) for k, v in body.items()}
    if isinstance(body, list):
        return [resolve(v, payload) for v in body]
    return body


def migrate_legacy_body_template(body_template: str) -> Any:
    """Return a structured body that mimics the legacy ``{{var}}`` template.

    Two cases:
      1. The template is valid JSON whose string leaves contain ``{{var}}``
         tokens. We try to parse the JSON and rewrite each leaf:
           - if the leaf is exactly ``"{{name}}"``, replace with
             ``{"$payload": "name"}`` so non-string values render correctly;
           - leaves containing tokens but not the whole string remain as
             the (still-templated) string for back-compat.
      2. The template is *not* valid JSON. We can't safely structure it,
         so we wrap the whole template as a single string body — the
         caller is expected to flag this for re-authoring.

    The migration is best-effort and intentionally conservative: when in
    doubt, preserve the literal template. See Phase 11 §11 — we do not
    silently reinterpret invalid saved definitions; flag and require re-save.
    """
    text = body_template.strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return body_template  # caller decides how to flag this
    return _rewrite_string_leaves(parsed)


def _rewrite_string_leaves(node: Any) -> Any:
    if isinstance(node, str):
        # Exactly one whole-string token — promote to a payload reference.
        if node.startswith("{{") and node.endswith("}}") and "{{" not in node[2:-2]:
            return {_PAYLOAD_REF_KEY: node[2:-2].strip()}
        return node
    if isinstance(node, dict):
        return {k: _rewrite_string_leaves(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_rewrite_string_leaves(v) for v in node]
    return node


__all__ = [
    "is_payload_reference",
    "referenced_fields",
    "resolve",
    "migrate_legacy_body_template",
]
