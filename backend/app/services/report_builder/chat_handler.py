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
from typing import Any, AsyncGenerator, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine import create_adapter, run_tool_loop
from app.services.chat_engine.entity_recognition import (
    EntityRecognitionResult,
    recognize_entities,
    render_entity_recognition_context,
)
from app.services.chat_engine.entity_registry import load_entity_registry
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
)
from app.services.report_builder.turn_store import (
    SherlockRuntimeTurnState,
    mark_turn_active,
    mark_turn_terminal,
)
from app.services.report_builder.tool_handlers import dispatch_tool_call

logger = logging.getLogger(__name__)

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


def _build_chart_payload(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict) or result.get('status') != 'ok':
        return None
    rows = result.get('data')
    chart_options = result.get('chart_options')
    if not isinstance(rows, list) or not rows or not isinstance(chart_options, dict):
        return None
    suggested = chart_options.get('suggested')
    if not isinstance(suggested, dict):
        return None

    chart_type = str(suggested.get('type') or '').strip()
    x_key = str(suggested.get('x') or '').strip()
    y_keys = [str(value) for value in suggested.get('y', []) if value]
    series_dimension = str(suggested.get('series') or '').strip() or None
    if not chart_type or not x_key or not y_keys:
        return None

    data_rows = [row for row in rows if isinstance(row, dict)]
    spec: dict[str, Any] = {
        'type': chart_type,
        'title': _chart_title_from_result(result),
        'xKey': x_key,
        'xLabel': str(suggested.get('x_label') or x_key),
        'yLabel': str(suggested['y_label']) if suggested.get('y_label') else None,
        'legendPosition': 'right' if chart_type in {'pie', 'donut', 'radar', 'radial_bar'} else 'bottom',
    }

    if series_dimension and len(y_keys) == 1:
        data_rows, series_keys = _pivot_chart_rows(
            data_rows,
            x_key=x_key,
            series_key=series_dimension,
            value_key=y_keys[0],
        )
        if series_keys:
            spec['seriesKeys'] = series_keys
        else:
            spec['yKey'] = y_keys[0]
    elif chart_type in {'pie', 'donut', 'funnel', 'radial_bar', 'treemap'}:
        spec['yKey'] = y_keys[0]
    elif chart_type == 'scatter':
        spec['seriesKeys'] = y_keys[:1]
    elif chart_type == 'composed':
        spec['series'] = [
            {
                'dataKey': key,
                'type': 'line' if index == 0 else 'bar',
            }
            for index, key in enumerate(y_keys[:3])
        ]
    elif len(y_keys) > 1:
        spec['seriesKeys'] = y_keys[:3]
    else:
        spec['yKey'] = y_keys[0]

    # Prefer LLM-provided alternatives (already validated in _build_chart_options);
    # fall back to the rule-based eligible_types list.
    hint_alternatives = [
        str(v) for v in (suggested.get('alternatives') or [])
        if isinstance(v, str) and v != chart_type
    ]
    eligible = hint_alternatives or [
        str(value)
        for value in chart_options.get('eligible_types', [])
        if isinstance(value, str) and value != chart_type
    ]
    if eligible:
        spec['alternatives'] = eligible[:3]

    return {
        'spec': spec,
        'data': data_rows,
        'sql_query': result.get('sql_used', ''),
        'source_question': result.get('question', ''),
    }


async def assemble_context(session: dict[str, Any], db: AsyncSession) -> str:
    """Build the report-builder system prompt from layered context modules."""
    from app.services.chat_engine.prompts import base, app_context, scratchpad, user_context

    session.setdefault('scratchpad', default_scratchpad())
    session.setdefault('_app_context', None)
    session.setdefault('_user_context', None)

    parts = [
        base.render(),
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
        '_app_context': session.get('_app_context'),
        '_user_context': session.get('_user_context'),
    }


