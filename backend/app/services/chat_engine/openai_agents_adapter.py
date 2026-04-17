"""
OpenAI Agents SDK adapter for Sherlock chat.

Replaces the custom ChatAdapter + run_tool_loop orchestration with
SDK-managed Runner.run_streamed(). Handles both native OpenAI and
Azure OpenAI through the same code path - only the client differs.

Design contract (do NOT violate):
  - Model backend MUST be OpenAIResponsesModel (Responses API).
    OpenAIChatCompletionsModel is forbidden because previous_response_id
    and ResponseTextDeltaEvent only work with the Responses API.
  - This adapter yields ONLY these event types:
      content_delta, tool_call_start, tool_call_end, error,
      _internal_turn_complete
    It does NOT yield chart/done/blueprint - chat_handler owns those.
  - SherlockContext.provider must be propagated to dispatch_tool_call.
  - temperature=0.3 and tool_choice policy come from build_sherlock_agent.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Awaitable, Callable

import openai
from agents import Agent, FunctionTool, Runner
from agents.model_settings import ModelSettings
from agents.models.openai_responses import OpenAIResponsesModel
from agents.tool_context import ToolContext
from openai.types.responses import ResponseTextDeltaEvent

logger = logging.getLogger(__name__)

EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]

# Wall-clock deadline for a single Sherlock turn. Mirrors the legacy
# runner's max_seconds. The caller wraps run_sherlock_sdk_turn in
# asyncio.wait_for using this value.
TURN_DEADLINE_SECONDS = 150.0


@dataclass
class SherlockContext:
    """Platform context passed to tools via RunContextWrapper."""

    db: Any
    auth: Any
    app_id: str
    provider: str
    working_session: dict[str, Any]
    emit: EventEmitter
    tool_call_log: list[dict[str, Any]] = field(default_factory=list)
    chart_payload: dict[str, Any] | None = None
    composed_report: dict[str, Any] | None = None
    warnings: list[str] = field(default_factory=list)
    streamed_text_parts: list[str] = field(default_factory=list)


def create_openai_client(
    *,
    api_key: str,
    azure: bool,
    azure_endpoint: str = '',
    api_version: str = '',
) -> openai.AsyncOpenAI:
    """Create an AsyncOpenAI or AsyncAzureOpenAI client."""

    if azure:
        return openai.AsyncAzureOpenAI(
            api_key=api_key,
            azure_endpoint=azure_endpoint,
            api_version=api_version,
        )
    return openai.AsyncOpenAI(api_key=api_key)


def build_sherlock_tools(tool_defs: list[dict[str, Any]]) -> list[FunctionTool]:
    """Create FunctionTool instances from Sherlock's JSON tool definitions."""

    tools: list[FunctionTool] = []
    for tool_def in tool_defs:
        tools.append(
            FunctionTool(
                name=tool_def['name'],
                description=tool_def.get('description', ''),
                params_json_schema=tool_def.get('inputSchema', {}),
                on_invoke_tool=_sherlock_tool_handler,
                strict_json_schema=False,
            )
        )
    return tools


def build_sherlock_agent(
    *,
    instructions: str,
    tools: list[dict[str, Any]],
    model: str,
    client: openai.AsyncOpenAI,
    force_first_tool_call: bool,
) -> Agent[SherlockContext]:
    """Construct the Sherlock Agent with the required Responses API model."""

    tool_choice: str | None = 'required' if force_first_tool_call else 'auto'
    return Agent[SherlockContext](
        name='Sherlock',
        instructions=instructions,
        model=OpenAIResponsesModel(model=model, openai_client=client),
        tools=build_sherlock_tools(tools),
        model_settings=ModelSettings(
            temperature=0.3,
            tool_choice=tool_choice,
        ),
    )


