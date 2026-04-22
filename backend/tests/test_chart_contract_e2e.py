"""Phase 2.5 — data_query() normalizes every success path to a JSON-safe typed
result contract (`typed_columns`), across common-query / cache-hit /
fresh-query / retry branches.

Audit-knot #2 / #4: the tool-boundary transport must be JSON-safe, and all
success paths must produce the same shape. No live ``_typed_result_set``
Python object may survive ``dispatch_tool_call``.
"""
from __future__ import annotations

import copy
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services.chat_engine import sql_agent


class _FakeAnalyticsSession:
    def __init__(self, db: Mock) -> None:
        self._db = db

    async def __aenter__(self) -> Mock:
        return self._db

    async def __aexit__(self, *exc_info) -> None:
        return None


def _auth() -> SimpleNamespace:
    return SimpleNamespace(
        tenant_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        email="u@x.com",
        role_id=uuid.uuid4(),
        is_owner=True,
        permissions=frozenset(),
        app_access=frozenset({"kaira-bot"}),
    )


_FAKE_GEN_RESULT = {
    "sql": "SELECT evaluator_name, AVG(result_score) AS avg_score "
           "FROM analytics_eval_facts GROUP BY 1",
    "chart_title": "Avg score",
    "output_columns": [
        {
            "alias": "evaluator_name",
            "role_hint": "dimension",
            "type_hint": "nominal",
            "source_column": "analytics_eval_facts.evaluator_name",
        },
        {
            "alias": "avg_score",
            "role_hint": "measure",
            "type_hint": "quantitative",
            "semantic_type_hint": "score",
        },
    ],
}


def _patches(rows, gen_result=None, cached=None, match_common=None):
    app_db = AsyncMock()
    analytics_db = Mock()
    analytics_db.commit = AsyncMock()
    analytics_db.rollback = AsyncMock()
    return [
        patch("app.services.chat_engine.sql_agent.load_app_config",
              new=AsyncMock(return_value={})),
        patch("app.services.chat_engine.sql_agent.load_semantic_model",
              return_value={}),
        patch("app.services.chat_engine.sql_agent._match_common_query",
              return_value=match_common),
        patch("app.services.chat_engine.sql_agent._expand_run_id_prefixes",
              new=AsyncMock(side_effect=lambda q, **_kw: q)),
        patch("app.services.chat_engine.sql_agent.generate_sql",
              new=AsyncMock(return_value=copy.deepcopy(gen_result)
                            if gen_result else copy.deepcopy(_FAKE_GEN_RESULT))),
        patch("app.services.chat_engine.sql_agent._get_cache",
              new=AsyncMock(return_value=cached)),
        patch("app.services.chat_engine.sql_agent._check_query_cost",
              new=AsyncMock()),
        patch("app.services.chat_engine.sql_agent.execute_query",
              new=AsyncMock(return_value=rows)),
        patch("app.services.chat_engine.sql_agent._set_cache",
              new=AsyncMock()),
        patch("app.database.analytics_session",
              return_value=_FakeAnalyticsSession(analytics_db)),
        patch("app.services.chat_engine.sql_agent.validate_sql_columns_against_manifest"),
        patch("app.services.chat_engine.sql_agent.validate_sql",
              side_effect=lambda sql, **_kw: sql),
        patch("app.services.chat_engine.sql_agent.prepare_query",
              side_effect=lambda sql, *_a, **_kw: (sql, {"tenant_id": "t", "app_id": "kaira-bot"})),
    ], app_db


@pytest.mark.asyncio
async def test_data_query_fresh_branch_includes_typed_columns() -> None:
    rows = [
        {"evaluator_name": "E1", "avg_score": 0.82},
        {"evaluator_name": "E2", "avg_score": 0.91},
    ]
    patches, app_db = _patches(rows)
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patches[5], patches[6], patches[7], patches[8], patches[9], \
         patches[10], patches[11], patches[12]:
        result = await sql_agent.data_query(
            question="avg score by evaluator",
            db=app_db,
            auth=_auth(),
            app_id="kaira-bot",
            provider="openai",
        )

    assert result["status"] == "ok"
    assert "typed_columns" in result
    assert "_typed_result_set" not in result  # audit knot #2
    typed_names = {c["name"] for c in result["typed_columns"]}
    assert typed_names == {"evaluator_name", "avg_score"}
    avg = next(c for c in result["typed_columns"] if c["name"] == "avg_score")
    assert avg["role"] == "measure"
    assert avg["data_type"] == "quantitative"
    assert avg["semantic_type"] == "score"
    # output_columns propagates to the result for replay + scratchpad hints.
    assert "output_columns" in result


