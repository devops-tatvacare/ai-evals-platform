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
      content_delta, tool_call_start, tool_call_end, status, error,
      _internal_turn_complete
    It does NOT yield chart/done/blueprint - chat_handler owns those.
    The 'status' event is ephemeral UI decoration and MUST NOT be persisted
    by the caller (see chat_handler._execute_chat_turn loop).
  - All events pass through _StreamPacer so content_delta emissions are
    paced at a steady cadence (~25ms) and stay ordered with
    tool_call_start/end/status/error. Consumers can assume smooth,
    in-order deltas without adding their own throttle.
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

from app.services.cost_tracking.tracing import install_cost_tracking_processor
from app.services.chat_engine.artifact import (
    CAPABILITY_PACK_REGISTRY,
    Artifact,
    resolve_pack_for,
)

logger = logging.getLogger(__name__)

# Register the cost-tracking TracingProcessor at import time. The Agents SDK
# keeps one global trace provider; this call is a no-op after the first
# process-local invocation.
install_cost_tracking_processor()

EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]

# Wall-clock deadline for a single Sherlock turn. Mirrors the legacy
# runner's max_seconds. The caller wraps run_sherlock_sdk_turn in
# asyncio.wait_for using this value.
TURN_DEADLINE_SECONDS = 150.0

# ── Stream pacer tuning ────────────────────────────────────────────────
# The underlying LLM emits text in bursts (e.g. 200ms idle, then five
# tokens in 20ms). The pacer re-emits text at a steady cadence so the
# frontend shows a smooth stream. These constants define the contract.
#
#   TICK_MS          — ticker wake interval. Smaller = smoother, more CPU.
#   MIN_CHARS/TICK   — floor, so the stream never feels stalled.
#   MAX_CHARS/TICK   — cap, so a huge buffer can't spew in one frame.
#   TARGET_DRAIN_MS  — roughly how long the pacer aims to take to drain
#                      its current buffer. Under load, chars-per-tick
#                      grows to hit this target; on a trickle, it floors
#                      at MIN_CHARS.
STREAM_PACER_TICK_MS = 25
STREAM_PACER_MIN_CHARS_PER_TICK = 2
STREAM_PACER_MAX_CHARS_PER_TICK = 120
STREAM_PACER_TARGET_DRAIN_MS = 500


