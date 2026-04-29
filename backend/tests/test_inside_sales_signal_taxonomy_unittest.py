"""Tests for the inside-sales signal taxonomy + populator extraction.

Roadmap 01 §7 / §8.4 / §8.5 invariants exercised here:

  - Controlled-vocabulary canonical types are returned verbatim.
  - Unknown labels coerce to ``other_notable_signal`` and preserve the
    raw label in ``attributes.signal_type_raw``.
  - The runner's ``merge_thread_signals`` produces one canonical
    deduped array from per-evaluator outputs.
  - The runner's ``_augment_output_schema_with_signals`` does not
    mutate the original output_schema.
  - The populator's ``build_signal_rows`` reads only top-level
    ``result.signals`` and emits one fact row per entry, with
    ``ordinal`` tracking array index.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.analytics.signal_extractor import build_signal_rows
from app.services.analytics.signal_taxonomy import (
    OTHER_SIGNAL_TYPE,
    SIGNAL_TYPES,
    coerce_signal_type,
)
from app.services.evaluators.inside_sales_runner import (
    _augment_output_schema_with_signals,
    merge_thread_signals,
)


def test_known_signal_types_returned_verbatim():
    label, attrs = coerce_signal_type("followup_call_commitment")
    assert label == "followup_call_commitment"
    assert "signal_type_raw" not in attrs


def test_unknown_signal_type_coerces_and_preserves_raw():
    label, attrs = coerce_signal_type("brand_new_signal_kind")
    assert label == OTHER_SIGNAL_TYPE
    assert attrs["signal_type_raw"] == "brand_new_signal_kind"


def test_blank_signal_type_drops_to_other_with_no_raw():
    label, attrs = coerce_signal_type("   ")
    assert label == OTHER_SIGNAL_TYPE
    assert "signal_type_raw" not in attrs


def test_taxonomy_includes_required_canonical_types():
    # A small load-bearing subset; full vocabulary lives in §7.
    for required in {
        "followup_call_commitment",
        "objection",
        "outcome",
        "purchase_intent",
        OTHER_SIGNAL_TYPE,
    }:
        assert required in SIGNAL_TYPES


def test_augment_output_schema_appends_signals_without_mutating_original():
    original = [{"key": "overall_score", "type": "number"}]
    augmented = _augment_output_schema_with_signals(original)
    assert [f["key"] for f in original] == ["overall_score"], (
        "original output_schema must not be mutated"
    )
    assert [f["key"] for f in augmented] == ["overall_score", "signals"]
    assert augmented[-1]["type"] == "array"


def test_merge_thread_signals_dedupes_across_evaluators():
    eval_outputs = [
        {
            "evaluator_id": "ev1",
            "output": {
                "signals": [
                    {"signal_type": "objection", "signal_value": "price"},
                    {"signal_type": "objection", "signal_value": "price"},
                    {
                        "signal_type": "outcome",
                        "signal_value": "interested",
                        "supporting_quote": "Yes I'd like to enroll",
                    },
                ],
            },
        },
        {
            "evaluator_id": "ev2",
            "output": {
                "signals": [
                    # Duplicate of ev1's outcome.
                    {
                        "signal_type": "outcome",
                        "signal_value": "interested",
                        "supporting_quote": "Yes I'd like to enroll",
                    },
                    # New signal.
                    {"signal_type": "purchase_intent", "signal_value": "hot"},
                ],
            },
        },
    ]
    merged = merge_thread_signals(eval_outputs)
    types_values = [(s["signal_type"], s["signal_value"]) for s in merged]
    assert types_values == [
        ("objection", "price"),
        ("outcome", "interested"),
        ("purchase_intent", "hot"),
    ]


def test_merge_thread_signals_drops_entries_without_signal_type():
    eval_outputs = [
        {
            "output": {
                "signals": [
                    {"signal_type": "  ", "signal_value": "noise"},
                    {"signal_value": "no type at all"},
                    {"signal_type": "objection", "signal_value": "price"},
                ],
            },
        },
    ]
    merged = merge_thread_signals(eval_outputs)
    assert [s["signal_type"] for s in merged] == ["objection"]


def test_build_signal_rows_reads_only_top_level_signals():
    """Populator MUST NOT read nested per-evaluator copies (§8.4 / §8.5)."""
    run_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    thread_id = 101
    run = SimpleNamespace(
        id=run_id,
        tenant_id=tenant_id,
        app_id="inside-sales",
        eval_type="call_quality",
    )
    thread = SimpleNamespace(
        id=thread_id,
        thread_id="LSQ-ACT-1",
        result={
            # Top-level canonical array — this is what should be read.
            "signals": [
                {"signal_type": "objection", "signal_value": "price"},
                {"signal_type": "outcome", "signal_value": "interested"},
            ],
            # Nested per-evaluator copies — must NOT contribute.
            "evaluations": [
                {
                    "output": {
                        "signals": [
                            {"signal_type": "purchase_intent", "signal_value": "hot"},
                        ],
                    },
                }
            ],
            "call_metadata": {"prospect_id": "PROS-7"},
        },
    )
    rows = build_signal_rows(run, [thread])
    assert [r["signal_type"] for r in rows] == ["objection", "outcome"]
    assert [r["ordinal"] for r in rows] == [0, 1]
    # Lead linkage + activity linkage propagated from result + thread.
    assert all(r["lead_id"] == "PROS-7" for r in rows)
    assert all(r["source_activity_id"] == "LSQ-ACT-1" for r in rows)
    assert all(r["tenant_id"] == tenant_id for r in rows)
    assert all(r["eval_run_id"] == run_id for r in rows)
    assert all(r["thread_evaluation_id"] == thread_id for r in rows)


def test_build_signal_rows_coerces_unknown_signal_type():
    run = SimpleNamespace(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        eval_type="call_quality",
    )
    thread = SimpleNamespace(
        id=303,
        thread_id="ACT-9",
        result={
            "signals": [
                {"signal_type": "totally_unknown_kind", "signal_value": "?"},
            ],
            "call_metadata": {"prospect_id": "P-99"},
        },
    )
    rows = build_signal_rows(run, [thread])
    assert len(rows) == 1
    assert rows[0]["signal_type"] == OTHER_SIGNAL_TYPE
    assert rows[0]["attributes"]["signal_type_raw"] == "totally_unknown_kind"


def test_build_signal_rows_empty_when_no_top_level_signals():
    run = SimpleNamespace(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        eval_type="call_quality",
    )
    thread = SimpleNamespace(
        id=404,
        thread_id="ACT-X",
        result={
            "evaluations": [{"output": {"signals": [{"signal_type": "objection"}]}}],
            "call_metadata": {"prospect_id": "P-1"},
        },
    )
    assert build_signal_rows(run, [thread]) == []


def test_build_signal_rows_parses_signal_at_iso_with_z():
    run = SimpleNamespace(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        eval_type="call_quality",
    )
    thread = SimpleNamespace(
        id=505,
        thread_id="ACT-T",
        result={
            "signals": [
                {
                    "signal_type": "followup_call_commitment",
                    "signal_at": "2026-04-29T10:30:00Z",
                }
            ],
            "call_metadata": {"prospect_id": "P-2"},
        },
    )
    rows = build_signal_rows(run, [thread])
    assert rows[0]["signal_at"] == datetime(2026, 4, 29, 10, 30, tzinfo=timezone.utc)
