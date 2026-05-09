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
    session: dict[str, Any],
    user_message: str,
    *,
    turn: SherlockConversationTurnState,
    on_event: Callable[[dict[str, Any]], Awaitable[None]],
) -> None:
    """Drive one Sherlock v3 turn through the SSE wire + DB persistence.

    Drop-in replacement for the v2 ``run_chat_turn_streaming_background``
    helper. Emits v3-native events; no translation layer.
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

    seq = turn.last_event_seq
    accumulated_text: list[str] = []
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
            seq += 1
            wire = _to_wire_event(v3_event, seq=seq)
            if wire is not None:
                await on_event(wire)
    except Exception as exc:  # noqa: BLE001
        logger.exception('sherlock_v3 turn orchestrator failed')
        failure = exc
        seq += 1
        await on_event({
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
        terminal_status = 'failed'
        usage = {}
        last_response_id = None

    await on_event({
        'event': 'turn_finished',
        'data': {
            'seq': seq,
            'turn_id': turn.id,
            'status': terminal_status,
            'final_message_id': assistant_message_id,
            'usage': usage,
        },
    })

    final_message_status = 'complete' if failure is None else 'error'
    final_error = (
        None if failure is None else f'{type(failure).__name__}: {failure}'
    )

    async with async_session() as db:
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=assistant_message_id,
            content=''.join(accumulated_text),
            metadata=None,
            status=final_message_status,
            error_message=final_error,
            db=db,
        )
        await mark_turn_terminal(
            turn_id=turn.id,
            status=terminal_status,
            last_event_seq=seq,
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
