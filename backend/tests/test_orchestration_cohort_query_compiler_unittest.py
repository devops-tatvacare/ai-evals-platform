"""CTE compiler — config dict → SQL string + bind params."""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.services.orchestration.nodes._cohort_query_compiler import (
    CohortQueryCompileError,
    CohortQueryConfig,
    compile_cohort_query,
)


def _make_config(**overrides):
    base = {
        "source_table": "analytics.crm_lead_record",
        "id_column": "lead_id",
        "filters": [],
        "payload_columns": [],
        "lookback_hours": None,
        "lookback_column": None,
    }
    base.update(overrides)
    return CohortQueryConfig(**base)


def test_basic_compile_no_filters():
    cfg = _make_config(payload_columns=["first_name", "city"])
    sql, params = compile_cohort_query(
        cfg,
        run_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        workflow_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        workflow_version_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        tenant_id=uuid.UUID("44444444-4444-4444-4444-444444444444"),
        app_id="inside-sales",
        next_node_id="n_split",
    )
    assert "INSERT INTO orchestration.workflow_run_recipient_states" in sql
    assert "FROM analytics.crm_lead_record" in sql
    assert "lead_id" in sql
    assert params["run_id"] == uuid.UUID("11111111-1111-1111-1111-111111111111")
    assert params["app_id"] == "inside-sales"
    assert params["next_node_id"] == "n_split"


def test_filter_eq_renders_safe_named_param():
    cfg = _make_config(filters=[{"column": "stage", "op": "eq", "value": "warm"}])
    sql, params = compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        app_id="x", next_node_id="n1",
    )
    assert "stage = :filter_0" in sql
    assert params["filter_0"] == "warm"


def test_filter_in_renders_any_named_param():
    cfg = _make_config(filters=[{"column": "stage", "op": "in", "value": ["warm", "hot"]}])
    sql, params = compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        app_id="x", next_node_id="n1",
    )
    assert "stage = ANY(:filter_0)" in sql
    assert params["filter_0"] == ["warm", "hot"]


def test_filter_not_in_renders_all_named_param():
    cfg = _make_config(filters=[{"column": "stage", "op": "not_in", "value": ["junk", "duplicate"]}])
    sql, params = compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        app_id="x", next_node_id="n1",
    )
    assert "stage <> ALL(:filter_0)" in sql
    assert params["filter_0"] == ["junk", "duplicate"]


def test_lookback_hours_uses_now_interval():
    cfg = _make_config(lookback_hours=24, lookback_column="created_on")
    sql, _ = compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        app_id="x", next_node_id="n1",
    )
    assert "created_on >= now() - INTERVAL '24 hours'" in sql


def test_payload_columns_render_jsonb_build_object():
    cfg = _make_config(payload_columns=["first_name", "hba1c"])
    sql, _ = compile_cohort_query(
        cfg,
        run_id=uuid.uuid4(), workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        app_id="x", next_node_id="n1",
    )
    assert "jsonb_build_object" in sql
    assert "'first_name'" in sql
    assert "'hba1c'" in sql


def test_unknown_op_raises():
    """Pydantic field_validator wraps the CompileError in a ValidationError."""
    with pytest.raises((CohortQueryCompileError, ValidationError)):
        _make_config(filters=[{"column": "x", "op": "regex_match", "value": ".+"}])


def test_unsafe_column_name_rejected():
    """Defense against SQL injection — column names must be \\w+\\.?\\w*."""
    with pytest.raises((CohortQueryCompileError, ValidationError)):
        _make_config(filters=[{"column": "stage; DROP TABLE", "op": "eq", "value": "x"}])


def test_unsafe_source_table_rejected():
    with pytest.raises((CohortQueryCompileError, ValidationError)):
        _make_config(source_table="analytics.crm_lead_record; DROP TABLE x")
