"""
Report builder chat surface.
Wires report-specific tools and system prompt into the shared chat engine.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.chat_engine import create_adapter, run_tool_loop
from app.services.report_builder.schemas import ToolCallDetailOut
from app.services.report_builder.tool_definitions import resolve_tools
from app.services.report_builder.runtime_store import (
    SherlockRuntimeSession,
    append_runtime_event,
    create_assistant_message,
    finalize_assistant_message,
    record_user_message,
    save_runtime_state,
)
from app.services.report_builder.tool_handlers import dispatch_tool_call

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5
EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]


async def assemble_context(session: dict[str, Any], db: AsyncSession) -> str:
    """Build the report-builder system prompt from layered context modules."""
    from app.services.chat_engine.prompts import base, app_context, scratchpad, user_context

    session.setdefault('scratchpad', {
        'findings': [],
        'composed_report': None,
        'errors': [],
    })
    session.setdefault('_app_context', None)
    session.setdefault('_user_context', None)

    parts = [
        base.render(),
        await app_context.render(session, db),
        await user_context.render(session, db),
        scratchpad.render(session),
    ]
    return '\n\n'.join(part for part in parts if part)


def _update_scratchpad(session: dict[str, Any], tool_name: str, result_str: str) -> None:
    """Capture compact tool outcomes for the next turn's prompt."""
    pad = session.setdefault('scratchpad', {
        'findings': [],
        'composed_report': None,
        'errors': [],
    })

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

    if tool_name == 'analyze' and data.get('status') == 'ok':
        question = str(data.get('question', '')).strip()
        row_count = data.get('row_count', 0)
        if question:
            pad['findings'].append(f'{question} ({row_count} rows)')
        return

    if tool_name == 'compose_report' and data.get('status') == 'ok':
        pad['composed_report'] = {
            'name': data.get('report_name') or 'Untitled',
            'sections': [
                section.get('type')
                for section in data.get('sections', [])
                if isinstance(section, dict) and section.get('type')
            ],
        }
        return

    if tool_name == 'save_template':
        name = data.get('report_name')
        if name:
            pad['findings'].append(f'Saved template: {name}')
            session['_user_context'] = None


def _summarize_tool_result(name: str, result_str: str) -> str:
    """Extract a short label from a tool result for the UI badge."""
    try:
        data = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return "done"

    if name == "analyze":
        row_count = data.get("row_count", 0)
        status = data.get("status", "")
        if status == "error" or data.get("error"):
            return "query failed"
        return f"{row_count} rows"
    if name == "list_section_types":
        sections = data.get("sections", [])
        return f"{len(sections)} types"
    if name == "list_app_sections":
        app_id = data.get("app_id", "")
        sections = data.get("sections", [])
        return f"{app_id} · {len(sections)} sections" if app_id else f"{len(sections)} sections"
    if name == "get_section_detail":
        return data.get("key", data.get("label", "done"))
    if name == "compose_report":
        sections = data.get("sections", [])
        return f"{len(sections)} sections"
    if name == "save_template":
        return data.get("report_name", "saved")
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

    if name == 'analyze':
        detail.sql_used = data.get('sql_used')
        detail.row_count = data.get('row_count')
        detail.cache_hit = bool(data.get('cache_hit', False))

    return detail


