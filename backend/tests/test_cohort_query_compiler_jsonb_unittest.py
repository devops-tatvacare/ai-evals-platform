"""Phase 12 / Task 6 — cohort-query compiler JSONB branch.

Pure SQL-string assertions on the dataset-source branch. Builds a
``DatasetSource`` value object directly (no DB) and feeds it into
``compile_cohort_query`` via the new ``resolved_source`` parameter. Every
emitted JSONB-path filter is asserted by exact substring so a downstream
consumer can rely on the shape (alias ``src``, ``recipient_id::text`` cast,
``orchestration.cohort_dataset_rows`` schema-qualified table).

Includes a regression test for the static branch that pins today's bare-
column SQL — refactor safety net.
"""
from __future__ import annotations

import uuid

import pytest

from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryCompileError,
    CohortQueryConfig,
    compile_cohort_query,
    jsonb_column_resolver,
)
from app.services.orchestration.source_catalog import (
    CohortSource,
    DatasetSource,
)


# ─── helpers ───────────────────────────────────────────────────────────────


_VERSION_ID = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
_DATASET_ID = uuid.UUID("11112222-3333-4444-5555-666677778888")


def _dataset_source(columns: list[dict]) -> DatasetSource:
    return DatasetSource(
        source_ref=f"dataset.{_VERSION_ID}",
        dataset_id=_DATASET_ID,
        dataset_version_id=_VERSION_ID,
        display_label="test (v1)",
        workflow_types=["*"],
        app_id="inside-sales",
        id_strategy="column",
        id_column="recipient_id",
        schema_descriptor={"columns": columns, "row_count": 0},
    )


def _compile(cfg: CohortQueryConfig, source: DatasetSource | CohortSource):
    return compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(),
        workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        app_id="inside-sales",
        next_node_id="n1",
        resolved_source=source,
    )


# ─── 1. Dataset, no filters ────────────────────────────────────────────────


def test_dataset_no_filters_emits_basic_select():
    src = _dataset_source([
        {"name": "phone", "type": "string"},
    ])
    cfg = CohortQueryConfig(source_ref=src.source_ref)
    sql, params = _compile(cfg, src)

    assert "INSERT INTO orchestration.workflow_run_recipient_states" in sql
    assert "FROM orchestration.cohort_dataset_rows src" in sql
    assert "src.recipient_id::text" in sql
    assert "src.payload" in sql
    # The two mandatory predicates always present.
    assert "src.dataset_version_id = (:dataset_version_id)::uuid" in sql
    assert "src.tenant_id = (:tenant_id)::uuid" in sql
    assert params["dataset_version_id"] == _VERSION_ID


# ─── 2-5. Type-aware JSONB casts ───────────────────────────────────────────


def test_dataset_filter_integer_emits_bigint_cast():
    src = _dataset_source([
        {"name": "mql_score", "type": "integer"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "mql_score", "op": "gte", "value": 70}],
    )
    sql, params = _compile(cfg, src)
    assert "NULLIF(src.payload->>'mql_score', '')::bigint >= :filter_0" in sql
    assert params["filter_0"] == 70


def test_dataset_filter_string_emits_text_cast():
    src = _dataset_source([
        {"name": "city", "type": "string"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "city", "op": "eq", "value": "Mumbai"}],
    )
    sql, params = _compile(cfg, src)
    assert "(src.payload->>'city')::text = :filter_0" in sql
    assert params["filter_0"] == "Mumbai"


def test_dataset_filter_boolean_emits_boolean_cast():
    src = _dataset_source([
        {"name": "active", "type": "boolean"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "active", "op": "eq", "value": True}],
    )
    sql, _ = _compile(cfg, src)
    assert "NULLIF(src.payload->>'active', '')::boolean = :filter_0" in sql


