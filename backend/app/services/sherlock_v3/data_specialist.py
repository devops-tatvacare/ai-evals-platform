"""Sherlock v3 data_specialist — true agent-in-SDK.

The data_specialist's own LLM (one call, fully orchestrated by the
Agents SDK) generates the SQL inline. Its instructions carry the
schema, allowed tables, column hints, verified-query exemplars, and
safety contract. There is **no second LLM call** — the legacy
``sql_agent.generate_sql`` raw-client path is gone from this file.

One tool: ``submit_sql``. It validates the SQL against the manifest,
parameterizes it with tenant/app filters, executes it, types the
result set, runs the chart pipeline, and returns a SpecialistResult
JSON string. The data_specialist may call ``submit_sql`` once; if it
returns ``status='error'``, one corrective retry is allowed.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import openai
from agents import Agent, FunctionTool
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from agents.tool_context import ToolContext
from openai.types.shared import Reasoning

from app.services.sherlock_v3.azure_client import specialist_model
from app.services.sherlock_v3.data_specialist_prompt import build_data_specialist_prompt
from app.services.sherlock_v3.exemplars import exemplars_for

logger = logging.getLogger(__name__)


_SUBMIT_SQL_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['sql', 'chart_title', 'output_columns'],
    'properties': {
        'sql': {
            'type': 'string',
            'description': (
                'A read-only PostgreSQL SELECT (or CTE WITH … SELECT). MUST '
                'filter the active table on :tenant_id and :app_id. No DDL, '
                'no DML, no comments, no information_schema/pg_*. See the '
                'system prompt for the full safety contract.'
            ),
        },
        'chart_title': {
            'type': 'string',
            'description': 'Short ≤ 8 word title that describes the result.',
        },
        'output_columns': {
            'type': 'array',
            'description': 'One entry per SELECT column, in SELECT order. Drives the chart pipeline.',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['alias', 'role_hint', 'type_hint'],
                'properties': {
                    'alias': {'type': 'string'},
                    'role_hint': {
                        'type': 'string',
                        'enum': [
                            'dimension', 'measure', 'temporal',
                            'ordered_categorical', 'key', 'identifier',
                        ],
                    },
                    'type_hint': {
                        'type': 'string',
                        'enum': [
                            'quantitative', 'temporal', 'ordinal',
                            'nominal', 'boolean', 'geo',
                        ],
                    },
                    'source_column': {
                        'type': 'string',
                        'description': 'Optional. Only for passthrough columns: <table>.<column>.',
                    },
                    'semantic_type_hint': {
                        'type': 'string',
                        'enum': [
                            'pk', 'fk', 'category', 'id_hash', 'currency',
                            'percent', 'lat', 'lon', 'count', 'ratio',
                            'score', 'duration', 'none',
                        ],
                    },
                },
            },
        },
    },
}


# ─────────────────────── tool handler ───────────────────────


async def _submit_sql_handler(ctx: ToolContext[Any], args: str) -> str:
    """Validate + execute + chart the LLM's SQL. No second LLM call.

    On validation failure or execution error, returns status='error'
    with the reason; the data_specialist's prompt instructs it to retry
    once, regenerating the SQL to avoid the same error.
    """
    started = time.monotonic()
    parsed = json.loads(args) if args.strip() else {}
    sherlock_ctx = ctx.context

    sql_raw = (parsed.get('sql') or '').strip()
    chart_title = (parsed.get('chart_title') or '').strip()
    output_columns = parsed.get('output_columns') or []

    if not sql_raw:
        return _result_json(
            status='error',
            summary='submit_sql called with empty sql.',
            artifacts=[],
            started=started,
            app_id=sherlock_ctx.app_id,
        )

    from app.database import async_session
    from app.services.chat_engine.sql_agent import (
        SQLValidationError,
        execute_query,
        load_app_config,
        load_semantic_model,
        prepare_query,
        validate_sql,
        validate_sql_columns_against_manifest,
    )

    app_id = sherlock_ctx.app_id

    try:
        async with async_session() as db:
            app_config = await load_app_config(db, app_id)
        semantic_model = load_semantic_model(app_id, app_config=app_config)

        sql = validate_sql(sql_raw, semantic_model)
        validate_sql_columns_against_manifest(sql, app_id=app_id)

        safe_sql, params = prepare_query(
            sql, sherlock_ctx, app_id, semantic_model,
        )
        async with async_session() as db:
            rows = await execute_query(safe_sql, params, db)

        question = sherlock_ctx.scratch.get('user_message', '') or chart_title

        artifacts = _build_artifact_list(
            rows=rows,
            output_columns=list(output_columns),
            question=question,
            sql_used=safe_sql,
            chart_title=chart_title,
            app_id=app_id,
        )

        if not rows:
            return _result_json(
                status='empty',
                summary=f'No rows for: {question}',
                artifacts=artifacts,
                started=started,
                app_id=app_id,
            )

        return _result_json(
            status='ok',
            summary=_summarize_for_supervisor(question, len(rows), artifacts),
            artifacts=artifacts,
            started=started,
            app_id=app_id,
        )
    except SQLValidationError as exc:
        return _result_json(
            status='error',
            summary=f'SQL validation failed: {exc}',
            artifacts=[],
            started=started,
            app_id=app_id,
        )
    except Exception as exc:  # noqa: BLE001 — top-level tool boundary
        logger.exception('sherlock_v3 submit_sql tool crashed')
        return _result_json(
            status='error',
            summary=f'{type(exc).__name__}: {exc}',
            artifacts=[],
            started=started,
            app_id=app_id,
        )


# ─────────────────────── chart pipeline ───────────────────────


def _build_artifact_list(
    *,
    rows: list[dict[str, Any]],
    output_columns: list[dict[str, Any]],
    question: str,
    sql_used: str,
    chart_title: str,
    app_id: str,
) -> list[dict[str, Any]]:
    """Type the rows + run the v3 chart pipeline. Returns 0 or 1 artifact."""
    from jsonschema import ValidationError

    from app.services.chat_engine.chartability_gate import evaluate as evaluate_gate
    from app.services.chat_engine.chart_type_picker import pick as pick_chart
    from app.services.chat_engine.manifest import manifest_for_result_typer
    from app.services.chat_engine.result_set_typer import (
        TypedResultSet,
        type_result_set,
    )
    from app.services.chat_engine.vega_lite_emitter import emit as emit_vl

    manifest = manifest_for_result_typer(app_id)

    typed = type_result_set(
        rows=rows,
        declared_columns=output_columns,
        manifest=manifest,
    )
    gate = evaluate_gate(typed)
    base = {
        'title': chart_title,
        'source_question': question,
        'sql_query': sql_used,
    }

    if gate.fallback == 'empty':
        return [{'kind': 'empty', 'payload': {'kind': 'empty', 'reason_code': gate.reason_code, **base}}]
    if gate.fallback == 'kpi':
        return [{
            'kind': 'kpi',
            'payload': {
                'kind': 'kpi', 'reason_code': gate.reason_code,
                'kpi': _kpi_from_single_value(typed), **base,
            },
        }]
    if gate.fallback == 'summary':
        return [{
            'kind': 'summary',
            'payload': {
                'kind': 'summary', 'reason_code': gate.reason_code,
                'summary': _summary_from_single_row(typed), **base,
            },
        }]
    if gate.fallback == 'table':
        return [{
            'kind': 'table',
            'payload': {
                'kind': 'table', 'reason_code': gate.reason_code,
                'warning': gate.warning,
                'columns': _table_columns(typed), 'data': typed.rows, **base,
            },
        }]

    chart_typed = typed
    if gate.fallback == 'chart_with_warning' and gate.top_n:
        chart_typed = TypedResultSet(columns=typed.columns, rows=typed.rows[: gate.top_n])

    try:
        picked = pick_chart(chart_typed)
        emitted = emit_vl(chart_typed, picked)
    except (ValueError, ValidationError) as exc:
        from app.services.chat_engine import reason_codes as _rc
        logger.warning('sherlock_v3 chart emit fell back to table: %s', exc)
        return [{
            'kind': 'table',
            'payload': {
                'kind': 'table', 'reason_code': _rc.CG_EMIT_FAILED,
                'warning': f'Could not render chart: {exc}',
                'columns': _table_columns(typed), 'data': typed.rows, **base,
            },
        }]

    return [{
        'kind': 'chart',
        'payload': {
            'kind': 'chart',
            'reason_code': gate.reason_code,
            'warning': gate.warning,
            'spec': emitted['spec'],
            'data': emitted['data'],
            **base,
        },
    }]


def _kpi_from_single_value(typed: Any) -> dict[str, Any]:
    if not typed.rows or not typed.columns:
        return {'label': 'value', 'value': None, 'format': None}
    col = typed.columns[0]
    return {
        'label': col.name,
        'value': typed.rows[0].get(col.name),
        'format': getattr(col, 'semantic_type', None),
    }


def _summary_from_single_row(typed: Any) -> dict[str, Any]:
    if not typed.rows:
        return {'fields': []}
    row = typed.rows[0]
    return {'fields': [{'label': c.name, 'value': row.get(c.name)} for c in typed.columns]}


def _table_columns(typed: Any) -> list[dict[str, str]]:
    return [{'key': c.name, 'label': c.name} for c in typed.columns]


def _summarize_for_supervisor(
    question: str, row_count: int, artifacts: list[dict[str, Any]],
) -> str:
    if not artifacts:
        return f'{row_count} rows for: {question}'
    return f'{artifacts[0]["kind"]}: {row_count} rows for: {question}'


def _result_json(
    *,
    status: str,
    summary: str,
    artifacts: list[dict[str, Any]],
    started: float,
    app_id: str,
) -> str:
    return json.dumps({
        'kind': 'data',
        'status': status,
        'summary': summary,
        'evidence': [],
        'artifacts': artifacts,
        'state_delta': {},
        'meta': {
            'confidence': 0.8 if status == 'ok' else 0.0,
            'latency_ms': int((time.monotonic() - started) * 1000),
            'source_pack_id': app_id,
        },
    }, default=str)


# ─────────────────────── agent build ───────────────────────


def build_data_specialist(client: openai.AsyncAzureOpenAI, app_id: str) -> Agent:
    """Construct the data_specialist Agent for one app.

    The system prompt bakes in:
      - Schema (rendered from ``load_semantic_model`` + ``_build_schema_context``)
      - Allowed tables list
      - Column role hints (from the same comment_metadata sql_agent used)
      - Verified-query exemplars (from ``exemplars.py``)
      - Safety + output contract

    The agent has ONE tool: ``submit_sql``. It validates + executes +
    charts the SQL the LLM emitted. No second LLM call.
    """
    from app.services.chat_engine.sql_agent import (
        MAX_RESULT_ROWS,
        _allowed_tables,
        _build_schema_context,
        _column_role_hints,
        load_semantic_model,
    )

    semantic_model = load_semantic_model(app_id)
    schema_context = _build_schema_context(semantic_model, None)
    allowed_tables = sorted(_allowed_tables(semantic_model))
    role_hints = _column_role_hints(schema_context, app_id=app_id)
    exemplars = exemplars_for(app_id)

    system_prompt = build_data_specialist_prompt(
        app_id=app_id,
        schema_context=schema_context,
        allowed_tables=allowed_tables,
        column_role_hints=role_hints,
        exemplars=exemplars,
        max_rows=MAX_RESULT_ROWS,
    )

    return Agent(
        name='sherlock-data-specialist',
        instructions=system_prompt,
        model=OpenAIResponsesModel(specialist_model(), client),
        model_settings=ModelSettings(
            tool_choice='auto',
            reasoning=Reasoning(effort='low'),
        ),
        tools=[
            FunctionTool(
                name='submit_sql',
                description=(
                    'Validate + execute + chart the SQL you generated. '
                    'Returns a SpecialistResult JSON. Call once per turn; '
                    'on status=error you may regenerate and call once more.'
                ),
                params_json_schema=_SUBMIT_SQL_SCHEMA,
                on_invoke_tool=_submit_sql_handler,
                strict_json_schema=True,
            ),
        ],
    )
