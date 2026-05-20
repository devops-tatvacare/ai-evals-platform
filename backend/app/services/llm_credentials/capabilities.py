"""Compute capability tags from a catalog row.

Reads only ``analytics.ref_llm_models_catalog`` columns — no hardcoded provider
allowlists. Capability data is sourced from ``models_dev_refresh.apply_refresh``
at lifespan boot (via ``ensure_catalog_loaded``) and on cron; no committed-to-
code seed claims authority over capability flags.

NULL vs False distinction matters: a NULL ``supports_*`` flag means "upstream
hasn't told us yet" (e.g. the row was inserted by a migration that ran before
the refresh column existed, or models.dev doesn't expose that field for the
model). A FALSE flag means "upstream confirms this model does not support the
capability." ``compute_capabilities`` is the strict reader — it emits a tag
only when the flag is truthy. ``unknown_capabilities`` returns the set of
flags whose backing value is None so callers can show a "refresh me" hint
instead of a flat "doesn't support" error.
"""
from __future__ import annotations

from app.models.cost import RefLlmModelsCatalog


# Mapping of capability tag → column accessor. Keeps the two helpers in sync
# and gives a single place to add new capability columns.
_BOOLEAN_FLAG_MAP = {
    "reasoning": "supports_reasoning",
    "tool_call": "supports_tool_call",
    "attachment": "supports_attachment",
    "structured_output": "supports_structured_output",
}


def compute_capabilities(catalog_row: RefLlmModelsCatalog) -> frozenset[str]:
    """Return the capability tag set for one catalog row.

    Tag list mirrors ``CAPABILITY_VOCABULARY`` in
    ``app.services.llm_credentials.call_sites``. Any new tag must be added in
    both places (and the call-site spec validators will fail loudly if not).

    NULL ``supports_*`` flags are NOT emitted as tags. See
    ``unknown_capabilities`` for the inverse — operators use that to tell
    apart "upstream said false" from "upstream hasn't said yet."
    """
    tags: set[str] = set()
    inputs = set(catalog_row.modalities_input or [])
    outputs = set(catalog_row.modalities_output or [])

    if "text" in inputs:
        tags.add("text_input")
    if "text" in outputs:
        tags.add("text_output")
    if "image" in inputs:
        tags.add("image_input")
    if "audio" in inputs:
        tags.add("audio_input")
    if "audio" in outputs:
        tags.add("audio_output")
    if "video" in inputs:
        tags.add("video_input")
    if "pdf" in inputs:
        tags.add("pdf_input")

    for tag, column in _BOOLEAN_FLAG_MAP.items():
        value = getattr(catalog_row, column, None)
        if value is True:
            tags.add(tag)

    return frozenset(tags)


def unknown_capabilities(catalog_row: RefLlmModelsCatalog) -> frozenset[str]:
    """Return the set of capability tags whose backing flag is NULL.

    Resolver uses this to enrich the ``CallSiteCapabilityMismatch`` message:
    a tag in ``unknown_capabilities`` means "refresh the catalog from models.dev
    — we don't know yet"; a tag NOT in this set and NOT in
    ``compute_capabilities`` means "upstream confirmed the model lacks it."

    Only the boolean flag columns can be unknown today — modalities are
    array columns and default to ``[]`` (interpreted as "no modalities"
    rather than "modalities unknown"). If we ever need to distinguish the
    empty-array case as unknown, add the column to ``_BOOLEAN_FLAG_MAP``
    equivalent for arrays.
    """
    out: set[str] = set()
    for tag, column in _BOOLEAN_FLAG_MAP.items():
        if getattr(catalog_row, column, None) is None:
            out.add(tag)
    return frozenset(out)
