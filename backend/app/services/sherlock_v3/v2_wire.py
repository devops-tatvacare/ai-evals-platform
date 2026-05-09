"""Adapter — run a Sherlock v3 turn, emit v2-shaped SSE events.

Why this exists: the chat widget (``src/features/chat-widget/api.ts``) parses
a v2 vocabulary — ``session``/``tool_call_start``/``tool_call_end``/
``content_delta``/``chart``/``status``/``done``/``error``. v3 emits a
narrower vocabulary (``content_delta`` with phase, ``specialist_started``/
``specialist_finished``, ``artifact_emitted``, ``turn_finished``,
``error_emitted``). This module translates one to the other so the
backend can swap the brain without forcing a frontend rewrite in the same
commit.

Long-term we converge the wire format on v3's vocabulary and delete this
adapter. Until then, the widget stays untouched and v3 talks v2.

Persistence side-effects (assistant message + turn marking + last_response_id)
are owned by ``run_v3_chat_turn_for_v2``: the route handler is left thin
and signature-compatible with v2's ``run_chat_turn_streaming_background``.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from app.database import async_session
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


# ─────────────────────────── translation ───────────────────────────


def _translate_event(
    v3_event: dict[str, Any],
    *,
    seq_counter: list[int],
) -> list[dict[str, Any]]:
    """Map one v3 event onto zero-or-more v2 wire events.

    ``seq_counter`` is a single-element list used as a mutable counter; each
    emitted event gets a monotonic ``seq``. Caller seeds it with the next
    available sequence number for the turn.
    """
    kind = v3_event.get('type', '')

    if kind == 'content_delta':
        phase = v3_event.get('phase', 'final_answer')
        text = v3_event.get('text', '')
        if not text:
            return []
        if phase == 'commentary':
            seq_counter[0] += 1
            return [{
                'event': 'status',
                'data': {'seq': seq_counter[0], 'text': text},
            }]
        # Default: final_answer goes to the message body.
        seq_counter[0] += 1
        return [{
            'event': 'content_delta',
            'data': {'seq': seq_counter[0], 'delta': text},
        }]

    if kind == 'specialist_started':
        seq_counter[0] += 1
        return [{
            'event': 'tool_call_start',
            'data': {
                'seq': seq_counter[0],
                'toolCallId': v3_event.get('call_id') or f'tc_{uuid.uuid4().hex[:12]}',
                'toolName': v3_event.get('specialist', 'specialist'),
            },
        }]

    if kind == 'specialist_finished':
        seq_counter[0] += 1
        return [{
            'event': 'tool_call_end',
            'data': {
                'seq': seq_counter[0],
                'toolCallId': v3_event.get('call_id') or '',
                'toolName': v3_event.get('specialist', 'specialist'),
                'summary': v3_event.get('result_summary', ''),
                'durationMs': v3_event.get('duration_ms', 0),
                'outcome': {
                    'kind': v3_event.get('status', 'ok'),
                    'capability': v3_event.get('specialist', ''),
                },
            },
        }]

    if kind == 'artifact_emitted':
        seq_counter[0] += 1
        return [{
            'event': 'chart',
            'data': {'seq': seq_counter[0], **(v3_event.get('payload') or {})},
        }]

    if kind == 'error_emitted':
        seq_counter[0] += 1
        return [{
            'event': 'error',
            'data': {
                'seq': seq_counter[0],
                'message': v3_event.get('message', 'Unknown error'),
                'terminalStatus': 'error',
            },
        }]

    if kind in ('turn_finished', 'agent_updated'):
        # turn_finished is handled separately by the caller (it carries
        # usage + last_response_id metadata that needs separate persistence).
        # agent_updated is a v3-internal signal with no v2 equivalent.
        return []

    logger.debug('sherlock_v3.v2_wire: dropping unmapped v3 event kind=%s', kind)
    return []


# ─────────────────────────── runner ───────────────────────────


async def run_v3_turn_for_v2_wire(
    *,
    user_message: str,
    v3_ctx: SherlockTurnContext,
    starting_seq: int,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
    on_complete: Callable[[dict[str, Any]], Awaitable[None]],
    on_error: Callable[[Exception], Awaitable[None]],
) -> None:
    """Drive one Sherlock v3 turn, translating events to v2 shape.

    * ``on_event`` is called once per emitted v2 event. The route handler
      bridges this to ``_publish_turn_event`` (which writes
      ``platform.sherlock_turn_events`` and pushes to subscribers).
    * ``on_complete`` is called once with the v3 ``turn_finished`` event
      (carries ``last_response_id`` + ``usage``) so the caller can finalize
      the assistant message and mark the turn terminal.
    * ``on_error`` is called once on unhandled exceptions so the caller
      can mark the turn failed.
    """
    seq_counter = [starting_seq]
    accumulated_text_parts: list[str] = []
    artifacts_for_done: list[dict[str, Any]] = []
    final_event: dict[str, Any] | None = None

    try:
        async for v3_event in run_turn(user_message, v3_ctx):
            kind = v3_event.get('type', '')
            if kind == 'content_delta' and v3_event.get('phase') == 'final_answer':
                accumulated_text_parts.append(v3_event.get('text', ''))
            elif kind == 'artifact_emitted':
                artifacts_for_done.append(v3_event.get('payload') or {})
            elif kind == 'turn_finished':
                final_event = v3_event

            for v2_event in _translate_event(v3_event, seq_counter=seq_counter):
                await on_event(v2_event)
    except Exception as exc:  # noqa: BLE001
        logger.exception('sherlock_v3 v2_wire turn failed')
        await on_error(exc)
        return

    # Emit the v2 ``done`` event from the v3 turn_finished metadata.
    if final_event is None:
        # Shouldn't happen — runtime always yields turn_finished — but be
        # defensive so we don't leave the wire dangling.
        await on_error(RuntimeError('v3 runtime ended without turn_finished'))
        return

    seq_counter[0] += 1
    usage = final_event.get('usage') or {}
    done_data: dict[str, Any] = {
        'seq': seq_counter[0],
        'terminalStatus': _v3_status_to_v2(final_event.get('status', 'done')),
        'content': ''.join(accumulated_text_parts),
        'warnings': [],
        'toolCalls': [],
        'artifacts': None,  # widget reconstructs from inline ``chart`` events
    }
    if usage:
        done_data['usage'] = {
            'input_tokens': usage.get('input_tokens', 0),
            'output_tokens': usage.get('output_tokens', 0),
            'cached_read_tokens': usage.get('cached_read_tokens', 0),
            'cost_usd': usage.get('cost_usd', 0.0),
            'call_count': usage.get('call_count', 0),
        }
    await on_event({'event': 'done', 'data': done_data})
    await on_complete({
        'content': ''.join(accumulated_text_parts),
        'last_response_id': final_event.get('last_response_id'),
        'usage': usage,
        'status': _v3_status_to_v2(final_event.get('status', 'done')),
        'artifacts': artifacts_for_done,
    })


def _v3_status_to_v2(v3_status: str) -> str:
    """Map v3 turn status enum to v2 terminal status."""
    return {
        'done': 'done',
        'partial': 'degraded',
        'failed': 'error',
        'interrupted': 'interrupted',
        'clarifying': 'done',
    }.get(v3_status, 'done')


# ─────────────────────── route-level orchestrator ───────────────────────


async def run_v3_chat_turn_for_v2(
    session: dict[str, Any],
    user_message: str,
    *,
    auth: Any,  # noqa: ARG001 — kept for v2 signature compatibility
    turn: SherlockConversationTurnState,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    """Drop-in replacement for ``run_chat_turn_streaming_background``.

    Owns all persistence the v2 path used to do inside ``_execute_chat_turn``:
      1. Open a fresh AsyncSession.
      2. Create the assistant message row + flip the turn from queued→running.
      3. Run the v3 turn through the SSE wire.
      4. Finalize the assistant message (content + status).
      5. Mark the turn terminal.
      6. Save ``last_response_id`` onto the agent session for the next turn.

    Signature mirrors the v2 helper so the route handler swap is one-line.
    ``auth`` is unused (v3 resolves credentials via tenant_id+user_id off
    the session dict) but kept so callers don't have to refactor.
    """
    runtime_session = SherlockAgentSessionState(
        chat_session_id=str(session['chat_session_id']),
        tenant_id=str(session['tenant_id']),
        user_id=str(session['user_id']),
        app_id=session['app_id'],
        provider=session.get('provider', 'azure_openai'),
        model=session.get('model', ''),
        message_state=session.get('message_state', []),
        scratchpad=session.get('scratchpad', {}),
        next_event_seq=session.get('next_event_seq', 1),
        status=session.get('status', 'active'),
        last_error=session.get('last_error'),
        last_response_id=session.get('last_response_id'),
    )

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
        previous_response_id=runtime_session.last_response_id,
    )

    completion: dict[str, Any] = {}
    failure: Exception | None = None

    async def _on_complete(payload: dict[str, Any]) -> None:
        completion.update(payload)

    async def _on_error(exc: Exception) -> None:
        nonlocal failure
        failure = exc
        # Surface as a v2-shaped error event so the widget renders it.
        await on_event({
            'event': 'error',
            'data': {
                'seq': turn.last_event_seq + 1,
                'message': f'{type(exc).__name__}: {exc}',
                'terminalStatus': 'error',
            },
        })

    await run_v3_turn_for_v2_wire(
        user_message=user_message,
        v3_ctx=v3_ctx,
        starting_seq=turn.last_event_seq,
        on_event=on_event,
        on_complete=_on_complete,
        on_error=_on_error,
    )

    async with async_session() as db:
        if failure is None:
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=assistant_message_id,
                content=completion.get('content', ''),
                metadata=None,
                status='complete',
                db=db,
            )
            terminal_status = completion.get('status') or 'done'
        else:
            await finalize_assistant_message(
                runtime_session=runtime_session,
                message_id=assistant_message_id,
                content='',
                metadata=None,
                status='error',
                error_message=f'{type(failure).__name__}: {failure}',
                db=db,
            )
            terminal_status = 'error'

        await mark_turn_terminal(
            turn_id=turn.id,
            status=terminal_status,
            last_event_seq=completion.get('last_event_seq', turn.last_event_seq),
            last_error=(
                None if failure is None
                else f'{type(failure).__name__}: {failure}'
            ),
            db=db,
        )

        new_response_id = completion.get('last_response_id')
        if new_response_id:
            await _persist_last_response_id(
                db=db,
                chat_session_id=runtime_session.chat_session_id,
                last_response_id=new_response_id,
            )

        await db.commit()


async def _persist_last_response_id(
    *, db: Any, chat_session_id: str, last_response_id: str,
) -> None:
    """Update ``platform.sherlock_agent_sessions.last_response_id``."""
    from sqlalchemy import update

    from app.models.sherlock_runtime import SherlockAgentSession

    await db.execute(
        update(SherlockAgentSession)
        .where(SherlockAgentSession.chat_session_id == uuid.UUID(chat_session_id))
        .values(last_response_id=last_response_id),
    )