async def _resolve_tools_for_app(app_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    """Resolve tools from App.config.chat.capabilities. Falls back to all tools."""
    from sqlalchemy import select
    from app.models.app import App

    result = await db.execute(
        select(App.config).where(App.slug == app_id, App.is_active.is_(True))
    )
    config = result.scalar_one_or_none()
    capabilities = None
    if config:
        chat_config = (config or {}).get("chat", {})
        capabilities = chat_config.get("capabilities")
    return resolve_tools(capabilities)


def _runtime_session_from_state(session: dict[str, Any], provider: str, model: str) -> SherlockRuntimeSession:
    return SherlockRuntimeSession(
        chat_session_id=session['chat_session_id'],
        app_id=session['app_id'],
        tenant_id=session['tenant_id'],
        user_id=session['user_id'],
        provider=provider,
        model=model,
        message_state=list(session.get('messages', [])),
        scratchpad=dict(session.get('scratchpad', {
            'findings': [],
            'composed_report': None,
            'errors': [],
        })),
        next_event_seq=1,
    )


async def _emit_runtime_event(
    runtime_session: SherlockRuntimeSession,
    event_type: str,
    payload: dict[str, Any],
    emit: EventEmitter | None,
) -> dict[str, Any]:
    seq = await append_runtime_event(
        runtime_session=runtime_session,
        event_type=event_type,
        payload=payload,
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
) -> dict[str, Any]:
    tools = await _resolve_tools_for_app(session["app_id"], db)

    adapter = await create_adapter(
        provider=provider,
        model=model,
        tenant_id=session["tenant_id"],
        user_id=session["user_id"],
    )
    runtime_session = _runtime_session_from_state(session, provider, model)
    deserialize_messages = getattr(adapter, 'deserialize', lambda data: list(data))
    serialize_messages = getattr(adapter, 'serialize', lambda data: list(data))

    messages = deserialize_messages(session.get('messages', []))
    await record_user_message(runtime_session=runtime_session, content=user_message)
    assistant_message_id = await create_assistant_message(runtime_session=runtime_session)
    await _emit_runtime_event(
        runtime_session,
        'user_message_added',
        {'role': 'user', 'content': user_message},
        None,
    )

    messages.append(adapter.build_user_message(user_message))
    system = await assemble_context(session, db)

    composed_report: dict | None = None
    tool_call_log: list[dict[str, Any]] = []
    last_analyze: dict | None = None
    chart_spec: dict | None = None
    streamed_text_parts: list[str] = []

    try:
        async def dispatch(name: str, arguments: dict) -> str:
            nonlocal composed_report, last_analyze, chart_spec

            await _emit_runtime_event(
                runtime_session,
                'tool_call_start',
                {'name': name},
                emit,
            )

            start = time.monotonic()
            result_str = await dispatch_tool_call(
                name, arguments,
                db=db,
                auth=auth,
                app_id=session["app_id"],
                provider=provider,
            )
            execution_ms = (time.monotonic() - start) * 1000
            detail = _build_tool_call_detail(name, result_str, execution_ms=execution_ms)

            if name == "compose_report":
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    composed_report = parsed

            if name == "analyze":
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    last_analyze = parsed

            if name == "render_chart":
                parsed = json.loads(result_str)
                if parsed.get("status") == "ok":
                    chart_spec = parsed.get("chart_spec")

            if name == "save_template":
                await db.commit()

            _update_scratchpad(session, name, result_str)

            summary = _summarize_tool_result(name, result_str)
            tool_call_log.append({"name": name, "summary": summary, "detail": detail})
            await _emit_runtime_event(
                runtime_session,
                'tool_call_end',
                {'name': name, 'summary': summary, 'detail': detail.model_dump(by_alias=True, mode='json')},
                emit,
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
            )

        text, messages = await run_tool_loop(
            adapter=adapter,
            messages=messages,
            tools=tools,
            system=system,
            temperature=0.3,
            dispatch_fn=dispatch,
            max_rounds=MAX_TOOL_ROUNDS,
            on_text_delta=on_text_delta,
        )

        if text is None:
            text = "I've reached the maximum number of tool calls for this turn. Please try a simpler request."
        elif streamed_text_parts:
            text = ''.join(streamed_text_parts)

        serialized_messages = serialize_messages(messages)
        session["messages"] = serialized_messages
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=serialized_messages,
            scratchpad=session['scratchpad'],
            status='active',
        )

        chart_payload = {
            "spec": chart_spec,
            "data": last_analyze.get("data", []),
            "sql_query": last_analyze.get("sql_used", ""),
            "source_question": last_analyze.get("question", ""),
        } if chart_spec and last_analyze else None
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
            'toolCalls': [
                {
                    'name': tc['name'],
                    'summary': tc['summary'],
                    'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                }
                for tc in tool_call_log
            ],
            'composedReport': {
                'reportName': composed_report.get('report_name'),
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
        )

        done_payload = {
            'toolCalls': [
                {
                    'name': tc['name'],
                    'summary': tc['summary'],
                    'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                }
                for tc in tool_call_log
            ],
            'composedReport': {
                'reportName': composed_report.get('report_name'),
                'sections': composed_report.get('sections', []),
            } if composed_report else None,
        }
        await _emit_runtime_event(runtime_session, 'done', done_payload, emit)
    except Exception as exc:
        error_text = str(exc)
        await save_runtime_state(
            runtime_session=runtime_session,
            message_state=serialize_messages(messages),
            scratchpad=session['scratchpad'],
            status='error',
            last_error=error_text,
        )
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=error_text,
            metadata={
                'toolCalls': [
                    {
                        'name': tc['name'],
                        'summary': tc['summary'],
                        'detail': tc['detail'].model_dump(by_alias=True, mode='json') if tc.get('detail') else None,
                    }
                    for tc in tool_call_log
                ],
                'composedReport': None,
                'chart': None,
            },
            status='error',
            error_message=error_text,
        )
        await _emit_runtime_event(runtime_session, 'error', {'message': error_text}, emit)
        raise

    return {
        "role": "assistant",
        "content": text,
        "tool_calls": tool_call_log,
        "composed_report": composed_report,
        "chart": chart_payload,
    }


async def run_chat_turn(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
    auth: "Any",
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
    )


async def run_chat_turn_streaming(
    session: dict[str, Any],
    user_message: str,
    *,
    provider: str,
    model: str,
    db: AsyncSession,
    auth: "Any",
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
            )
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
