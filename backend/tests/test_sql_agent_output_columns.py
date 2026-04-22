"""Phase 2.4 — generate_sql() returns {sql, chart_title, output_columns}.

The old ``chart_type``, ``x_key``, ``y_keys``, ``alternatives`` keys are gone.
Phase 3 picks the chart type from the typed result; the LLM no longer gets a
say in chart choice.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.chat_engine import sql_agent


@pytest.mark.asyncio
async def test_generate_sql_returns_output_columns() -> None:
    fake_json = json.dumps({
        "sql": "SELECT evaluator_name, AVG(result_score) AS avg_score "
               "FROM analytics_eval_facts GROUP BY 1",
        "chart_title": "Avg score by evaluator",
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
    })
    with patch(
        "app.services.chat_engine.sql_agent._call_llm_for_sql",
        new=AsyncMock(return_value=(fake_json, {})),
    ), patch(
        "app.services.chat_engine.sql_agent.get_llm_settings_from_db",
        new=AsyncMock(return_value={"api_key": "test-key"}),
    ):
        result = await sql_agent.generate_sql(
            "show avg score by evaluator",
            tenant_id="00000000-0000-0000-0000-000000000001",
            user_id="00000000-0000-0000-0000-000000000002",
            schema_context={
                "tables": {},
                "relations": [],
                "available_tables": [],
            },
            provider_override="openai",
            app_id="kaira-bot",
        )
    assert result["sql"].startswith("SELECT")
    assert result["chart_title"] == "Avg score by evaluator"
    assert "output_columns" in result
    assert len(result["output_columns"]) == 2
    for key in ("chart_type", "x_key", "y_keys", "alternatives"):
        assert key not in result, f"legacy key {key!r} must be removed"


@pytest.mark.asyncio
async def test_generate_sql_rejects_missing_sql() -> None:
    fake_json = json.dumps({
        "chart_title": "no sql",
        "output_columns": [],
    })
    with patch(
        "app.services.chat_engine.sql_agent._call_llm_for_sql",
        new=AsyncMock(return_value=(fake_json, {})),
    ), patch(
        "app.services.chat_engine.sql_agent.get_llm_settings_from_db",
        new=AsyncMock(return_value={"api_key": "test-key"}),
    ):
        with pytest.raises(ValueError, match="SQL"):
            await sql_agent.generate_sql(
                "bad question",
                tenant_id="00000000-0000-0000-0000-000000000001",
                user_id="00000000-0000-0000-0000-000000000002",
                schema_context={
                    "tables": {},
                    "relations": [],
                    "available_tables": [],
                },
                provider_override="openai",
                app_id="kaira-bot",
            )


@pytest.mark.asyncio
async def test_generate_sql_rejects_alias_that_relabels_known_field() -> None:
    fake_json = json.dumps({
        "sql": (
            "SELECT cf.criterion_label AS rule_id "
            "FROM analytics_criterion_facts cf "
            "WHERE cf.app_id = :app_id"
        ),
        "chart_title": "Pass rate by rule id",
        "output_columns": [
            {
                "alias": "rule_id",
                "role_hint": "dimension",
                "type_hint": "nominal",
                "source_column": "analytics_criterion_facts.criterion_label",
                "semantic_type_hint": None,
            },
        ],
    })
    with patch(
        "app.services.chat_engine.sql_agent._call_llm_for_sql",
        new=AsyncMock(return_value=(fake_json, {})),
    ), patch(
        "app.services.chat_engine.sql_agent.get_llm_settings_from_db",
        new=AsyncMock(return_value={"api_key": "test-key"}),
    ):
        with pytest.raises(sql_agent.SQLValidationError, match="rule_id"):
            await sql_agent.generate_sql(
                "show pass rate by rule_id",
                tenant_id="00000000-0000-0000-0000-000000000001",
                user_id="00000000-0000-0000-0000-000000000002",
                schema_context={
                    "tables": {},
                    "relations": [],
                    "available_tables": [],
                },
                provider_override="openai",
                app_id="kaira-bot",
            )


@pytest.mark.asyncio
async def test_generate_sql_rejects_non_json_output() -> None:
    with patch(
        "app.services.chat_engine.sql_agent._call_llm_for_sql",
        new=AsyncMock(return_value=("not-json-at-all", {})),
    ), patch(
        "app.services.chat_engine.sql_agent.get_llm_settings_from_db",
        new=AsyncMock(return_value={"api_key": "test-key"}),
    ):
        with pytest.raises(ValueError, match="JSON"):
            await sql_agent.generate_sql(
                "bad question",
                tenant_id="00000000-0000-0000-0000-000000000001",
                user_id="00000000-0000-0000-0000-000000000002",
                schema_context={
                    "tables": {},
                    "relations": [],
                    "available_tables": [],
                },
                provider_override="openai",
                app_id="kaira-bot",
            )