def test_dataset_filter_datetime_emits_timestamptz_cast():
    src = _dataset_source([
        {"name": "first_seen_at", "type": "datetime"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[
            {"column": "first_seen_at", "op": "gte", "value": "2026-01-01"},
        ],
    )
    sql, _ = _compile(cfg, src)
    assert "NULLIF(src.payload->>'first_seen_at', '')::timestamptz >= :filter_0" in sql


def test_dataset_filter_number_emits_numeric_cast():
    src = _dataset_source([
        {"name": "price", "type": "number"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "price", "op": "lt", "value": 9.99}],
    )
    sql, _ = _compile(cfg, src)
    assert "NULLIF(src.payload->>'price', '')::numeric < :filter_0" in sql


def test_dataset_filter_unknown_type_falls_back_to_text():
    src = _dataset_source([
        {"name": "weird", "type": "spaceship"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "weird", "op": "eq", "value": "x"}],
    )
    sql, _ = _compile(cfg, src)
    assert "(src.payload->>'weird')::text = :filter_0" in sql


# ─── 6. Unknown column raises ──────────────────────────────────────────────


def test_dataset_filter_unknown_column_raises_compile_error():
    src = _dataset_source([
        {"name": "phone", "type": "string"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        filters=[{"column": "not_a_column", "op": "eq", "value": "x"}],
    )
    with pytest.raises(CohortQueryCompileError, match="unknown filter column"):
        _compile(cfg, src)


# ─── 7. Static branch regression ───────────────────────────────────────────


def test_static_branch_unaffected_when_resolved_source_is_cohort_source():
    """Passing a CohortSource produces the same SQL the legacy path produces.

    Pinning this guards against the refactor accidentally rerouting static
    sources through the JSONB emitter.
    """
    static = CohortSource(
        source_ref="crm.lead_record",
        display_label="x",
        description="x",
        workflow_types=["crm"],
        app_ids=["inside-sales"],
        schema_qualified_table="analytics.crm_lead_record",
        id_column="prospect_id",
        allowed_filter_columns=["mql_score"],
    )
    cfg = CohortQueryConfig(
        source_ref="crm.lead_record",
        filters=[{"column": "mql_score", "op": "gte", "value": 70}],
    )
    sql, params = _compile(cfg, static)
    # Bare-column SQL — NOT the JSONB path.
    assert "src.mql_score >= :filter_0" in sql
    assert "src.payload->>" not in sql
    assert "FROM analytics.crm_lead_record src" in sql
    assert "src.prospect_id::text" in sql
    assert params["filter_0"] == 70


# ─── 8. v1 limitations on dataset branch ───────────────────────────────────


def test_dataset_lookback_hours_emits_jsonb_datetime_filter():
    src = _dataset_source([
        {"name": "first_seen_at", "type": "datetime"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        lookback_hours=24,
        lookback_column="first_seen_at",
    )
    sql, _ = _compile(cfg, src)
    assert (
        "NULLIF(src.payload->>'first_seen_at', '')::timestamptz "
        ">= now() - INTERVAL '24 hours'"
    ) in sql


def test_dataset_lookback_hours_rejects_non_datetime_column():
    src = _dataset_source([
        {"name": "city", "type": "string"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        lookback_hours=24,
        lookback_column="city",
    )
    with pytest.raises(CohortQueryCompileError, match="datetime"):
        _compile(cfg, src)


def test_dataset_consent_gate_rejected_in_v1():
    src = _dataset_source([
        {"name": "phone", "type": "string"},
    ])
    cfg = CohortQueryConfig(
        source_ref=src.source_ref,
        consent_gate_channel="whatsapp",
    )
    with pytest.raises(CohortQueryCompileError, match="consent_gate_channel"):
        _compile(cfg, src)


# ─── 9. Standalone resolver helper ─────────────────────────────────────────


def test_jsonb_column_resolver_round_trip():
    resolver = jsonb_column_resolver({
        "n": "integer",
        "s": "string",
        "b": "boolean",
        "t": "datetime",
        "u": "spaceship",  # unknown → text fallback
    })
    assert resolver("n") == "NULLIF(src.payload->>'n', '')::bigint"
    assert resolver("s") == "(src.payload->>'s')::text"
    assert resolver("b") == "NULLIF(src.payload->>'b', '')::boolean"
    assert resolver("t") == "NULLIF(src.payload->>'t', '')::timestamptz"
    assert resolver("u") == "(src.payload->>'u')::text"
    with pytest.raises(CohortQueryCompileError):
        resolver("missing")


# ─── 10. Unknown ResolvedSource shape ──────────────────────────────────────


def test_unknown_resolved_source_type_raises():
    cfg = CohortQueryConfig(source_ref="x")
    with pytest.raises(CohortQueryCompileError, match="unknown resolved source type"):
        compile_cohort_query(
            cfg,
            run_id=uuid.uuid4(),
            workflow_id=uuid.uuid4(),
            workflow_version_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            app_id="x",
            next_node_id="n1",
            resolved_source="not-a-source",  # type: ignore[arg-type]
        )
