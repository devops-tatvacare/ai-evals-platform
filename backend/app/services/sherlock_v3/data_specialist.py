"""Sherlock v3 data_specialist (architecture spec §10.1).

Three independent FunctionTools: ``generate_sql``, ``execute_sql``,
``data_check``. The data_specialist agent decides which to call when —
that's the whole point of the agent layer. The supervisor calls
``data_specialist`` ``as_tool``; data_specialist iterates over its three
tools, recovers from validation/empty results within the same turn, and
returns one ``SpecialistResult`` JSON to the supervisor.

State threaded across the three tools (the just-generated SQL, the rows
from the last execute, the chart payload from data_check) lives on
``SherlockTurnContext.scratch`` for the duration of the turn. It's
process-local — no DB persistence needed for that ephemeral handoff.
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

logger = logging.getLogger(__name__)


_INSTRUCTIONS = """\
You are Sherlock's data_specialist. The supervisor hands you a
TaskBrief (a question + scope). You answer ONE analytics question by
running the three-tool loop:

  1. Call ``generate_sql`` with the question. It returns a SQL string
     plus an output-column manifest. The SQL is automatically scoped to
     the tenant + app.
  2. Call ``execute_sql``. It runs the SQL, types the result set, and
     returns rows + a chart payload. If status='error', read the
     reason and call ``generate_sql`` again with a corrected question;
     do this AT MOST ONCE.
  3. Call ``data_check`` to finalize. It packages the rows + chart
     into a SpecialistResult JSON and returns the JSON string.

Return whatever ``data_check`` gave you, verbatim, as your final
output to the supervisor. Do NOT add prose, do NOT restate the
result. The supervisor synthesizes the user-facing answer.

Stop conditions:
  * SQL generation returns empty → ``data_check`` with empty rows;
    don't retry.
  * Execution returns rows → ``data_check`` immediately.
  * Execution returns error → one corrective ``generate_sql`` retry,
    then ``data_check`` no matter what.