@pytest.mark.asyncio
async def test_data_query_cache_hit_branch_includes_typed_columns() -> None:
    rows = [{"evaluator_name": "E1", "avg_score": 0.82}]
    cached = {"data": rows, "row_count": len(rows)}
    patches, app_db = _patches(rows, cached=cached)
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patches[5], patches[6], patches[7], patches[8], patches[9], \
         patches[10], patches[11], patches[12]:
        result = await sql_agent.data_query(
            question="avg score",
            db=app_db,
            auth=_auth(),
            app_id="kaira-bot",
        )

    assert result["status"] == "ok"
    assert result["cache_hit"] is True
    assert "typed_columns" in result
    assert "_typed_result_set" not in result


@pytest.mark.asyncio
async def test_data_query_common_query_branch_includes_typed_columns() -> None:
    rows = [{"evaluator_name": "E1", "avg_score": 0.82}]
    common_sql = "SELECT evaluator_name, avg_score FROM analytics_eval_facts"
    patches, app_db = _patches(rows, match_common=common_sql)
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patches[5], patches[6], patches[7], patches[8], patches[9], \
         patches[10], patches[11], patches[12]:
        result = await sql_agent.data_query(
            question="common evaluator query",
            db=app_db,
            auth=_auth(),
            app_id="kaira-bot",
        )

    assert result["status"] == "ok"
    assert "typed_columns" in result
    assert "_typed_result_set" not in result


@pytest.mark.asyncio
async def test_data_query_drops_chart_options_after_phase5_cleanup() -> None:
    """Phase 5 removed the back-compat ``chart_options`` shim. The scratchpad
    now derives its summary from ``typed_columns`` via the chartability gate,
    so no consumer still reads ``chart_options`` on the tool-result envelope."""
    rows = [{"evaluator_name": "E1", "avg_score": 0.82}]
    patches, app_db = _patches(rows)
    with patches[0], patches[1], patches[2], patches[3], patches[4], \
         patches[5], patches[6], patches[7], patches[8], patches[9], \
         patches[10], patches[11], patches[12]:
        result = await sql_agent.data_query(
            question="x",
            db=app_db,
            auth=_auth(),
            app_id="kaira-bot",
        )
    assert "chart_options" not in result
    # And the new typed contract is still present.
    assert "typed_columns" in result


# ── Phase 3.4 — orchestrator coverage ────────────────────────────────
# ``_build_chart_payload`` reconstructs a TypedResultSet from the JSON-safe
# ``typed_columns + data`` carried across the tool boundary (audit-knot #2),
# runs the gate → picker → emitter, and returns the discriminated union.

from dataclasses import asdict

from app.services.chat_engine.result_set_typer import (
    TypedColumn as _PhaseTC,
    TypedResultSet as _PhaseTRS,
)
from app.services.report_builder.chat_handler import _build_chart_payload


def _result_from_typed(typed: _PhaseTRS, rows: list[dict]) -> dict:
    return {
        "status": "ok",
        "data": rows,
        "typed_columns": [asdict(c) for c in typed.columns],
        "sql_used": "SELECT ...",
        "question": "test",
    }


def test_build_chart_payload_chart_kind() -> None:
    # ``score`` (not ``percent``) is deliberately used so the picker does
    # not interpret this as part-of-whole and emit a pie.
    typed = _PhaseTRS(
        columns=[
            _PhaseTC(
                name="evaluator",
                role="dimension",
                data_type="nominal",
                semantic_type="category",
                cardinality=2,
                null_frac=0,
                is_constant=False,
            ),
            _PhaseTC(
                name="avg_score",
                role="measure",
                data_type="quantitative",
                semantic_type="score",
                cardinality=2,
                null_frac=0,
                is_constant=False,
            ),
        ],
        rows=[{"evaluator": "E1", "avg_score": 0.8}, {"evaluator": "E2", "avg_score": 0.6}],
    )
    out = _build_chart_payload(_result_from_typed(typed, typed.rows))
    assert out is not None
    assert out["kind"] == "chart"
    assert out["spec"]["mark"] == "bar"
    assert out["data"] == typed.rows
    assert out["sql_query"] == "SELECT ..."


