"""Sherlock v3 — agent-to-agent runtime.

Lives in its own package so the v2 surfaces (``chat_engine``,
``report_builder.chat_handler``) can be deleted in P5 without touching v3
code. See ``docs/specs/2026-04-26-sherlock-v3-architecture.md`` for the full
design — this package implements §3 (component map), §5 (data contracts),
§10 (specialist contract), and §11 (SDK wiring).
"""