"""


# ─────────────────────── tool input schemas ───────────────────────


_GENERATE_SQL_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['question'],
    'properties': {
        'question': {
            'type': 'string',
            'description': (
                'The natural-language analytics question to translate into SQL. '
                'Pass the TaskBrief.task verbatim on first try; on a retry, '
                'rewrite the question to dodge the prior error '
                '(e.g., narrow the scope, drop a non-existent column).'
            ),
        },
    },
}


_EXECUTE_SQL_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': [],
    'properties': {},
}


_DATA_CHECK_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['question'],
    'properties': {
        'question': {
            'type': 'string',
            'description': 'The original TaskBrief.task — used as the chart title source.',
        },
    },
}


# ─────────────────────── tool handlers ───────────────────────


async def _generate_sql_handler(ctx: ToolContext[Any], args: str) -> str:
    started = time.monotonic()
    parsed = json.loads(args) if args.strip() else {}
    question = (parsed.get('question') or '').strip()
    sherlock_ctx = ctx.context

    if not question:
        return _tool_json({
            'status': 'error',
            'message': 'generate_sql called with empty question.',
            'latency_ms': _ms_since(started),
        })

    from app.database import async_session
    from app.services.chat_engine.sql_agent import (
        SQLValidationError,
        generate_sql,
        load_app_config,
        load_semantic_model,
        validate_sql,
        validate_sql_columns_against_manifest,
    )
    from app.services.sherlock_v3.exemplars import build_context_payload

    app_id = sherlock_ctx.app_id
    tenant_id = str(sherlock_ctx.tenant_id)
    user_id = str(sherlock_ctx.user_id)

    try:
        async with async_session() as db:
            app_config = await load_app_config(db, app_id)
        semantic_model = load_semantic_model(app_id, app_config=app_config)
        gen = await generate_sql(
            question=question,
            tenant_id=tenant_id,
            user_id=user_id,
            semantic_model=semantic_model,
            app_id=app_id,
            original_user_message=question,
            context_payload=build_context_payload(app_id),
        )
        sql = (gen.get('sql') or '').strip()
        chart_title = gen.get('chart_title') or ''
        output_columns = gen.get('output_columns') or []

        if not sql:
            return _tool_json({
                'status': 'empty',
                'message': 'SQL generator returned no query.',
                'latency_ms': _ms_since(started),
            })

        sql = validate_sql(sql, semantic_model)
        validate_sql_columns_against_manifest(sql, app_id=app_id)

        # Scratch-pad the just-generated SQL on the turn context so
        # execute_sql can pick it up without the model re-passing it.
        sherlock_ctx.scratch['question'] = question
        sherlock_ctx.scratch['sql_raw'] = sql
        sherlock_ctx.scratch['chart_title'] = chart_title
        sherlock_ctx.scratch['output_columns'] = output_columns
        sherlock_ctx.scratch['semantic_model'] = semantic_model

        return _tool_json({
            'status': 'ok',
            'question': question,
            'sql': sql,
            'output_column_count': len(output_columns),
            'chart_title': chart_title,
            'latency_ms': _ms_since(started),
        })
    except SQLValidationError as exc:
        return _tool_json({
            'status': 'error',
            'message': f'SQL validation failed: {exc}',
            'latency_ms': _ms_since(started),
        })
    except Exception as exc:  # noqa: BLE001
        logger.exception('sherlock_v3 generate_sql tool crashed')
        return _tool_json({
            'status': 'error',
            'message': f'{type(exc).__name__}: {exc}',
            'latency_ms': _ms_since(started),
        })


async def _execute_sql_handler(ctx: ToolContext[Any], args: str) -> str:
    started = time.monotonic()
    sherlock_ctx = ctx.context
    sql = sherlock_ctx.scratch.get('sql_raw')
    semantic_model = sherlock_ctx.scratch.get('semantic_model')
    if not sql or semantic_model is None:
        return _tool_json({
            'status': 'error',
            'message': 'execute_sql called before generate_sql produced a query.',
            'latency_ms': _ms_since(started),
        })

    from app.database import async_session
    from app.services.chat_engine.sql_agent import execute_query, prepare_query

    class _AuthShim:
        def __init__(self, t: str, u: str) -> None:
            self.tenant_id = t
            self.user_id = u

    try:
        safe_sql, params = prepare_query(
            sql,
            _AuthShim(str(sherlock_ctx.tenant_id), str(sherlock_ctx.user_id)),
            sherlock_ctx.app_id,
            semantic_model,
        )
        async with async_session() as db:
            rows = await execute_query(safe_sql, params, db)
        sherlock_ctx.scratch['sql_executed'] = safe_sql
        sherlock_ctx.scratch['rows'] = rows
        return _tool_json({
            'status': 'ok',
            'row_count': len(rows),
            'latency_ms': _ms_since(started),
        })
    except Exception as exc:  # noqa: BLE001
        logger.exception('sherlock_v3 execute_sql tool crashed')
        return _tool_json({
            'status': 'error',
            'message': f'{type(exc).__name__}: {exc}',
            'latency_ms': _ms_since(started),
        })


async def _data_check_handler(ctx: ToolContext[Any], args: str) -> str:
    """Final tool — packages rows + chart into a SpecialistResult JSON."""
    started = time.monotonic()
    parsed = json.loads(args) if args.strip() else {}
    sherlock_ctx = ctx.context

    question = (parsed.get('question') or sherlock_ctx.scratch.get('question') or '').strip()
    rows = sherlock_ctx.scratch.get('rows')
    output_columns = sherlock_ctx.scratch.get('output_columns') or []
    chart_title = sherlock_ctx.scratch.get('chart_title') or ''
    sql_used = sherlock_ctx.scratch.get('sql_executed') or ''

    if rows is None:
        return _specialist_result_json(
            status='error',
            summary='data_check called before execute_sql produced rows.',
            artifacts=[],
            started=started,
            app_id=sherlock_ctx.app_id,
        )

    artifacts = _build_artifact_list(
        rows=rows,
        output_columns=output_columns,
        question=question,
        sql_used=sql_used,
        chart_title=chart_title,
        app_id=sherlock_ctx.app_id,
    )

    if not rows:
        return _specialist_result_json(
            status='empty',
            summary=f'No rows for: {question}',
            artifacts=artifacts,
            started=started,
            app_id=sherlock_ctx.app_id,
        )

    return _specialist_result_json(
        status='ok',
        summary=_summarize_for_supervisor(question, len(rows), artifacts),
        artifacts=artifacts,
        started=started,
        app_id=sherlock_ctx.app_id,
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
    """Run the v3 chart pipeline on the rows + return zero-or-one artifacts."""
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
        declared_columns=list(output_columns),
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


def _specialist_result_json(
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
            'latency_ms': _ms_since(started),
            'source_pack_id': app_id,
        },
    }, default=str)


def _tool_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, default=str)


def _ms_since(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


# ─────────────────────── agent build ───────────────────────


def build_data_specialist(client: openai.AsyncAzureOpenAI) -> Agent:
    """Construct the data_specialist with three independent tools.

    Per architecture spec §10.1: ``generate_sql`` / ``execute_sql`` /
    ``data_check``. The supervisor's ``as_tool`` wrapping invokes this
    agent's whole reasoning loop; the agent decides which tool to call
    when. State across the three calls lives on
    ``SherlockTurnContext.scratch``, which is per-turn process-local.
    """
    return Agent(
        name='sherlock-data-specialist',
        instructions=_INSTRUCTIONS,
        model=OpenAIResponsesModel(specialist_model(), client),
        model_settings=ModelSettings(
            tool_choice='auto',
            reasoning=Reasoning(effort='low'),
        ),
        tools=[
            FunctionTool(
                name='generate_sql',
                description='Translate the user question into a parameterized PostgreSQL SELECT.',
                params_json_schema=_GENERATE_SQL_SCHEMA,
                on_invoke_tool=_generate_sql_handler,
                strict_json_schema=True,
            ),
            FunctionTool(
                name='execute_sql',
                description='Run the SQL produced by the most recent generate_sql call. No arguments.',
                params_json_schema=_EXECUTE_SQL_SCHEMA,
                on_invoke_tool=_execute_sql_handler,
                strict_json_schema=True,
            ),
            FunctionTool(
                name='data_check',
                description='Finalize: type the rows, run the chart pipeline, return a SpecialistResult JSON.',
                params_json_schema=_DATA_CHECK_SCHEMA,
                on_invoke_tool=_data_check_handler,
                strict_json_schema=True,
            ),
        ],
    )