def test_build_chart_payload_table_kind_on_degenerate_measure() -> None:
    typed = _PhaseTRS(
        columns=[
            _PhaseTC(
                name="thread_id",
                role="identifier",
                data_type="nominal",
                semantic_type="id_hash",
                cardinality=3,
                null_frac=0,
                is_constant=False,
            ),
            _PhaseTC(
                name="is_failed",
                role="measure",
                data_type="quantitative",
                semantic_type="count",
                cardinality=1,
                null_frac=0,
                is_constant=True,
            ),
        ],
        rows=[{"thread_id": f"t{i}", "is_failed": 1} for i in range(3)],
    )
    out = _build_chart_payload(_result_from_typed(typed, typed.rows))
    assert out is not None
    assert out["kind"] == "table"
    assert out["reason_code"] == "CG_DEGENERATE_MEASURE"
    assert "warning" in out and out["warning"]


def test_build_chart_payload_kpi_kind_on_single_value() -> None:
    typed = _PhaseTRS(
        columns=[
            _PhaseTC(
                name="total",
                role="measure",
                data_type="quantitative",
                semantic_type="count",
                cardinality=1,
                null_frac=0,
                is_constant=True,
            ),
        ],
        rows=[{"total": 47}],
    )
    out = _build_chart_payload(_result_from_typed(typed, typed.rows))
    assert out is not None
    assert out["kind"] == "kpi"
    assert out["kpi"]["value"] == 47
    assert out["kpi"]["label"] == "Total"


def test_build_chart_payload_summary_kind_on_field_card() -> None:
    typed = _PhaseTRS(
        columns=[
            _PhaseTC(
                name="run_id",
                role="identifier",
                data_type="nominal",
                semantic_type="id_hash",
                cardinality=1,
                null_frac=0,
                is_constant=True,
            ),
            _PhaseTC(
                name="total",
                role="measure",
                data_type="quantitative",
                semantic_type="count",
                cardinality=1,
                null_frac=0,
                is_constant=True,
            ),
        ],
        rows=[{"run_id": "r1", "total": 10}],
    )
    out = _build_chart_payload(_result_from_typed(typed, typed.rows))
    assert out is not None
    assert out["kind"] == "summary"
    assert len(out["summary"]["fields"]) == 2


def test_build_chart_payload_none_when_result_not_ok() -> None:
    assert _build_chart_payload({"status": "error"}) is None


def test_build_chart_payload_empty_rows_returns_empty_kind() -> None:
    out = _build_chart_payload({
        "status": "ok",
        "data": [],
        "typed_columns": [],
        "sql_used": "",
        "question": "empty",
    })
    assert out is not None
    assert out["kind"] == "empty"
    assert out["reason_code"] == "CG_EMPTY"


def test_build_chart_payload_truncates_on_high_cardinality() -> None:
    cols = [
        _PhaseTC(
            name="evaluator_name",
            role="dimension",
            data_type="nominal",
            semantic_type="category",
            cardinality=120,
            null_frac=0,
            is_constant=False,
        ),
        _PhaseTC(
            name="count",
            role="measure",
            data_type="quantitative",
            semantic_type="count",
            cardinality=120,
            null_frac=0,
            is_constant=False,
        ),
    ]
    rows = [{"evaluator_name": f"E{i}", "count": i} for i in range(120)]
    typed = _PhaseTRS(columns=cols, rows=rows)
    out = _build_chart_payload(_result_from_typed(typed, typed.rows))
    assert out is not None
    assert out["kind"] == "chart"
    assert out["reason_code"] == "CG_HIGH_CARD"
    assert len(out["data"]) == 25
    assert out["warning"] is not None