class _StreamPacer:
    """Paces ``content_delta`` events onto ``out_queue`` at a steady cadence.

    Why: OpenAI's Responses API emits tokens in bursts. Pushing those
    directly to the SSE stream creates visible judder — long pauses
    followed by big jumps. The pacer evens that out.

    Contract:
      * Text deltas go through :meth:`enqueue_text`. They are buffered
        and drained by the ticker task in paced chunks.
      * All other events (tool_call_start, tool_call_end, status, error)
        go through :meth:`enqueue_other`. Before the event is emitted,
        any buffered text is flushed first so consumers observe the
        same logical order the producer intended.
      * :meth:`start` launches the ticker task. :meth:`finalize` drains
        remaining text immediately (no rate limit) and stops the ticker.
        Safe to call more than once.

    Threading: this class is single-owner — one producer (the SDK
    consumer loop) and one consumer (the outer yield loop). Both live
    on the same asyncio loop, so buffer mutations are serialised by
    cooperative scheduling. No locks needed.
    """

    def __init__(self, out_queue: 'asyncio.Queue[dict[str, Any] | None]') -> None:
        self._out = out_queue
        self._buf: str = ''
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Launch the ticker task. Idempotent."""
        if self._task is None:
            self._task = asyncio.create_task(self._ticker(), name='sherlock-stream-pacer')

    async def enqueue_text(self, delta: str) -> None:
        if delta:
            self._buf += delta

    async def enqueue_other(self, event: dict[str, Any]) -> None:
        """Flush pending text, then emit the event. Preserves ordering."""
        await self._flush_all()
        await self._out.put(event)

    async def finalize(self) -> None:
        """Drain remaining text as fast as possible and stop the ticker.

        Safe to call multiple times. After finalize, further enqueue_*
        calls are accepted but new text may race with ticker shutdown;
        callers should treat finalize as end-of-stream.
        """
        self._stop.set()
        if self._task is not None and not self._task.done():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
        await self._flush_all()

    async def _flush_all(self) -> None:
        """Emit all buffered text in chunks sized by MAX_CHARS/TICK, no rate limit."""
        while self._buf:
            n = min(len(self._buf), STREAM_PACER_MAX_CHARS_PER_TICK)
            chunk, self._buf = self._buf[:n], self._buf[n:]
            await self._out.put({'event': 'content_delta', 'data': {'delta': chunk}})

    async def _ticker(self) -> None:
        """Drain self._buf at a steady cadence until :meth:`finalize` is called."""
        frames_per_drain = max(1, STREAM_PACER_TARGET_DRAIN_MS // STREAM_PACER_TICK_MS)
        tick_seconds = STREAM_PACER_TICK_MS / 1000.0
        while not self._stop.is_set():
            # Wake on deadline OR when finalize fires — whichever comes first.
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=tick_seconds)
                return  # stop event fired; exit cleanly
            except asyncio.TimeoutError:
                pass  # normal tick
            if not self._buf:
                continue
            # Size the chunk so the current buffer drains in ~TARGET_DRAIN_MS,
            # clamped to [MIN, MAX]. Uses ceil-division so we round up.
            chars_per_tick = max(
                STREAM_PACER_MIN_CHARS_PER_TICK,
                min(
                    STREAM_PACER_MAX_CHARS_PER_TICK,
                    -(-len(self._buf) // frames_per_drain),
                ),
            )
            chars_per_tick = min(chars_per_tick, len(self._buf))
            chunk, self._buf = self._buf[:chars_per_tick], self._buf[chars_per_tick:]
            await self._out.put({'event': 'content_delta', 'data': {'delta': chunk}})


# Friendly nouns for Sherlock status lines. Keep lowercase noun-phrase
# form — rendered as "Reasoning about the {noun} results…".
_TOOL_STATUS_NOUNS: dict[str, str] = {
    'catalog_inspect': 'schema inspection',
    'catalog_relations': 'table relation',
    'catalog_values': 'column value',
    'catalog_sample': 'sample row',
    'discover': 'data discovery',
    'lookup': 'dimension lookup',
    'resolve_entity': 'entity resolution',
    'get_surface_records': 'log record',
    'data_check': 'data availability',
    'data_query': 'query',
    'blueprint_blocks': 'blueprint catalog',
    'blueprint_compose': 'blueprint compose',
    'blueprint_save': 'blueprint save',
    'blueprint_list': 'blueprint list',
}


def _status_line_after_tool(tool_name: str) -> str:
    """Build the literal status string shown between tool end and next LLM call."""

    noun = _TOOL_STATUS_NOUNS.get(tool_name)
    if not noun:
        return 'Reasoning over the result…'
    return f'Reasoning over the {noun} results…'


@dataclass
class SherlockContext:
    """Platform context passed to tools via RunContextWrapper.

    No DB session is carried here. The Agents SDK runs function-tool calls
    in parallel via asyncio.gather (see agents/_run_impl.py), so a shared
    AsyncSession would race. Each tool handler opens its own session via
    async_session() inside _sherlock_tool_handler.
    """

    auth: Any
    app_id: str
    provider: str
    working_session: dict[str, Any]
    emit: EventEmitter
    tool_call_log: list[dict[str, Any]] = field(default_factory=list)
    # Phase 1: pack-produced results land here as opaque ``Artifact`` triples.
    # Harness Core does not inspect ``payload``/``extras`` — only the owning
    # capability pack does. ``chart_payload`` / ``composed_report`` were
    # removed in favour of this generic container so the harness stops
    # treating analytics + report-builder as Sherlock-wide state.
    artifacts: list[Artifact] = field(default_factory=list)
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
    """Create FunctionTool instances from Sherlock's JSON tool definitions.

    Phase 3 contract (plan §Phase-3 step 4): tools run in **strict**
    schema mode. The Agents SDK validates model-generated arguments
    against the tool's ``inputSchema`` BEFORE ``_sherlock_tool_handler``
    runs, so malformed / non-object JSON never reaches the handler on
    the happy path. ``_parse_tool_args`` is narrowed to the
    ``""`` / ``"{}"`` no-args recovery only (the Responses API emits
    that for tools with no required params). The handler still wraps any
    post-SDK parse failure in a ``MALFORMED_ARGS`` envelope via
    ``_finalize_tool_call`` so the outer agent can observe the reason
    code instead of an uncaught stack trace.
    """

    tools: list[FunctionTool] = []
    for tool_def in tool_defs:
        tools.append(
            FunctionTool(
                name=tool_def['name'],
                description=tool_def.get('description', ''),
                params_json_schema=tool_def.get('inputSchema', {}),
                on_invoke_tool=_sherlock_tool_handler,
                strict_json_schema=True,
            )
        )
    return tools


def build_sherlock_agent(
    *,
    instructions: str,
    tools: list[dict[str, Any]],
    model: str,
    client: openai.AsyncOpenAI,
) -> Agent[SherlockContext]:
    """Construct the Sherlock Agent with the required Responses API model.

    Phase 5: ``tool_choice`` is always ``'auto'``. The outer agent holds
    orchestration authority — it reasons → acts → observes the pinned
    envelope → replans. Both prior coercion paths (specific-tool and
    ``'required'``) are gone.
    """

    return Agent[SherlockContext](
        name='Sherlock',
        instructions=instructions,
        model=OpenAIResponsesModel(model=model, openai_client=client),
        tools=build_sherlock_tools(tools),
        model_settings=ModelSettings(
            temperature=0.3,
            tool_choice='auto',
            include_usage=True,
        ),
    )


def _load_json_object(raw: str) -> dict[str, Any]:
    """Best-effort parse of a tool *result* string — returns {} on any
    error or non-dict value. Suitable for result parsing where graceful
    fallback is desired. NOT suitable for parsing tool *arguments* — use
    :func:`_parse_tool_args` for that.
    """
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_tool_args(raw: str) -> dict[str, Any]:
    """Parse a tool-call argument JSON string.

    Phase 3 contract (plan §Phase-3 step 4): strict Agents SDK schemas
    reject malformed / non-object JSON at the SDK boundary before this
    helper runs. The recovery path is therefore narrowed to the
    ``""`` / ``"{}"`` / whitespace no-args contract ONLY — the Responses
    API emits empty args for tools whose schema has no required fields.
    Anything else is a contract violation: we raise ``ValueError`` /
    ``json.JSONDecodeError``, and the handler surrounds this call with
    a try/except that projects those errors into a harness-owned
    ``MALFORMED_ARGS`` envelope so the outer agent can observe the
    typed reason code (defensive belt+suspenders, not the happy path).
    """
    if raw is None or not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError(
            f'Expected tool arguments to be a JSON object; got {type(parsed).__name__}'
        )
    return parsed


async def _sherlock_tool_handler(ctx: ToolContext[SherlockContext], args: str) -> str:
    """Dispatch a Sherlock tool call through the existing tool handler layer.

    Each invocation opens its own AsyncSession. The Agents SDK runs tool
    calls in parallel (asyncio.gather) and the outer chat handler also uses
    its own session — sharing one session would raise
    ``InvalidRequestError: concurrent operations are not permitted``.
    """

    from app.database import async_session
    from app.services.report_builder.tool_handlers import dispatch_tool_call

    sc = ctx.context
    tool_name = ctx.tool_name
    tool_call_id = ctx.tool_call_id or f'tc_{uuid.uuid4().hex[:12]}'

    # Phase 3: strict Agents SDK schemas reject malformed args BEFORE this
    # handler runs, so the happy path never sees a bad parse. The try/except
    # below is defensive — if any non-object JSON still slips past the SDK,
    # we surface it as a §6.2 ``MALFORMED_ARGS`` envelope and route it
    # through the same tool_call_start / *_end / scratchpad / log path as
    # any other tool result so ``sherlock_runtime_events`` persists
    # ``data.outcome.reason_code = 'MALFORMED_ARGS'`` and the outer agent
    # can reason over it. This preserves the Phase 2 invariant that
    # malformed args are observed, not thrown.
    try:
        arguments = _parse_tool_args(args)
    except (json.JSONDecodeError, ValueError):
        from app.services.chat_engine import reason_codes
        from app.services.chat_engine.artifact import dump_tool_envelope, error_envelope

        logger.warning('Tool %s received malformed JSON args: %r', tool_name, args[:500])
        start = time.monotonic()
        envelope = error_envelope(
            capability='harness',
            reason_code=reason_codes.MALFORMED_ARGS,
            summary='Malformed tool arguments',
            warnings=['Expected a JSON object for tool arguments'],
            payload={},
        )
        result_str = json.dumps(dump_tool_envelope(envelope), default=str)
        execution_ms = (time.monotonic() - start) * 1000
        await _finalize_tool_call(
            sc=sc,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            result_str=result_str,
            execution_ms=execution_ms,
            emitted_start=False,
        )
        return result_str

    await sc.emit({
        'event': 'tool_call_start',
        'data': {'toolName': tool_name, 'toolCallId': tool_call_id, 'name': tool_name},
    })

    start = time.monotonic()
    async with async_session() as tool_db:
        try:
            result_str = await dispatch_tool_call(
                tool_name,
                arguments,
                db=tool_db,
                auth=sc.auth,
                app_id=sc.app_id,
                provider=sc.provider,
                session=sc.working_session,
            )
            # Persist writes made by handlers like blueprint_save (which only
            # flushes). Reads are unaffected; a trailing commit on a read-only
            # session is a no-op.
            await tool_db.commit()
        except Exception:
            await tool_db.rollback()
            raise
    execution_ms = (time.monotonic() - start) * 1000

    await _finalize_tool_call(
        sc=sc,
        tool_name=tool_name,
        tool_call_id=tool_call_id,
        result_str=result_str,
        execution_ms=execution_ms,
        emitted_start=True,
    )

    # Phase 2: SQL-agent failures (including the former
    # ``invalid_output_alias_contract`` fatal) now surface as a typed
    # ``outcome.reason_code`` in the returned envelope. The dispatcher no
    # longer raises — the outer agent observes the code and replans.

    return result_str


async def _finalize_tool_call(
    *,
    sc: SherlockContext,
    tool_name: str,
    tool_call_id: str,
    result_str: str,
    execution_ms: float,
    emitted_start: bool,
) -> None:
    """Common tool-call exit path: pack outcome dispatch, scratchpad, logs,
    and the tool_call_end + status events.

    The malformed-args branch and the normal handler path both land here so
    the §6.2 envelope flows through a single egress: ``sherlock_runtime_events``
    rows, ``tool_call_log`` entries, and SSE events all carry ``outcome``.
    ``emitted_start=False`` covers the malformed case where no tool_call_start
    was sent — we still emit it (paired with end) so the runtime sequence
    stays well-formed.
    """

    from app.services.report_builder.chat_handler import (
        _build_tool_call_detail,
        _summarize_tool_result,
        _tool_call_warning,
        _update_scratchpad,
    )

    if not emitted_start:
        await sc.emit({
            'event': 'tool_call_start',
            'data': {'toolName': tool_name, 'toolCallId': tool_call_id, 'name': tool_name},
        })

    detail = _build_tool_call_detail(tool_name, result_str, execution_ms=execution_ms)
    parsed_result = _load_json_object(result_str)

    # Phase 1: pack dispatch replaces hard-coded per-tool branches. The
    # harness knows nothing about which tools produce artifacts or what
    # shape they take — ``resolve_pack_for`` returns ``None`` for tools
    # that no pack claims, and the dispatcher simply skips them.
    pack_id = resolve_pack_for(tool_name)
    if pack_id is not None:
        pack = CAPABILITY_PACK_REGISTRY[pack_id]
        outcome = pack.build_outcome(tool_name, parsed_result)
        if outcome.artifact is not None:
            sc.artifacts.append(outcome.artifact)

    _update_scratchpad(sc.working_session, tool_name, result_str, app_id=sc.app_id)

    # Phase 2 Gate (plan §Phase-2 acceptance gate 4): project the §6.2
    # envelope's ``outcome`` block onto the ``tool_call_end`` SSE event so
    # ``sherlock_runtime_events`` persists a generic
    # ``data.outcome.reason_code`` — the outer agent (and any replay
    # consumer) observes the same deterministic decision the backend
    # made, without unpacking pack-specific payloads.
    outcome_block = parsed_result.get('outcome') if isinstance(parsed_result, dict) else None
    outcome_for_event: dict[str, Any] | None = None
    if isinstance(outcome_block, dict):
        outcome_for_event = {
            'kind': outcome_block.get('kind'),
            'capability': outcome_block.get('capability'),
            'reason_code': outcome_block.get('reason_code'),
            'warnings': list(outcome_block.get('warnings') or []),
            'counts': dict(outcome_block.get('counts') or {}),
        }
        if isinstance(outcome_block.get('artifact'), dict):
            outcome_for_event['artifact'] = {
                'type': outcome_block['artifact'].get('type'),
                'contract': outcome_block['artifact'].get('contract'),
                'extras': dict(outcome_block['artifact'].get('extras') or {}),
            }

    summary = _summarize_tool_result(tool_name, result_str)
    tool_call_log_entry: dict[str, Any] = {
        'tool_call_id': tool_call_id,
        'name': tool_name,
        'summary': summary,
        'detail': detail,
        'duration_ms': execution_ms,
    }
    if outcome_for_event is not None:
        tool_call_log_entry['outcome'] = outcome_for_event
    sc.tool_call_log.append(tool_call_log_entry)
    warning = _tool_call_warning(tool_name, detail)
    if warning:
        sc.warnings.append(warning)

    tool_call_end_payload: dict[str, Any] = {
        'toolName': tool_name,
        'toolCallId': tool_call_id,
        'name': tool_name,
        'summary': summary,
        'detail': detail.model_dump(by_alias=True, mode='json'),
        'durationMs': execution_ms,
    }
    if outcome_for_event is not None:
        tool_call_end_payload['outcome'] = outcome_for_event
    await sc.emit({
        'event': 'tool_call_end',
        'data': tool_call_end_payload,
    })

    await sc.emit({
        'event': 'status',
        'data': {'text': _status_line_after_tool(tool_name)},
    })


async def run_sherlock_sdk_turn(
    *,
    user_message: str,
    instructions: str,
    tools: list[dict[str, Any]],
    sherlock_context: SherlockContext,
    model: str,
    client: openai.AsyncOpenAI,
    previous_response_id: str | None = None,
    max_turns: int = 15,
) -> AsyncGenerator[dict[str, Any], None]:
    """Run one Sherlock turn via the OpenAI Agents SDK."""

    agent = build_sherlock_agent(
        instructions=instructions,
        tools=tools,
        model=model,
        client=client,
    )

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    pacer = _StreamPacer(queue)

    # All events (text deltas and out-of-band events alike) flow through the
    # pacer so ordering stays strict: any buffered text drains before the
    # next tool_call_*/status/error reaches the consumer.
    async def paced_emit(event: dict[str, Any]) -> None:
        await pacer.enqueue_other(event)

    sherlock_context.emit = paced_emit
    last_response_id_holder: list[str | None] = [None]
    final_output_holder: list[str | None] = [None]
    run_error_holder: list[Exception | None] = [None]

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
                        await pacer.enqueue_text(delta)

            final_output = getattr(stream, 'final_output', None)
            final_output_holder[0] = final_output if isinstance(final_output, str) else None
            last_response_id_holder[0] = stream.last_response_id
        except Exception as exc:
            logger.exception('Sherlock SDK turn error')
            run_error_holder[0] = exc
        finally:
            # Drain any text still in the pacer buffer, then signal end-of-stream.
            await pacer.finalize()
            await queue.put(None)

    pacer.start()
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
        # Belt-and-suspenders: if the outer consumer bails before _run's
        # finally completes, make sure the ticker task is stopped so it
        # doesn't leak into the next turn.
        await pacer.finalize()

    if run_error_holder[0] is not None:
        raise run_error_holder[0]

    yield {
        'event': '_internal_turn_complete',
        'data': {
            'last_response_id': last_response_id_holder[0],
            'final_output': final_output_holder[0] or ''.join(sherlock_context.streamed_text_parts),
        },
    }
