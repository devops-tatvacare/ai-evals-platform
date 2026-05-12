"""Sherlock v3 turn orchestrator — runs one chat turn end-to-end.

Owns the persistence side-effects of running a turn so the route
handler stays thin:

  1. Open a fresh AsyncSession.
  2. Create the assistant message row + flip the turn from queued→running.
  3. Stream v3 SSE events through ``on_event`` (caller bridges to the
     SSE wire). Events are emitted in their native v3 vocabulary —
     ``content_delta`` (with ``phase``), ``specialist_started`` /
     ``specialist_finished``, ``artifact_emitted``, ``turn_finished``,
     ``error_emitted``. No v2 translation.
  4. Finalize the assistant message (content + status).
  5. Mark the turn terminal.
  6. Persist ``last_response_id`` onto the agent session for the next turn.

The route handler at ``backend/app/routes/report_builder.py:_turn_task``
calls this. Each yielded event has shape ``{'event': <name>, 'data': {...}}``
so the existing ``_publish_turn_event`` / ``_format_sse`` plumbing works
unchanged.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from app.auth.context import AuthContext
from app.database import async_session
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.report_builder.runtime_store import (
    SherlockAgentSessionState,
    create_assistant_message,
    finalize_assistant_message,
)
from app.services.report_builder.turn_store import (
    SherlockConversationTurnState,
    mark_turn_active,
    mark_turn_terminal,
)
from app.services.sherlock_v3.runtime import SherlockTurnContext, run_turn

logger = logging.getLogger(__name__)


def _to_wire_event(
    v3_event: dict[str, Any],
    *,
    seq: int,
) -> dict[str, Any] | None:
    """Wrap a v3 runtime event in the ``{event, data}`` envelope used by
    ``_publish_turn_event`` / ``_format_sse``. Returns ``None`` for
    runtime-internal events that shouldn't go on the wire (e.g.,
    ``turn_finished`` — emitted by this orchestrator separately so it
    can carry the final assistant message id).
    """
    kind = v3_event.get('type')
    if kind in (None, 'turn_finished'):
        return None
    if kind == 'agent_updated':
        return None  # widget doesn't need this; logged for audit instead

    data = {k: v for k, v in v3_event.items() if k != 'type'}
    data['seq'] = seq
    return {'event': kind, 'data': data}


async def run_chat_turn(
    *,
    runtime_session: SherlockAgentSessionState,
    user_message: str,
    turn: SherlockConversationTurnState,
    on_event: Callable[[dict[str, Any]], Awaitable[int]],
    auth: AuthContext,
    builder_context: BuilderSnapshot | None = None,
) -> None:
    """Drive one Sherlock v3 turn through the SSE wire + DB persistence.

    Emits v3-native events; no v2 translation layer.

    `auth` is required so the per-tool authoring re-check (R3) and the
    supervisor's conditional inclusion (R2) have the same source of
    truth as the route gate. `builder_context` is the per-turn canvas
    snapshot — non-None ONLY when the chat widget is mounted on an
    orchestration builder page AND the user holds `orchestration:manage`.
    """
    async with async_session() as db:
        assistant_message_id = await create_assistant_message(
            runtime_session=runtime_session, db=db,
        )
        await mark_turn_active(
            turn_id=turn.id,
            assistant_message_id=assistant_message_id,
            db=db,
        )
        await db.commit()

    v3_ctx = SherlockTurnContext(
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        app_id=runtime_session.app_id,
        chat_session_id=uuid.UUID(runtime_session.chat_session_id),
        turn_id=uuid.UUID(turn.id),
        auth=auth,
        builder_context=builder_context,
        previous_response_id=runtime_session.last_response_id,
    )

    seq = turn.last_event_seq
    accumulated_text: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    last_published_seq = turn.last_event_seq
    final_event: dict[str, Any] | None = None
    failure: Exception | None = None

    try:
        async for v3_event in run_turn(user_message, v3_ctx):
            if v3_event.get('type') == 'turn_finished':
                final_event = v3_event
                continue
            if (v3_event.get('type') == 'content_delta'
                    and v3_event.get('phase') == 'final_answer'):
                accumulated_text.append(v3_event.get('text', ''))
            if v3_event.get('type') == 'specialist_started':
                tool_calls.append({
                    'toolCallId': str(v3_event.get('call_id') or ''),
                    'name': str(v3_event.get('specialist') or 'data_specialist'),
                    'summary': str(v3_event.get('brief_summary') or ''),
                    'detail': None,
                    'outcome': {'kind': 'running', 'capability': str(v3_event.get('specialist') or '')},
                })
            if v3_event.get('type') == 'specialist_finished':
                _merge_finished_tool_call(tool_calls, v3_event)
            if v3_event.get('type') == 'artifact_emitted':
                artifacts.append(_artifact_to_metadata(v3_event))
            seq += 1
            wire = _to_wire_event(v3_event, seq=seq)
            if wire is not None:
                last_published_seq = await on_event(wire)
    except Exception as exc:  # noqa: BLE001
        logger.exception('sherlock_v3 turn orchestrator failed')
        failure = exc
        seq += 1
        last_published_seq = await on_event({
            'event': 'error_emitted',
            'data': {
                'seq': seq,
                'source': 'orchestrator',
                'message': f'{type(exc).__name__}: {exc}',
                'recoverable': False,
            },
        })

    # Compose the v3-native turn_finished event with the assistant message id
    # we created at the top of the turn.
    seq += 1
    if failure is None and final_event is not None:
        terminal_status = final_event.get('status', 'done')
        usage = final_event.get('usage') or {}
        last_response_id = final_event.get('last_response_id')
    else:
        terminal_status = 'error'
        usage = {}
        last_response_id = None
    usage = await _price_usage(usage, runtime_session=runtime_session)
    await _record_turn_llm_usage(
        usage=usage,
        runtime_session=runtime_session,
        turn=turn,
        terminal_status=terminal_status,
    )

    last_published_seq = await on_event({
        'event': 'turn_finished',
        'data': {
            'seq': seq,
            'turn_id': turn.id,
            'status': terminal_status,
            'final_message_id': assistant_message_id,
            'usage': usage,
            'toolCalls': tool_calls,
            'artifacts': artifacts,
        },
    })

    final_message_status = 'complete' if failure is None else 'error'
    final_error = (
        None if failure is None else f'{type(failure).__name__}: {failure}'
    )

    async with async_session() as db:
        metadata = {
            'terminalStatus': _to_frontend_terminal_status(terminal_status),
            'toolCalls': tool_calls,
            'artifacts': artifacts,
            'usage': _usage_to_camel(usage),
        }
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=''.join(accumulated_text),
            metadata=metadata,
            status=final_message_status,
            error_message=final_error,
            db=db,
        )
        await mark_turn_terminal(
            turn_id=turn.id,
            status=terminal_status,
            last_event_seq=last_published_seq,
            last_error=final_error,
            db=db,
        )
        if last_response_id:
            await _persist_last_response_id(
                db=db,
                chat_session_id=runtime_session.chat_session_id,
                last_response_id=last_response_id,
            )
        await db.commit()


def _merge_finished_tool_call(
    tool_calls: list[dict[str, Any]],
    event: dict[str, Any],
) -> None:
    call_id = str(event.get('call_id') or '')
    specialist_name = str(event.get('specialist') or 'data_specialist')
    match = next(
        (tool_call for tool_call in reversed(tool_calls) if tool_call.get('toolCallId') == call_id),
        None,
    )
    if match is None and isinstance(event.get('routing'), dict):
        match = next(
            (
                tool_call for tool_call in reversed(tool_calls)
                if tool_call.get('name') == specialist_name
                and not isinstance(tool_call.get('routing'), dict)
                and not _tool_call_detail_has_data(tool_call.get('detail'))
            ),
            None,
        )
    if match is None:
        match = {
            'toolCallId': call_id,
            'name': specialist_name,
            'summary': '',
            'detail': None,
            'outcome': {},
        }
        tool_calls.append(match)
    match['toolCallId'] = call_id or str(match.get('toolCallId') or '')
    match['name'] = specialist_name or str(match.get('name') or 'data_specialist')
    match['summary'] = str(event.get('result_summary') or match.get('summary') or '')
    duration_ms = event.get('duration_ms')
    match['detail'] = {
        'executionMs': duration_ms if isinstance(duration_ms, (int, float)) else 0,
        'sqlUsed': None,
        'rowCount': None,
        'cacheHit': None,
        'error': None if event.get('status') not in {'error'} else match['summary'],
    }
    match['outcome'] = {
        'kind': str(event.get('status') or 'ok'),
        'capability': str(event.get('specialist') or ''),
    }
    routing = event.get('routing')
    if isinstance(routing, dict):
        match['routing'] = routing


def _tool_call_detail_has_data(detail: Any) -> bool:
    if not isinstance(detail, dict):
        return False
    return bool(
        detail.get('error')
        or detail.get('sqlUsed')
        or isinstance(detail.get('rowCount'), (int, float))
        or isinstance(detail.get('cacheHit'), bool)
        or (
            isinstance(detail.get('executionMs'), (int, float))
            and detail.get('executionMs') > 0
        )
    )


_ARTIFACT_KIND_TO_PACK: dict[str, tuple[str, str]] = {
    # Canvas patches from the orchestration_authoring pack.
    'orchestration.canvas_patch.v1': ('orchestration.authoring', 'orchestration.canvas_patch.v1'),
}
_DEFAULT_ARTIFACT_PACK: tuple[str, str] = ('analytics', 'analytics.chart.v1')


def _artifact_to_metadata(event: dict[str, Any]) -> dict[str, Any]:
    """Stamp pack_id + contract_id by event.kind; analytics is the default."""
    kind = event.get('kind')
    pack_id, contract_id = _ARTIFACT_KIND_TO_PACK.get(
        kind if isinstance(kind, str) else '',
        _DEFAULT_ARTIFACT_PACK,
    )
    return {
        'pack_id': pack_id,
        'contract_id': contract_id,
        'payload': event.get('payload') or {},
        'extras': {'kind': kind},
    }


def _to_frontend_terminal_status(status: Any) -> str:
    if status == 'failed':
        return 'error'
    if status == 'partial':
        return 'degraded'
    if status in {'done', 'degraded', 'error', 'interrupted'}:
        return str(status)
    return 'done'


def _usage_to_camel(usage: dict[str, Any]) -> dict[str, Any]:
    input_tokens = int(usage.get('input_tokens') or usage.get('inputTokens') or 0)
    output_tokens = int(usage.get('output_tokens') or usage.get('outputTokens') or 0)
    cached_read_tokens = int(usage.get('cached_read_tokens') or usage.get('cachedReadTokens') or 0)
    cached_write_tokens = int(usage.get('cached_write_tokens') or usage.get('cachedWriteTokens') or 0)
    reasoning_tokens = int(usage.get('reasoning_tokens') or usage.get('reasoningTokens') or 0)
    tool_use_prompt_tokens = int(usage.get('tool_use_prompt_tokens') or usage.get('toolUsePromptTokens') or 0)
    return {
        'inputTokens': input_tokens,
        'outputTokens': output_tokens,
        'cachedReadTokens': cached_read_tokens,
        'cachedWriteTokens': cached_write_tokens,
        'reasoningTokens': reasoning_tokens,
        'toolUsePromptTokens': tool_use_prompt_tokens,
        'totalTokens': input_tokens + output_tokens + cached_read_tokens + cached_write_tokens + reasoning_tokens + tool_use_prompt_tokens,
        'costUsd': float(usage.get('cost_usd') or usage.get('costUsd') or 0.0),
        'callCount': int(usage.get('call_count') or usage.get('callCount') or 0),
    }


async def _price_usage(
    usage: dict[str, Any],
    *,
    runtime_session: SherlockAgentSessionState,
) -> dict[str, Any]:
    from app.services.cost_tracking.pricing import compute_cost
    from app.services.cost_tracking.pricing_cache import pricing_cache

    priced = dict(usage)
    if not priced:
        return priced
    async with async_session() as db:
        pricing = await pricing_cache.get(
            db,
            runtime_session.provider,
            runtime_session.model,
            datetime.now(UTC),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
        )
    cost_usd, _breakdown, _fallback = compute_cost(
        pricing,
        input_tokens=int(priced.get('input_tokens') or 0),
        output_tokens=int(priced.get('output_tokens') or 0),
        cached_read_tokens=int(priced.get('cached_read_tokens') or 0),
        cached_write_tokens=int(priced.get('cached_write_tokens') or 0),
        reasoning_tokens=int(priced.get('reasoning_tokens') or 0),
        tool_use_prompt_tokens=int(priced.get('tool_use_prompt_tokens') or 0),
    )
    priced['cost_usd'] = float(cost_usd)
    return priced


async def _record_turn_llm_usage(
    *,
    usage: dict[str, Any],
    runtime_session: SherlockAgentSessionState,
    turn: SherlockConversationTurnState,
    terminal_status: str,
) -> None:
    """Persist one ``analytics.fact_llm_generation`` row per Sherlock turn.

    Without this, Sherlock turns never show up in the cost-tracking plane —
    they're invisible to the per-tenant rollup, the Unmapped tab, the
    Pricing tab, and the cost-admin reprice flow. Recording here mirrors
    every other LLM-using subsystem (evaluator runners, report generation).

    Best-effort: ``record_llm_usage`` swallows its own errors and never
    raises. If pricing is missing for the model the row lands with
    ``cost_usd=0`` and ``pricing_fallback=true``, which is exactly what
    the Unmapped tab is designed to surface so an operator can declare
    the canonical alias.
    """
    if not usage:
        return
    from app.services.cost_tracking.recorder import record_llm_usage

    metadata: dict[str, Any] = {
        'input_tokens': int(usage.get('input_tokens') or 0),
        'output_tokens': int(usage.get('output_tokens') or 0),
        'cached_read_tokens': int(usage.get('cached_read_tokens') or 0),
        'reasoning_tokens': int(usage.get('reasoning_tokens') or 0),
        'tool_use_prompt_tokens': int(usage.get('tool_use_prompt_tokens') or 0),
        'duration_ms': int(usage.get('duration_ms') or 0) or None,
        'status': 'ok' if terminal_status == 'done' else terminal_status,
    }

    await record_llm_usage(
        tenant_id=uuid.UUID(runtime_session.tenant_id),
        user_id=uuid.UUID(runtime_session.user_id),
        app_id=runtime_session.app_id,
        owner_type='sherlock_turn',
        owner_id=uuid.UUID(turn.id),
        subsystem='sherlock_v3',
        provider=runtime_session.provider,
        model=runtime_session.model,
        api_surface='responses',
        call_purpose='chat_turn',
        metadata=metadata,  # type: ignore[arg-type]
    )


async def _persist_last_response_id(
    *, db: Any, chat_session_id: str, last_response_id: str,
) -> None:
    """Update ``platform.sherlock_agent_sessions.last_response_id`` so the
    next turn picks up the chain head."""
    from sqlalchemy import update

    from app.models.sherlock_runtime import SherlockAgentSession

    await db.execute(
        update(SherlockAgentSession)
        .where(SherlockAgentSession.chat_session_id == uuid.UUID(chat_session_id))
        .values(last_response_id=last_response_id),
    )
