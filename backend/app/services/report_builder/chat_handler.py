"""
Report builder chat surface.
Wires report-specific tools and system prompt into the shared chat engine.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable

from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.sherlock_runtime import SherlockRuntimeTurn as SherlockRuntimeTurnModel
from app.services.report_builder.chart_contract import ChartPayload
from app.services.cost_tracking import (
    SherlockTurnContext,
    aggregate_turn_usage,
    get_correlation_id,
    reset_correlation_id,
    reset_sherlock_turn_context,
    set_correlation_id,
    set_sherlock_turn_context,
)
from app.services.chat_engine.entity_recognition import (
    EntityRecognitionResult,
    recognize_entities,
    render_entity_recognition_context,
)
from app.services.chat_engine.entity_registry import load_entity_registry
from app.services.chat_engine.openai_agents_adapter import (
    SherlockContext,
    TURN_DEADLINE_SECONDS,
    create_openai_client,
    run_sherlock_sdk_turn,
)
from app.services.chat_engine.sql_agent import load_app_config, load_semantic_model
from app.services.report_builder.schemas import ToolCallDetailOut
from app.services.report_builder.scratchpad_state import (
    build_analysis_snapshot,
    default_scratchpad,
    push_analysis_snapshot,
    remember_active_filters,
    remember_catalog_inspection,
    remember_catalog_relations,
    remember_data_check,
    remember_json_structure,
    remember_last_evidence,
    remember_resolved_entities,
)
from app.services.report_builder.tool_definitions import resolve_tools
from app.services.report_builder.runtime_store import (
    SherlockRuntimeSession,
    append_runtime_event,
    create_assistant_message,
    finalize_assistant_message,
    record_user_message,
    save_runtime_state,
    touch_sherlock_chat_session,
    update_last_response_id,
)
from app.services.report_builder.turn_store import (
    SherlockRuntimeTurnState,
    mark_turn_active,
    mark_turn_terminal,
)

logger = logging.getLogger(__name__)


def _reset_turn_contextvars(correlation_token, sherlock_token) -> None:
    """Release the contextvars set at the top of ``_execute_chat_turn``.

    Invoked in both the success and error branches (guards run before the
    function returns/raises) so subsequent turns on the same worker see a
    clean context.
    """
    if correlation_token is not None:
        try:
            reset_correlation_id(correlation_token)
        except Exception:
            pass
    if sherlock_token is not None:
        try:
            reset_sherlock_turn_context(sherlock_token)
        except Exception:
            pass

MAX_TOOL_ROUNDS = 15
EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]


def _chart_title_from_result(result: dict[str, Any]) -> str:
    """Extract the chart title from the data_query result.

    The inner SQL-generation LLM returns a ``chart_title`` alongside the SQL.
    Falls back to the question text (capped) if the LLM didn't produce one.
    """
    title = str(result.get('chart_title') or '').strip()
    if title:
        return title
    # Fallback: use the question, capped at 60 chars.
    raw = str(result.get('question') or '').strip().rstrip('?.! ')
    if not raw:
        return 'Chart'
    title = raw[:1].upper() + raw[1:]
    if len(title) > 60:
        cut = title[:60].rfind(' ')
        title = title[:cut if cut > 30 else 60] + '…'
    return title


def _pivot_chart_rows(
    rows: list[dict[str, Any]],
    *,
    x_key: str,
    series_key: str,
    value_key: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    pivoted: dict[str, dict[str, Any]] = {}
    series_values: list[str] = []
    seen_series: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        x_value = row.get(x_key)
        series_value = row.get(series_key)
        if x_value in (None, '') or series_value in (None, ''):
            continue
        bucket_key = json.dumps(x_value, sort_keys=True, default=str)
        bucket = pivoted.setdefault(bucket_key, {x_key: x_value})
        series_text = str(series_value)
        bucket[series_text] = row.get(value_key)
        if series_text not in seen_series:
            seen_series.add(series_text)
            series_values.append(series_text)
    return list(pivoted.values()), series_values


_KPI_FORMAT_BY_SEMTYPE: dict[str, str] = {
    'percent': 'percent',
    'currency': 'currency',
    'count': 'integer',
    'duration': 'duration_ms',
    'ratio': 'decimal',
    'score': 'decimal',
}


def _typed_result_from_json_payload(result: dict[str, Any]) -> "TypedResultSet | None":
    """Reconstruct a ``TypedResultSet`` from the JSON-safe tool-result envelope.

    Audit-knot #2: the tool boundary serializes via ``json.dumps(..., default=str)``
    so no live Python object can be relied on after ``dispatch_tool_call``. The
    orchestrator consumes ``result['typed_columns']`` + ``result['data']``, the
    contract emitted by ``sql_agent.data_query`` in Phase 2.
    """
    from app.services.chat_engine.result_set_typer import TypedColumn, TypedResultSet

    raw_cols = result.get('typed_columns')
    rows = result.get('data')
    if not isinstance(raw_cols, list) or not isinstance(rows, list):
        return None
    rebuilt: list[TypedColumn] = []
    for raw in raw_cols:
        if not isinstance(raw, dict):
            continue
        name = raw.get('name')
        role = raw.get('role')
        data_type = raw.get('data_type')
        if not (name and role and data_type):
            continue
        rebuilt.append(
            TypedColumn(
                name=str(name),
                role=role,
                data_type=data_type,
                semantic_type=raw.get('semantic_type'),
                cardinality=int(raw.get('cardinality') or 0),
                null_frac=float(raw.get('null_frac') or 0.0),
                is_constant=bool(raw.get('is_constant') or False),
            )
        )
    clean_rows = [r for r in rows if isinstance(r, dict)]
    return TypedResultSet(columns=rebuilt, rows=clean_rows)


def _kpi_from_single_value(typed: "TypedResultSet") -> dict[str, Any]:
    col = typed.columns[0]
    value = typed.rows[0].get(col.name) if typed.rows else None
    fmt = _KPI_FORMAT_BY_SEMTYPE.get(col.semantic_type or '', 'decimal')
    return {
        'value': value,
        'label': col.name.replace('_', ' ').title(),
        'format': fmt,
        'semantic_type': col.semantic_type,
    }


def _summary_from_single_row(typed: "TypedResultSet") -> dict[str, Any]:
    row = typed.rows[0] if typed.rows else {}
    return {
        'fields': [
            {
                'name': c.name,
                'label': c.name.replace('_', ' ').title(),
                'value': row.get(c.name),
                'semantic_type': c.semantic_type,
                'role': c.role,
            }
            for c in typed.columns
        ],
    }


def _table_columns(typed: "TypedResultSet") -> list[dict[str, Any]]:
    return [
        {
            'name': c.name,
            'label': c.name.replace('_', ' ').title(),
            'role': c.role,
            'semantic_type': c.semantic_type,
            'data_type': c.data_type,
        }
        for c in typed.columns
    ]


def _build_chart_payload(result: dict[str, Any] | None) -> ChartPayload | None:
    """Turn a ``data_query`` result into a discriminated-union chart payload.

    Returns one of:
        ``{kind: 'chart',   spec, data, title, sql_query, source_question, ...}``
        ``{kind: 'kpi',     kpi,  ...}``
        ``{kind: 'summary', summary, ...}``
        ``{kind: 'table',   columns, data, ...}``
        ``None`` when the result is not OK or carries no rows.

    The orchestrator reconstructs a ``TypedResultSet`` from the JSON-safe
    ``typed_columns + data`` fields, runs the chartability gate, and
    either emits a validated Vega-Lite spec or degrades to a
    fallback kind with the corresponding reason code.
    """
    if not isinstance(result, dict) or result.get('status') != 'ok':
        return None

    from jsonschema import ValidationError

    from app.services.chat_engine.chartability_gate import evaluate as evaluate_gate
    from app.services.chat_engine.chart_type_picker import pick as pick_chart
    from app.services.chat_engine.result_set_typer import TypedResultSet
    from app.services.chat_engine.vega_lite_emitter import emit as emit_vl

    typed = _typed_result_from_json_payload(result)
    if typed is None or not typed.rows:
        return None

    gate = evaluate_gate(typed)
    base: dict[str, Any] = {
        'title': _chart_title_from_result(result),
        'source_question': result.get('question', ''),
        'sql_query': result.get('sql_used', ''),
    }

    if gate.fallback == 'empty':
        return {'kind': 'empty', 'reason_code': gate.reason_code, **base}

    if gate.fallback == 'kpi':
        return {
            'kind': 'kpi',
            'reason_code': gate.reason_code,
            'kpi': _kpi_from_single_value(typed),
            **base,
        }

    if gate.fallback == 'summary':
        return {
            'kind': 'summary',
            'reason_code': gate.reason_code,
            'summary': _summary_from_single_row(typed),
            **base,
        }

    if gate.fallback == 'table':
        return {
            'kind': 'table',
            'reason_code': gate.reason_code,
            'warning': gate.warning,
            'columns': _table_columns(typed),
            'data': typed.rows,
            **base,
        }

    # chartable — either 'chart' or 'chart_with_warning'
    chart_typed = typed
    if gate.fallback == 'chart_with_warning' and gate.top_n:
        chart_typed = TypedResultSet(
            columns=typed.columns, rows=typed.rows[: gate.top_n]
        )

    try:
        picked = pick_chart(chart_typed)
        emitted = emit_vl(chart_typed, picked)
    except (ValueError, ValidationError) as exc:
        logger.warning('sherlock chart: emitter failed, degrading to table: %s', exc)
        return {
            'kind': 'table',
            'reason_code': 'CG_EMIT_FAILED',
            'warning': f'Could not render chart: {exc}',
            'columns': _table_columns(typed),
            'data': typed.rows,
            **base,
        }

    return {
        'kind': 'chart',
        'reason_code': gate.reason_code,
        'warning': gate.warning,
        'spec': emitted['spec'],
        'data': emitted['data'],
        **base,
    }


async def assemble_context(session: dict[str, Any], db: AsyncSession) -> str:
    """Build the report-builder system prompt from layered context modules."""
    from app.services.chat_engine.prompts import base, app_context, scratchpad, user_context
    from app.services.chat_engine.prompt_generator import render_tools_section

    session.setdefault('scratchpad', default_scratchpad())
    session.setdefault('_app_context', None)
    session.setdefault('_user_context', None)

    app_id = session.get('app_id')
    tools_section = render_tools_section(app_id=app_id) if app_id else ''

    parts = [
        base.render(),
        tools_section,
        await app_context.render(session, db),
        await user_context.render(session, db),
        scratchpad.render(session),
    ]
    return '\n\n'.join(part for part in parts if part)


def _copy_working_session(session: dict[str, Any]) -> dict[str, Any]:
    return {
        **session,
        'messages': list(session.get('messages', [])),
        'scratchpad': copy.deepcopy(session.get('scratchpad', default_scratchpad())),
        'last_response_id': session.get('last_response_id'),
        '_app_context': session.get('_app_context'),
        '_user_context': session.get('_user_context'),
    }


def _sync_session_state(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key in ('messages', 'scratchpad', 'last_response_id', '_app_context', '_user_context'):
        target[key] = source.get(key)


def _serialize_entity_recognition(result: EntityRecognitionResult) -> dict[str, Any]:
    return result.model_dump(mode='json')


def _update_scratchpad(session: dict[str, Any], tool_name: str, result_str: str, *, app_id: str = '') -> None:
    """Capture compact tool outcomes for the next turn's prompt."""
    pad = session.setdefault('scratchpad', default_scratchpad())

    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return

    error = data.get('error')
    errors = data.get('errors')
    if data.get('status') == 'error' or error or errors:
        error_text = ''
        if error:
            error_text = str(error)
        elif isinstance(errors, list) and errors:
            error_text = '; '.join(str(item) for item in errors)
        elif errors:
            error_text = str(errors)
        if error_text:
            pad['errors'].append(f'{tool_name}: {error_text[:200]}')
        return

    if tool_name in {'data_query', 'analyze'} and data.get('status') == 'ok':
        question = str(data.get('question', '')).strip()
        row_count = data.get('row_count', 0)
        remember_active_filters(pad, data.get('applied_filters'))
        # Load dimension metadata for chart classifier
        dimensions: list[dict[str, Any]] | None = None
        if app_id:
            from app.services.chat_engine.sql_agent import load_semantic_model, _normalize_dimensions
            try:
                semantic_model = load_semantic_model(app_id)
                dimensions = _normalize_dimensions(semantic_model)
            except Exception:
                pass
        push_analysis_snapshot(pad, build_analysis_snapshot(data, dimensions=dimensions))
        if question:
            pad['findings'].append(f'{question} ({row_count} rows)')
        return

    if tool_name == 'data_check' and data.get('status') == 'ok':
        remember_data_check(pad, data)
        pad['findings'].append(f"{data.get('table', 'table')} check ({int(data.get('row_count', 0) or 0)} rows)")
        return

    if tool_name == 'discover' and data.get('status') == 'ok':
        pad['discovery'] = data
        dimensions = data.get('dimensions', [])
        metrics = data.get('metrics', [])
        pad['findings'].append(f'Discovered {len(dimensions)} dimensions and {len(metrics)} metrics')
        return

    if tool_name == 'lookup' and data.get('status') == 'ok':
        dimension = str(data.get('dimension', '')).strip()
        if dimension:
            lookups = pad.setdefault('lookups', {})
            lookups[dimension] = {
                'search': data.get('search'),
                'values': data.get('values', []),
            }
            pad['findings'].append(f"Resolved {dimension} ({len(data.get('values', []))} values)")
        return

    if tool_name == 'catalog_inspect' and data.get('status') == 'ok':
        table = str(data.get('table', '')).strip()
        columns = data.get('columns', [])
        if table and isinstance(columns, list):
            remember_catalog_inspection(pad, table=table, columns=[column for column in columns if isinstance(column, dict)])
        return

    if tool_name == 'catalog_relations' and data.get('status') == 'ok':
        relations = data.get('relations', [])
        if isinstance(relations, list):
            remember_catalog_relations(pad, [relation for relation in relations if isinstance(relation, dict)])
        return

    if tool_name == 'catalog_sample' and data.get('status') == 'ok' and data.get('json_structure') is not None:
        table = str(data.get('table', '')).strip()
        column = str(data.get('column', '')).strip()
        json_structure = data.get('json_structure')
        if table and column and isinstance(json_structure, dict):
            remember_json_structure(pad, table=table, column=column, json_structure=json_structure)
        return

    if tool_name == 'resolve_entity' and data.get('status') == 'ok':
        entity_type = str(data.get('entity_type', '')).strip()
        if entity_type:
            matches = data.get('matches', [])
            remember_resolved_entities(
                pad,
                entity_type=entity_type,
                search=str(data.get('search', '')).strip(),
                matches=matches if isinstance(matches, list) else [],
            )
            pad['findings'].append(f"Resolved {entity_type} ({len(matches) if isinstance(matches, list) else 0} matches)")
        return

    if tool_name == 'get_surface_records' and data.get('status') == 'ok':
        surface_key = str(data.get('surface_key', '')).strip()
        if surface_key:
            remember_last_evidence(
                pad,
                surface_key=surface_key,
                record_count=int(data.get('record_count', 0) or 0),
                entity_type=str(data.get('entity_type', '')).strip() or None,
                entity_value=str(data.get('entity_value', '')).strip() or None,
            )
            pad['findings'].append(f"{surface_key} evidence ({int(data.get('record_count', 0) or 0)} records)")
        return

    if tool_name == 'blueprint_compose' and data.get('status') == 'ok':
        pad['composed_report'] = {
            'name': data.get('name') or 'Untitled',
            'sections': [
                section.get('type')
                for section in data.get('sections', [])
                if isinstance(section, dict) and section.get('type')
            ],
        }
        return

    if tool_name == 'blueprint_save':
        name = data.get('name')
        if name:
            pad['findings'].append(f'Saved template: {name}')
            session['_user_context'] = None