def _sync_session_state(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key in ('messages', 'scratchpad', '_app_context', '_user_context'):
        target[key] = source.get(key)


def _off_topic_response(app_config: dict[str, Any] | None, app_id: str) -> str:
    label = str((app_config or {}).get('displayName') or (app_config or {}).get('display_name') or app_id).strip() or app_id
    return f"I'm Sherlock, a data detective for {label}. I can help with evaluation analytics, rule compliance, trends, and more."


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

    if tool_name in {'compose_report', 'blueprint_compose'} and data.get('status') == 'ok':
        pad['composed_report'] = {
            'name': data.get('report_name') or data.get('name') or 'Untitled',
            'sections': [
                section.get('type')
                for section in data.get('sections', [])
                if isinstance(section, dict) and section.get('type')
            ],
        }
        return

    if tool_name in {'save_template', 'blueprint_save'}:
        name = data.get('report_name') or data.get('name')
        if name:
            pad['findings'].append(f'Saved template: {name}')
            session['_user_context'] = None


def _summarize_tool_result(name: str, result_str: str) -> str:
    """Extract a short label from a tool result for the UI badge."""
    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return "done"

    if name in {"data_query", "analyze"}:
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
    if name == "list_section_types":
        sections = data.get("sections", [])
        return f"{len(sections)} types"
    if name == "list_app_sections":
        app_id = data.get("app_id", "")
        sections = data.get("sections", [])
        return f"{app_id} · {len(sections)} sections" if app_id else f"{len(sections)} sections"
    if name == "get_section_detail":
        return data.get("key", data.get("label", "done"))
    if name in {"compose_report", "blueprint_compose"}:
        sections = data.get("sections", [])
        return f"{len(sections)} sections"
    if name in {"save_template", "blueprint_save"}:
        return data.get("report_name", data.get('name', "saved"))
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

    Injects allowed table names into catalog/data tool schemas so the LLM
    sees the valid enum values and never hallucinates table names.
    """
    from sqlalchemy import select
    from app.models.app import App
    from app.schemas.app_config import AppConfig

    result = await db.execute(
        select(App.config).where(App.slug == app_id, App.is_active.is_(True))
    )
    raw_config = result.scalar_one_or_none()
    app_config = AppConfig.model_validate(raw_config or {})
    capabilities = app_config.chat.capabilities or None
    tools = resolve_tools(capabilities)

    # Inject allowed table names into every tool that has a "table" parameter.
    semantic_model = load_semantic_model(app_id, app_config=raw_config)
    allowed = sorted({
        t.lower() for t in (semantic_model.get('tables') or {}).keys()
    })
    if allowed:
        tools = copy.deepcopy(tools)
        for tool in tools:
            props = (tool.get('inputSchema') or {}).get('properties', {})
            if 'table' in props and props['table'].get('type') == 'string':
                props['table']['enum'] = allowed
                props['table']['description'] = f'Table to query. Must be one of: {", ".join(allowed)}'

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
    )


def _new_tool_call_id() -> str:
    return f'tc_{uuid.uuid4().hex[:12]}'


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
    db: AsyncSession,
    auth: 'Any',
    emit: EventEmitter | None = None,
    turn: SherlockRuntimeTurnState | None = None,
) -> dict[str, Any]:
    tools = await _resolve_tools_for_app(session["app_id"], db)
    working_session = _copy_working_session(session)
    runtime_session = _runtime_session_from_state(working_session, provider, model)
    app_config = await load_app_config(db, working_session['app_id'])
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
    )
    entity_recognition_payload = _serialize_entity_recognition(entity_recognition)

    messages: list[Any] = []
    serialize_messages = lambda data: list(data)

    composed_report: dict | None = None
    tool_call_log: list[dict[str, Any]] = []
    last_query: dict | None = None
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

        if not entity_recognition.is_platform_query:
            text = _off_topic_response(app_config, working_session['app_id'])
            serialized_messages = list(working_session.get('messages', []))
            metadata = {
                'terminalStatus': 'done',
                'warnings': [],
                'toolCalls': [],
                'composedReport': None,
                'chart': None,
                'entityRecognition': entity_recognition_payload,
            }
            await save_runtime_state(
                runtime_session=runtime_session,
                message_state=serialized_messages,
                scratchpad=working_session['scratchpad'],
                status='done',
                last_error=None,
                db=db,
            )
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=assistant_message_id,
                content=text,
                metadata=metadata,
                status='complete',
                db=db,
            )
            done_event = await _emit_runtime_event(
                runtime_session,
                'done',
                {
                    'terminalStatus': 'done',
                    'content': text,
                    'toolCalls': [],
                    'composedReport': None,
                    'chart': None,
                    'warnings': [],
                    'entityRecognition': entity_recognition_payload,
                },
                emit,
                db,
            )
            await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
            if turn is not None:
                await mark_turn_terminal(
                    turn_id=turn.id,
                    status='done',
                    last_event_seq=done_event['data']['seq'],
                    last_error=None,
                    db=db,
                )
            await db.commit()
            _sync_session_state(session, working_session)
            return {
                'role': 'assistant',
                'content': text,
                'tool_calls': [],
                'composed_report': None,
                'chart': None,
                'terminal_status': 'done',
                'warnings': [],
                'entity_recognition': entity_recognition_payload,
            }

        adapter = await create_adapter(
            provider=provider,
            model=model,
            tenant_id=working_session["tenant_id"],
            user_id=working_session["user_id"],
        )
        deserialize_messages = getattr(adapter, 'deserialize', lambda data: list(data))
        serialize_messages = getattr(adapter, 'serialize', lambda data: list(data))
        messages = deserialize_messages(working_session.get('messages', []))
        messages.append(adapter.build_user_message(user_message))
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

        async def dispatch(name: str, arguments: dict) -> str:
            nonlocal composed_report, last_query, chart_payload

            tool_call_id = _new_tool_call_id()
            await _emit_runtime_event(
                runtime_session,
                'tool_call_start',
                {'name': name, 'toolName': name, 'toolCallId': tool_call_id},
                emit,
                db,
            )

            start = time.monotonic()
            result_str = await dispatch_tool_call(
                name, arguments,
                db=db,
                auth=auth,
                app_id=working_session["app_id"],
                provider=provider,
                session=working_session,
            )
            execution_ms = (time.monotonic() - start) * 1000
            detail = _build_tool_call_detail(name, result_str, execution_ms=execution_ms)

            if name in {"data_query", "analyze"}:
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    last_query = parsed
                    chart_payload = _build_chart_payload(parsed)
            elif name in {"compose_report", "blueprint_compose"}:
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    composed_report = parsed

            _update_scratchpad(working_session, name, result_str, app_id=working_session.get("app_id", ""))

            summary = _summarize_tool_result(name, result_str)
            tool_call_log.append(
                {
                    'tool_call_id': tool_call_id,
                    'name': name,
                    'summary': summary,
                    'detail': detail,
                    'duration_ms': execution_ms,
                }
            )
            warning = _tool_call_warning(name, detail)
            if warning:
                warnings.append(warning)
            await _emit_runtime_event(
                runtime_session,
                'tool_call_end',
                {
                    'name': name,
                    'toolName': name,
                    'toolCallId': tool_call_id,
                    'summary': summary,
                    'detail': detail.model_dump(by_alias=True, mode='json'),
                    'durationMs': execution_ms,
                },
                emit,
                db,
            )

            return result_str

        async def on_text_delta(delta: str) -> None:
            if not delta:
                return
            streamed_text_parts.append(delta)
            await _emit_runtime_event(
                runtime_session,
                'content_delta',
                {'delta': delta},
                emit,
                db,
            )

        text, messages = await run_tool_loop(
            adapter=adapter,
            messages=messages,
            tools=tools,
            system=system,
            temperature=0.3,
            dispatch_fn=dispatch,
            max_rounds=MAX_TOOL_ROUNDS,
            first_round_tool_choice='any' if entity_recognition.needs_resolution else 'auto',
            on_text_delta=on_text_delta,
        )

        if text is None:
            text = "I've reached the maximum number of tool calls for this turn. Please try a simpler request."
            warnings.append('maximum tool-call rounds reached')
        elif streamed_text_parts:
            text = ''.join(streamed_text_parts)

        serialized_messages = serialize_messages(messages)
        working_session["messages"] = serialized_messages
        terminal_status = 'degraded' if warnings else 'done'
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=serialized_messages,
            scratchpad=working_session['scratchpad'],
            status=terminal_status,
            last_error=None,
            db=db,
        )

        if chart_payload is not None:
            await _emit_runtime_event(
                runtime_session,
                'chart',
                {
                    'spec': chart_payload['spec'],
                    'data': chart_payload['data'],
                    'sqlQuery': chart_payload['sql_query'],
                    'sourceQuestion': chart_payload['source_question'],
                },
                emit,
                db,
            )

        persisted_chart = None
        if chart_payload is not None:
            persisted_chart = {
                'spec': chart_payload['spec'],
                'data': chart_payload['data'],
                'sqlQuery': chart_payload['sql_query'],
                'sourceQuestion': chart_payload['source_question'],
            }

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
            message_state=serialize_messages(messages),
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
        raise

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


async def run_chat_turn(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
    auth: "Any",
    turn: SherlockRuntimeTurnState | None = None,
) -> dict[str, Any]:
    """
    Process one user message through the LLM with tool calling.
    Returns the final assistant response + any composed report config.
    """
    return await _execute_chat_turn(
        session,
        user_message,
        provider=provider,
        model=model,
        db=db,
        auth=auth,
        emit=None,
        turn=turn,
    )


async def run_chat_turn_streaming(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
    auth: "Any",
    turn: SherlockRuntimeTurnState | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Generator version of run_chat_turn that yields SSE-style event dicts.
    Each yielded dict has {"event": str, "data": dict}.
    """
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    async def worker() -> None:
        try:
            await _execute_chat_turn(
                session,
                user_message,
                provider=provider,
                model=model,
                db=db,
                auth=auth,
                emit=emit,
                turn=turn,
            )
        except (Exception, asyncio.CancelledError):
            logger.debug('Sherlock stream worker terminated after terminal event', exc_info=True)
        finally:
            await queue.put(None)

    task = asyncio.create_task(worker())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
        await task
    finally:
        if not task.done():
            task.cancel()
