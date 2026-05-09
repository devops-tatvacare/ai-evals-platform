"""Chat-engine library — manifest, chart pipeline, and SQL safety helpers.

This package no longer hosts the v2 chat agent (deleted in the v3 cutover).
What remains is shared library code consumed by Sherlock v3 and the
analytics surfaces:

- ``manifest`` / ``manifest_validator`` / ``comment_emitter`` — manifest
  loading, validation, and ``COMMENT ON COLUMN`` sync.
- ``capability_pack`` — pack/tool registry consumed by contract_stub and
  stub_vector packs.
- ``chartability_gate`` / ``chart_type_picker`` / ``result_set_typer`` /
  ``vega_lite_emitter`` / ``reason_codes`` — the chart pipeline.
- ``sql_agent`` — SQL validation/preparation/execution helpers
  (``validate_sql``, ``prepare_query``, ``execute_query``, schema
  helpers). The ``generate_sql`` LLM path was removed; v3's data
  specialist generates SQL inline via the Agents SDK.
"""
from __future__ import annotations