def _load_json_object(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def _sherlock_tool_handler(ctx: ToolContext[SherlockContext], args: str) -> str:
    """Dispatch a Sherlock tool call through the existing tool handler layer."""

    from app.services.report_builder.chat_handler import (
        _build_chart_payload,
        _build_tool_call_detail,
        _summarize_tool_result,
        _tool_call_warning,
        _update_scratchpad,
    )
    from app.services.report_builder.tool_handlers import dispatch_tool_call

    sc = ctx.context
    tool_name = ctx.tool_name
    arguments = _load_json_object(args)
    if args and not arguments:
        logger.warning('Tool %s received malformed JSON args', tool_name)
        return json.dumps({'status': 'error', 'message': 'Malformed tool arguments'})

    tool_call_id = ctx.tool_call_id or f'tc_{uuid.uuid4().hex[:12]}'

    await sc.emit({
        'event': 'tool_call_start',
        'data': {'toolName': tool_name, 'toolCallId': tool_call_id, 'name': tool_name},
    })

    start = time.monotonic()
    result_str = await dispatch_tool_call(
        tool_name,
        arguments,
        db=sc.db,
        auth=sc.auth,
        app_id=sc.app_id,
        provider=sc.provider,
        session=sc.working_session,
    )
    execution_ms = (time.monotonic() - start) * 1000

    detail = _build_tool_call_detail(tool_name, result_str, execution_ms=execution_ms)
    parsed_result = _load_json_object(result_str)

    if tool_name in ('data_query', 'analyze') and parsed_result.get('status') == 'ok':
        sc.chart_payload = _build_chart_payload(parsed_result)
    elif tool_name in ('compose_report', 'blueprint_compose') and parsed_result.get('status') == 'ok':
        sc.composed_report = parsed_result

    _update_scratchpad(sc.working_session, tool_name, result_str, app_id=sc.app_id)

    summary = _summarize_tool_result(tool_name, result_str)
    sc.tool_call_log.append(
        {
            'tool_call_id': tool_call_id,
            'name': tool_name,
            'summary': summary,
            'detail': detail,
            'duration_ms': execution_ms,
        }
    )
    warning = _tool_call_warning(tool_name, detail)
    if warning:
        sc.warnings.append(warning)

    await sc.emit({
        'event': 'tool_call_end',
        'data': {
            'toolName': tool_name,
            'toolCallId': tool_call_id,
            'name': tool_name,
            'summary': summary,
            'detail': detail.model_dump(by_alias=True, mode='json'),
            'durationMs': execution_ms,
        },
    })

    return result_str


async def run_sherlock_sdk_turn(
    *,
    user_message: str,
    instructions: str,
    tools: list[dict[str, Any]],
    sherlock_context: SherlockContext,
    model: str,
    client: openai.AsyncOpenAI,
    previous_response_id: str | None = None,
    force_first_tool_call: bool = False,
    max_turns: int = 15,
) -> AsyncGenerator[dict[str, Any], None]:
    """Run one Sherlock turn via the OpenAI Agents SDK."""

    agent = build_sherlock_agent(
        instructions=instructions,
        tools=tools,
        model=model,
        client=client,
        force_first_tool_call=force_first_tool_call,
    )

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def queue_emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    sherlock_context.emit = queue_emit
    last_response_id_holder: list[str | None] = [None]
    final_output_holder: list[str | None] = [None]

    async def _run() -> None:
        try:
            stream = Runner.run_streamed(
                agent,
                user_message,
                context=sherlock_context,
                max_turns=max_turns,
                previous_response_id=previous_response_id,
            )
            async for event in stream.stream_events():
                if event.type == 'raw_response_event' and isinstance(event.data, ResponseTextDeltaEvent):
                    delta = event.data.delta
                    if delta:
                        sherlock_context.streamed_text_parts.append(delta)
                        await queue.put({'event': 'content_delta', 'data': {'delta': delta}})

            final_output = getattr(stream, 'final_output', None)
            final_output_holder[0] = final_output if isinstance(final_output, str) else None
            last_response_id_holder[0] = stream.last_response_id
        except Exception as exc:
            logger.exception('Sherlock SDK turn error')
            await queue.put({
                'event': 'error',
                'data': {
                    'terminalStatus': 'error',
                    'message': str(exc),
                    'recoverable': False,
                },
            })
        finally:
            await queue.put(None)

    task = asyncio.create_task(_run())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    yield {
        'event': '_internal_turn_complete',
        'data': {
            'last_response_id': last_response_id_holder[0],
            'final_output': final_output_holder[0] or ''.join(sherlock_context.streamed_text_parts),
        },
    }