def _summarize_tool_result(name: str, result_str: str) -> str:
    """Extract a short label from a tool result for the UI badge."""
    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return "done"

    if name == "data_query":
        row_count = data.get("row_count", 0)
        status = data.get("status", "")
        if status == "error" or data.get("error"):
            return "query failed"
        return f"{row_count} rows"
    if name == 'data_check':
        if data.get('status') == 'error' or data.get('error'):
            return 'check failed'
        return f"{data.get('row_count', 0)} rows"
    if name == 'discover':
        return f"{len(data.get('dimensions', []))} dims · {len(data.get('surfaces', []))} surfaces"
    if name == 'lookup':
        return f"{data.get('dimension', 'value')} · {len(data.get('values', []))} values"
    if name == 'resolve_entity':
        return f"{data.get('entity_type', 'entity')} · {len(data.get('matches', []))} matches"
    if name == 'get_surface_records':
        return f"{data.get('surface_key', 'surface')} · {data.get('record_count', 0)} records"
    if name == 'catalog_inspect':
        return f"{data.get('table', 'table')} · {len(data.get('columns', []))} cols"
    if name == 'catalog_relations':
        return f"{data.get('table', 'table')} · {len(data.get('relations', []))} relations"
    if name == 'catalog_values':
        return f"{data.get('column', 'column')} · {len(data.get('values', []))} values"
    if name == 'catalog_sample':
        if data.get('json_structure') is not None:
            return f"{data.get('column', 'json')} · JSON structure"
        return f"{data.get('table', 'table')} · {len(data.get('sample_rows', []))} samples"
    if name == 'blueprint_blocks':
        blocks = data.get('blocks', [])
        return f"{len(blocks)} blocks"
    if name == 'blueprint_list':
        blueprints = data.get('blueprints', [])
        return f"{len(blueprints)} blueprints"
    if name == "blueprint_compose":
        sections = data.get("sections", [])
        return f"{len(sections)} sections"
    if name == "blueprint_save":
        return data.get("name", "saved")
    if name == "query_eval_runs":
        count = data.get("count", 0)
        return f"{count} runs"
    if name == "get_run_summary":
        return data.get("name", "") or str(data.get("id", ""))[:8]
    if name == "compare_runs":
        ra = data.get("run_a", {}).get("id", "?")
        rb = data.get("run_b", {}).get("id", "?")
        return f"{ra} vs {rb}"
    if name == "query_threads":
        count = data.get("count", 0)
        return f"{count} threads"
    if name == "get_app_stats":
        return f"{data.get('total_runs', 0)} runs"
    if name == "get_report_section":
        return data.get("section_type", data.get("title", "done"))
    if name == "get_thread_detail":
        return data.get("thread_id", "done")
    if name == "get_rule_compliance":
        rules = data.get("rules", [])
        return f"{len(rules)} rules"
    if name == "get_cross_run_rule_compliance":
        rules = data.get("rules", [])
        runs = data.get("total_runs_analyzed", 0)
        return f"{len(rules)} rules across {runs} runs"
    if name == "query_adversarial":
        return f"{data.get('total', 0)} cases"
    return "done"


def _build_tool_call_detail(name: str, result_str: str, *, execution_ms: float) -> ToolCallDetailOut:
    """Build structured tool metadata for the chat widget."""
    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        data = {}

    error = data.get('error')
    if not error and isinstance(data.get('errors'), list) and data['errors']:
        error = '; '.join(str(item) for item in data['errors'])

    detail = ToolCallDetailOut(
        execution_ms=round(execution_ms, 2),
        error=str(error) if error else None,
    )

    if name in {'data_query', 'analyze'}:
        detail.sql_used = data.get('sql_used')
        detail.row_count = data.get('row_count')
        detail.cache_hit = bool(data.get('cache_hit', False))
    elif name == 'data_check':
        detail.row_count = data.get('row_count')
    elif name == 'catalog_values':
        detail.row_count = len(data.get('values', []))
    elif name == 'catalog_sample':
        detail.row_count = data.get('sample_count') or len(data.get('sample_rows', []))
    elif name == 'resolve_entity':
        detail.row_count = len(data.get('matches', []))
    elif name == 'get_surface_records':
        detail.row_count = data.get('record_count')

    return detail


async def _resolve_tools_for_app(app_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    """Resolve tools from App.config.chat.capabilities.

    Injects hard enums drawn from the canonical vocabulary onto every
    bounded parameter (``table``, ``dimension``, ``entity_type``,
    ``surface_key``, ``block_type``). The LLM sees the allowed values in
    the tool schema; the dispatcher rejects anything outside them at the
    tool boundary (``_validate_bounded_arguments`` in tool_handlers.py).
    """
    from sqlalchemy import select
    from app.models.app import App
    from app.schemas.app_config import AppConfig
    from app.services.chat_engine.tool_vocabulary import build_tool_vocabulary

    result = await db.execute(
        select(App.config).where(App.slug == app_id, App.is_active.is_(True))
    )
    raw_config = result.scalar_one_or_none()
    app_config = AppConfig.model_validate(raw_config or {})
    capabilities = app_config.chat.capabilities or None
    tools = resolve_tools(capabilities, app_id=app_id)

    semantic_model = load_semantic_model(app_id, app_config=raw_config)
    vocab = build_tool_vocabulary(app_id, semantic_model)

    # Parameter-name → sorted allowed values drawn from the vocabulary.
    # ``dimension`` includes every declared synonym so the LLM can use
    # user-facing terms (``verdict``, ``rule``) directly; the handlers
    # resolve them back to canonical names via ToolVocabulary.
    dimension_allowed = sorted(
        set(vocab.dimensions.keys()) | set(vocab.dimension_alias_index.keys())
    )
    enums: dict[str, list[str]] = {
        'table': sorted({t.lower() for t in (semantic_model.get('tables') or {}).keys()}),
        'dimension': dimension_allowed,
        'entity_type': sorted(vocab.entity_types),
        'surface_key': sorted(vocab.surfaces.keys()),
        'block_type': sorted(vocab.block_types.keys()),
    }

    tools = copy.deepcopy(tools)
    for tool in tools:
        props = (tool.get('inputSchema') or {}).get('properties', {})
        for param_name, allowed in enums.items():
            if not allowed:
                continue
            if param_name in props and props[param_name].get('type') == 'string':
                props[param_name]['enum'] = allowed
                props[param_name]['description'] = (
                    f"{props[param_name].get('description', '').rstrip()} "
                    f"Must be one of: {', '.join(allowed)}."
                ).strip()
        # Nested: blueprint_compose.sections[*].type is a block_type.
        sections = props.get('sections') or {}
        section_items = sections.get('items') or {}
        section_props = section_items.get('properties') or {}
        if 'type' in section_props and section_props['type'].get('type') == 'string' and enums['block_type']:
            section_props['type']['enum'] = enums['block_type']

    return tools


def _runtime_session_from_state(session: dict[str, Any], provider: str, model: str) -> SherlockRuntimeSession:
    return SherlockRuntimeSession(
        chat_session_id=session['chat_session_id'],
        app_id=session['app_id'],
        tenant_id=session['tenant_id'],
        user_id=session['user_id'],
        provider=provider,
        model=model,
        message_state=list(session.get('messages', [])),
        scratchpad=dict(session.get('scratchpad', default_scratchpad())),
        next_event_seq=1,
        last_response_id=session.get('last_response_id'),
    )


def _tool_call_warning(tool_name: str, detail: ToolCallDetailOut | None) -> str | None:
    if detail is None or not detail.error:
        return None
    return f'{tool_name}: {detail.error}'


async def _emit_runtime_event(
    runtime_session: SherlockRuntimeSession,
    event_type: str,
    payload: dict[str, Any],
    emit: EventEmitter | None,
    db: AsyncSession,
) -> dict[str, Any]:
    seq = await append_runtime_event(
        runtime_session=runtime_session,
        event_type=event_type,
        payload=payload,
        db=db,
    )
    event = {'event': event_type, 'data': {'seq': seq, **payload}}
    if emit is not None:
        await emit(event)
    return event


async def _execute_chat_turn(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession | None = None,
    auth: 'Any',
    emit: EventEmitter | None = None,
    turn: SherlockRuntimeTurnState | None = None,
    entity_recognition: EntityRecognitionResult | None = None,
) -> dict[str, Any]:
    if db is None:
        async with async_session() as owned_db:
            return await _execute_chat_turn(
                session,
                user_message,
                provider=provider,
                model=model,
                db=owned_db,
                auth=auth,
                emit=emit,
                turn=turn,
                entity_recognition=entity_recognition,
            )

    # Ensure a correlation id is active for the duration of this turn and
    # expose the turn context to the global Agents SDK cost-tracking
    # processor. Both are no-ops if the turn hasn't been created yet (legacy
    # callers); the finally block cleans up.
    correlation_token = None
    sherlock_token = None
    if get_correlation_id() is None:
        correlation_token = set_correlation_id(uuid.uuid4())
    if turn is not None:
        try:
            turn_ctx = SherlockTurnContext(
                tenant_id=uuid.UUID(session['tenant_id']),
                user_id=uuid.UUID(session['user_id']) if session.get('user_id') else None,
                app_id=session['app_id'],
                turn_id=uuid.UUID(turn.id),
            )
            sherlock_token = set_sherlock_turn_context(turn_ctx)
        except (ValueError, TypeError):
            sherlock_token = None

    tools = await _resolve_tools_for_app(session["app_id"], db)
    working_session = _copy_working_session(session)
    runtime_session = _runtime_session_from_state(working_session, provider, model)
    app_config = await load_app_config(db, working_session['app_id'])
    if entity_recognition is None:
        semantic_model = load_semantic_model(working_session['app_id'], app_config=app_config)
        entity_registry = load_entity_registry(
            working_session['app_id'],
            app_config=app_config,
            semantic_model=semantic_model,
        )
        entity_recognition = await recognize_entities(
            question=user_message,
            scratchpad=working_session.get('scratchpad'),
            entity_registry=entity_registry,
            provider=provider,
            model=model,
            tenant_id=working_session['tenant_id'],
            user_id=working_session['user_id'],
            app_id=working_session.get('app_id'),
            turn_id=turn.id if turn is not None else None,
        )
    entity_recognition_payload = _serialize_entity_recognition(entity_recognition)

    composed_report: dict | None = None
    tool_call_log: list[dict[str, Any]] = []
    chart_payload: dict | None = None
    streamed_text_parts: list[str] = []
    warnings: list[str] = []
    text = ''
    assistant_message_id: str | None = None

    try:
        await record_user_message(runtime_session=runtime_session, content=user_message, db=db)
        assistant_message_id = await create_assistant_message(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_active(turn_id=turn.id, assistant_message_id=assistant_message_id, db=db)
            current_correlation = get_correlation_id()
            if current_correlation is not None:
                await db.execute(
                    sa_update(SherlockRuntimeTurnModel)
                    .where(SherlockRuntimeTurnModel.id == uuid.UUID(turn.id))
                    .values(correlation_id=current_correlation)
                )
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=list(working_session.get('messages', [])),
            scratchpad=working_session['scratchpad'],
            status='active',
            last_error=None,
            db=db,
        )
        await _emit_runtime_event(
            runtime_session,
            'user_message_added',
            {'role': 'user', 'content': user_message},
            None,
            db,
        )
        await _emit_runtime_event(
            runtime_session,
            'entity_recognition',
            entity_recognition_payload,
            emit,
            db,
        )
        await db.commit()

        from app.services.evaluators.settings_helper import get_llm_settings_from_db

        creds = await get_llm_settings_from_db(
            tenant_id=working_session['tenant_id'],
            user_id=working_session['user_id'],
            provider_override=provider,
            auth_intent='interactive',
        )
        azure = provider == 'azure_openai'
        client = create_openai_client(
            api_key=creds.get('api_key', ''),
            azure=azure,
            azure_endpoint=creds.get('azure_endpoint', '') if azure else '',
            api_version=creds.get('api_version', '2025-04-01-preview') if azure else '',
        )
        system = await assemble_context(working_session, db)
        recognition_context = render_entity_recognition_context(entity_recognition)
        if recognition_context:
            system = f'{system}\n\n{recognition_context}'

        await _emit_runtime_event(
            runtime_session,
            'system_prompt',
            {'prompt': system, 'char_count': len(system)},
            None,  # don't stream to client — internal debug only
            db,
        )
        await db.commit()

        async def _noop_emit(_event: dict[str, Any]) -> None:
            return None

        sherlock_ctx = SherlockContext(
            auth=auth,
            app_id=working_session['app_id'],
            provider=provider,
            working_session=working_session,
            emit=_noop_emit,
            tool_call_log=[],
        )

        deadline = time.monotonic() + TURN_DEADLINE_SECONDS
        turn_tools = tools if entity_recognition.is_platform_query else []
        force_first = entity_recognition.is_platform_query and entity_recognition.needs_resolution
        # Deterministic orchestration: when recognition says resolution is
        # needed, pick the specific first tool rather than "some tool".
        # - User referenced one or more entities -> resolve_entity first.
        # - Vague/unfamiliar question, no entities -> discover first.
        forced_tool = None
        if force_first:
            forced_tool = 'resolve_entity' if entity_recognition.entities else 'discover'
        agen = run_sherlock_sdk_turn(
            user_message=user_message,
            instructions=system,
            tools=turn_tools,
            sherlock_context=sherlock_ctx,
            model=model,
            client=client,
            previous_response_id=runtime_session.last_response_id,
            force_first_tool_call=force_first,
            forced_tool_name=forced_tool,
            max_turns=MAX_TOOL_ROUNDS,
        )
        try:
            async for event in agen:
                if time.monotonic() >= deadline:
                    warnings.append(f'turn exceeded {TURN_DEADLINE_SECONDS:.0f}s wall-clock deadline')
                    await agen.aclose()
                    break

                if event['event'] == '_internal_turn_complete':
                    new_response_id = event['data'].get('last_response_id')
                    if new_response_id:
                        runtime_session.last_response_id = new_response_id
                        working_session['last_response_id'] = new_response_id
                    final_output = event['data'].get('final_output') or ''
                    if final_output:
                        text = final_output
                    continue

                # Ephemeral: forward status events to SSE but do NOT persist.
                # Stale on reload; indicator falls back to phrase rotation.
                if event['event'] == 'status':
                    if emit is not None:
                        await emit({'event': 'status', 'data': event['data']})
                    continue

                if event['event'] == 'content_delta':
                    streamed_text_parts.append(event['data']['delta'])

                await _emit_runtime_event(
                    runtime_session,
                    event['event'],
                    event['data'],
                    emit,
                    db,
                )
                await db.commit()
        finally:
            pass

        tool_call_log = sherlock_ctx.tool_call_log
        chart_payload = sherlock_ctx.chart_payload
        composed_report = sherlock_ctx.composed_report
        warnings.extend(sherlock_ctx.warnings)
        if streamed_text_parts and not text:
            text = ''.join(streamed_text_parts)
        if not text:
            text = "I wasn't able to produce a response for this turn."
            warnings.append('empty model output')

        working_session['messages'] = []
        terminal_status = 'degraded' if warnings else 'done'
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=[],
            scratchpad=working_session['scratchpad'],
            status=terminal_status,
            last_error=None,
            db=db,
        )
        if runtime_session.last_response_id:
            await update_last_response_id(
                runtime_session=runtime_session,
                last_response_id=runtime_session.last_response_id,
                db=db,
            )

        if chart_payload is not None:
            # Phase 3: chart_payload is a finished discriminated union
            # ({kind, spec?, data?, kpi?, summary?, columns?, title,
            # source_question, sql_query, reason_code?, warning?}). Pass
            # it through unchanged so live SSE, persisted metadata, and
            # the ``done`` event all see the same object.
            await _emit_runtime_event(
                runtime_session,
                'chart',
                chart_payload,
                emit,
                db,
            )

        # Persisted copy is the same discriminated union — no reshape.
        persisted_chart = chart_payload

        metadata = {
            'terminalStatus': terminal_status,
            'warnings': warnings,
            'entityRecognition': entity_recognition_payload,
            'toolCalls': [
                {
                    'toolCallId': tc['tool_call_id'],
                    'name': tc['name'],
                    'summary': tc['summary'],
                    'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                }
                for tc in tool_call_log
            ],
            'composedReport': {
                'reportName': composed_report.get('report_name') or composed_report.get('name'),
                'sections': composed_report.get('sections', []),
            } if composed_report else None,
            'blueprint': {
                'type': 'blueprint',
                'name': composed_report.get('report_name') or composed_report.get('name'),
                'sections': composed_report.get('sections', []),
            } if composed_report else None,
            'chart': persisted_chart,
        }
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=text,
            metadata=metadata,
            status='complete',
            db=db,
        )
        done_payload = {
            'terminalStatus': terminal_status,
            'content': text,
            'toolCalls': [
                {
                    'toolCallId': tc['tool_call_id'],
                    'name': tc['name'],
                    'summary': tc['summary'],
                    'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                }
                for tc in tool_call_log
            ],
            'composedReport': {
                'reportName': composed_report.get('report_name') or composed_report.get('name'),
                'sections': composed_report.get('sections', []),
            } if composed_report else None,
            'blueprint': {
                'name': composed_report.get('report_name') or composed_report.get('name'),
                'sections': composed_report.get('sections', []),
            } if composed_report else None,
            'chart': persisted_chart,
            'warnings': warnings,
            'entityRecognition': entity_recognition_payload,
        }
        if turn is not None:
            try:
                usage_summary = await aggregate_turn_usage(
                    db,
                    owner_type='sherlock_turn',
                    owner_id=uuid.UUID(turn.id),
                )
            except Exception:
                logger.debug('aggregate_turn_usage failed', exc_info=True)
                usage_summary = None
            if usage_summary is not None:
                done_payload['usage'] = usage_summary
        done_event = await _emit_runtime_event(runtime_session, 'done', done_payload, emit, db)
        await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_terminal(
                turn_id=turn.id,
                status=terminal_status,
                last_event_seq=done_event['data']['seq'],
                last_error=None,
                db=db,
            )
        await db.commit()
        _sync_session_state(session, working_session)
    except (Exception, asyncio.CancelledError) as exc:
        terminal_status = 'interrupted' if isinstance(exc, asyncio.CancelledError) else 'error'
        error_text = str(exc)
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=[],
            scratchpad=working_session['scratchpad'],
            status=terminal_status,
            last_error=error_text,
            db=db,
        )
        if assistant_message_id is not None:
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=assistant_message_id,
                content=''.join(streamed_text_parts) if streamed_text_parts else error_text,
                metadata={
                    'terminalStatus': terminal_status,
                    'warnings': warnings,
                    'toolCalls': [
                        {
                            'toolCallId': tc['tool_call_id'],
                            'name': tc['name'],
                            'summary': tc['summary'],
                            'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                        }
                        for tc in tool_call_log
                    ],
                    'composedReport': None,
                    'chart': None,
                    'entityRecognition': entity_recognition_payload,
                },
                status='error',
                error_message=error_text,
                db=db,
            )
        error_event = await _emit_runtime_event(
            runtime_session,
            'error',
            {
                'terminalStatus': terminal_status,
                'message': error_text,
                'recoverable': False,
                'entityRecognition': entity_recognition_payload,
            },
            emit,
            db,
        )
        await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
        if turn is not None:
            await mark_turn_terminal(
                turn_id=turn.id,
                status=terminal_status,
                last_event_seq=error_event['data']['seq'],
                last_error=error_text,
                db=db,
            )
        await db.commit()
        _sync_session_state(session, working_session)
        _reset_turn_contextvars(correlation_token, sherlock_token)
        raise

    _reset_turn_contextvars(correlation_token, sherlock_token)
    return {
        "role": "assistant",
        "content": text,
        "tool_calls": tool_call_log,
        "composed_report": composed_report,
        "chart": chart_payload,
        "terminal_status": terminal_status,
        "warnings": warnings,
        "entity_recognition": entity_recognition_payload,
    }


async def run_chat_turn_streaming_background(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    auth: Any,
    turn: SherlockRuntimeTurnState,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    async with async_session() as recog_db:
        app_config = await load_app_config(recog_db, session['app_id'])
        semantic_model = load_semantic_model(session['app_id'], app_config=app_config)
        entity_registry = load_entity_registry(
            session['app_id'],
            app_config=app_config,
            semantic_model=semantic_model,
        )
        entity_recognition = await recognize_entities(
            question=user_message,
            scratchpad=session.get('scratchpad'),
            entity_registry=entity_registry,
            provider=provider,
            model=model,
            tenant_id=session['tenant_id'],
            user_id=session['user_id'],
            app_id=session.get('app_id'),
            turn_id=turn.id,
        )
        await recog_db.commit()

    await _execute_chat_turn(
        session,
        user_message,
        provider=provider,
        model=model,
        db=None,
        auth=auth,
        emit=on_event,
        turn=turn,
        entity_recognition=entity_recognition,
    )


