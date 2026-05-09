"""API routes for the report builder chat."""
from __future__ import annotations

import asyncio
import contextlib
import json as json_mod
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import AuthContext, get_auth_context
from app.database import async_session, get_db
from app.services.sherlock_v3.turn_orchestrator import run_chat_turn as run_sherlock_v3_chat_turn
from app.services.report_builder.schemas import (
    BuilderChatRequest,
    BuilderMessageOut,
    BuilderRuntimeEventOut,
    BuilderRuntimeEventsResponse,
    BuilderSessionSnapshotResponse,
    BuilderTurnCancelResponse,
)
from app.services.report_builder.runtime_store import (
    SherlockAgentSessionState,
    SherlockSessionNotFoundError,
    append_runtime_event,
    finalize_assistant_message,
    get_sherlock_runtime_session,
    get_sherlock_runtime_session_snapshot,
    list_sherlock_turn_events,
    resolve_sherlock_runtime_session,
    save_runtime_state,
    touch_sherlock_chat_session,
)
from app.services.report_builder.turn_store import get_or_create_turn, get_turn, mark_turn_terminal

router = APIRouter(prefix='/api/report-builder', tags=['report-builder'])
v2_router = APIRouter(prefix='/api/report-builder/v2', tags=['report-builder'])
logger = logging.getLogger(__name__)
_SHERLOCK_BACKGROUND_TASKS: set[asyncio.Task] = set()
_SHERLOCK_BACKGROUND_TASKS_BY_TURN: dict[str, asyncio.Task] = {}
_SHERLOCK_BACKGROUND_SUBSCRIBERS: dict[str, set[asyncio.Queue[dict[str, Any] | None]]] = {}
_RESUME_POLL_TIMEOUT_SECONDS = 155.0


def _session_not_found_response() -> JSONResponse:
    return JSONResponse(status_code=404, content={'error': 'session_not_found'})


def _session_payload(runtime_session: SherlockAgentSessionState) -> dict[str, str]:
    return {
        'sessionId': runtime_session.chat_session_id,
        'provider': runtime_session.provider,
        'model': runtime_session.model,
    }


def _format_sse(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json_mod.dumps(jsonable_encoder(payload))}\n\n"


def _is_terminal_turn_status(status: str) -> bool:
    return status in {'done', 'degraded', 'error', 'interrupted'}


def _register_turn_subscriber(turn_id: str) -> asyncio.Queue[dict[str, Any] | None]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    _SHERLOCK_BACKGROUND_SUBSCRIBERS.setdefault(turn_id, set()).add(queue)
    return queue


def _unregister_turn_subscriber(turn_id: str, queue: asyncio.Queue[dict[str, Any] | None]) -> None:
    subscribers = _SHERLOCK_BACKGROUND_SUBSCRIBERS.get(turn_id)
    if not subscribers:
        return
    subscribers.discard(queue)
    if not subscribers:
        _SHERLOCK_BACKGROUND_SUBSCRIBERS.pop(turn_id, None)


async def _publish_turn_event(turn_id: str, event: dict[str, Any]) -> None:
    for queue in tuple(_SHERLOCK_BACKGROUND_SUBSCRIBERS.get(turn_id, ())):
        await queue.put(event)


async def _close_turn_stream(turn_id: str) -> None:
    for queue in tuple(_SHERLOCK_BACKGROUND_SUBSCRIBERS.pop(turn_id, ())):
        await queue.put(None)


def _track_background_task(turn_id: str, task: asyncio.Task) -> None:
    _SHERLOCK_BACKGROUND_TASKS.add(task)
    _SHERLOCK_BACKGROUND_TASKS_BY_TURN[turn_id] = task

    def _cleanup(completed: asyncio.Task) -> None:
        _SHERLOCK_BACKGROUND_TASKS.discard(completed)
        if _SHERLOCK_BACKGROUND_TASKS_BY_TURN.get(turn_id) is completed:
            _SHERLOCK_BACKGROUND_TASKS_BY_TURN.pop(turn_id, None)

    task.add_done_callback(_cleanup)


def _has_live_turn_task(turn_id: str) -> bool:
    task = _SHERLOCK_BACKGROUND_TASKS_BY_TURN.get(turn_id)
    return task is not None and not task.done()


def _find_assistant_message(
    snapshot: dict[str, Any],
    *,
    assistant_message_id: str | None,
) -> dict[str, Any] | None:
    messages = snapshot.get('messages')
    if not isinstance(messages, list):
        return None
    if assistant_message_id:
        match = next(
            (
                message
                for message in reversed(messages)
                if isinstance(message, dict) and message.get('id') == assistant_message_id
            ),
            None,
        )
        if match is not None:
            return match
    return next(
        (
            message
            for message in reversed(messages)
            if isinstance(message, dict) and message.get('role') == 'assistant'
        ),
        None,
    )


async def _force_interrupt_turn(
    *,
    runtime_session: SherlockAgentSessionState,
    turn,
    auth: AuthContext,
    db,
    reason: str,
) -> None:
    snapshot = await get_sherlock_runtime_session_snapshot(
        session_id=runtime_session.chat_session_id,
        app_id=runtime_session.app_id,
        auth=auth,
        db=db,
    )
    assistant_message = _find_assistant_message(
        snapshot,
        assistant_message_id=turn.assistant_message_id,
    )
    content = str(assistant_message.get('content') or '') if assistant_message else ''
    metadata = dict(assistant_message.get('metadata') or {}) if assistant_message else {}
    metadata['terminalStatus'] = 'interrupted'
    metadata['lastError'] = reason

    await save_runtime_state(
        runtime_session=runtime_session,
        message_state=list(runtime_session.message_state),
        scratchpad=dict(runtime_session.scratchpad),
        status='interrupted',
        last_error=reason,
        db=db,
    )
    if turn.assistant_message_id:
        await finalize_assistant_message(
            runtime_session=runtime_session,
            message_id=turn.assistant_message_id,
            content=content or reason,
            metadata=metadata,
            status='error',
            error_message=reason,
            db=db,
        )
    seq = await append_runtime_event(
        runtime_session=runtime_session,
        event_type='error',
        payload={
            'terminalStatus': 'interrupted',
            'message': reason,
            'recoverable': False,
        },
        db=db,
    )
    await touch_sherlock_chat_session(runtime_session=runtime_session, db=db)
    await mark_turn_terminal(
        turn_id=turn.id,
        status='interrupted',
        last_event_seq=seq,
        last_error=reason,
        db=db,
    )
    await db.commit()


def _build_terminal_stream_event(
    *,
    snapshot: dict[str, Any],
    turn,
) -> dict[str, Any]:
    assistant_message: dict[str, Any] | None = None
    messages = snapshot.get('messages')
    if isinstance(messages, list):
        if turn.assistant_message_id:
            assistant_message = next(
                (
                    message
                    for message in reversed(messages)
                    if isinstance(message, dict) and message.get('id') == turn.assistant_message_id
                ),
                None,
            )
        if assistant_message is None:
            assistant_message = next(
                (
                    message
                    for message in reversed(messages)
                    if isinstance(message, dict) and message.get('role') == 'assistant'
                ),
                None,
            )

    content = str(assistant_message.get('content') or '') if assistant_message else ''
    metadata = assistant_message.get('metadata') if assistant_message else None
    metadata = metadata if isinstance(metadata, dict) else {}
    terminal_status = str(metadata.get('terminalStatus') or turn.status)

    if terminal_status in {'error', 'interrupted'}:
        return {
            'event': 'error',
            'data': {
                'terminalStatus': terminal_status,
                'message': str(turn.last_error or metadata.get('lastError') or 'Sherlock turn failed'),
                'content': content or None,
                'recoverable': False,
            },
        }

    # Phase 1: resume snapshots carry the same ``artifacts[]`` contract
    # the live ``done`` event produces. Callers dispatch on ``pack_id`` +
    # ``contract_id`` to render analytics charts, report-builder
    # blueprints, and any future pack outputs uniformly.
    artifacts = metadata.get('artifacts')
    if not isinstance(artifacts, list):
        artifacts = []

    warnings = metadata.get('warnings')
    if not isinstance(warnings, list):
        warnings = []

    tool_calls = metadata.get('toolCalls')
    if not isinstance(tool_calls, list):
        tool_calls = []

    return {
        'event': 'done',
        'data': {
            'terminalStatus': terminal_status,
            'content': content,
            'toolCalls': tool_calls,
            'artifacts': artifacts,
            'warnings': warnings,
        },
    }


async def _stream_registered_turn_queue(
    *,
    turn_id: str,
    event_queue: asyncio.Queue[dict[str, Any] | None],
    session_payload: dict[str, Any],
):
    yield _format_sse('session', session_payload)
    try:
        while True:
            event = await event_queue.get()
            if event is None:
                break
            yield _format_sse(str(event['event']), event['data'])
    except (asyncio.CancelledError, GeneratorExit):
        logger.info('SSE disconnected for turn %s; turn continues in background', turn_id)
        raise
    finally:
        _unregister_turn_subscriber(turn_id, event_queue)


async def _stream_turn_snapshot(
    *,
    runtime_session: SherlockAgentSessionState,
    turn,
    auth: AuthContext,
):
    yield _format_sse('session', _session_payload(runtime_session))
    async with async_session() as session_db:
        snapshot = await get_sherlock_runtime_session_snapshot(
            session_id=runtime_session.chat_session_id,
            app_id=runtime_session.app_id,
            auth=auth,
            db=session_db,
        )
    terminal_event = _build_terminal_stream_event(snapshot=snapshot, turn=turn)
    yield _format_sse(str(terminal_event['event']), terminal_event['data'])


async def _poll_turn_until_terminal(
    *,
    runtime_session: SherlockAgentSessionState,
    turn_id: str,
    auth: AuthContext,
):
    yield _format_sse('session', _session_payload(runtime_session))
    deadline = time.monotonic() + _RESUME_POLL_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        async with async_session() as session_db:
            fresh_runtime_session = await get_sherlock_runtime_session(
                session_id=runtime_session.chat_session_id,
                app_id=runtime_session.app_id,
                auth=auth,
                db=session_db,
            )
            if fresh_runtime_session is None:
                yield _format_sse('error', {
                    'terminalStatus': 'error',
                    'message': 'session_not_found',
                    'recoverable': False,
                })
                return

            polled_turn = await get_turn(
                runtime_session=fresh_runtime_session,
                turn_id=turn_id,
                db=session_db,
            )
            if polled_turn is None:
                yield _format_sse('error', {
                    'terminalStatus': 'error',
                    'message': 'turn_not_found',
                    'recoverable': False,
                })
                return

            if _is_terminal_turn_status(polled_turn.status):
                snapshot = await get_sherlock_runtime_session_snapshot(
                    session_id=fresh_runtime_session.chat_session_id,
                    app_id=fresh_runtime_session.app_id,
                    auth=auth,
                    db=session_db,
                )
                terminal_event = _build_terminal_stream_event(snapshot=snapshot, turn=polled_turn)
                yield _format_sse(str(terminal_event['event']), terminal_event['data'])
                return

        await asyncio.sleep(0.5)

    yield _format_sse('error', {
        'terminalStatus': 'error',
        'message': 'Timed out waiting for Sherlock to finish the turn',
        'recoverable': False,
    })


@v2_router.get('/sessions/{session_id}', response_model=BuilderSessionSnapshotResponse)
async def get_builder_session_v2(
    session_id: str,
    app_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    try:
        snapshot = await get_sherlock_runtime_session_snapshot(
            session_id=session_id,
            app_id=app_id,
            auth=auth,
            db=db,
        )
    except SherlockSessionNotFoundError:
        return _session_not_found_response()

    return BuilderSessionSnapshotResponse(
        session_id=snapshot['session_id'],
        provider=snapshot['provider'],
        model=snapshot['model'],
        active_turn_id=snapshot.get('active_turn_id'),
        last_event_seq=snapshot['last_event_seq'],
        current_turn_status=snapshot['current_turn_status'],
        messages=[BuilderMessageOut(**message) for message in snapshot['messages']],
    )


@v2_router.get('/sessions/{session_id}/events', response_model=BuilderRuntimeEventsResponse)
async def get_builder_runtime_events_v2(
    session_id: str,
    app_id: str,
    after_seq: int = 0,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    try:
        payload = await list_sherlock_turn_events(
            session_id=session_id,
            app_id=app_id,
            auth=auth,
            after_seq=after_seq,
            db=db,
        )
    except SherlockSessionNotFoundError:
        return _session_not_found_response()

    return BuilderRuntimeEventsResponse(
        session_id=payload['session_id'],
        last_event_seq=payload['last_event_seq'],
        events=[BuilderRuntimeEventOut(**event) for event in payload['events']],
    )


@v2_router.post('/sessions/{session_id}/turns/{turn_id}/cancel', response_model=BuilderTurnCancelResponse)
async def cancel_builder_turn_v2(
    session_id: str,
    turn_id: str,
    app_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    reason = 'Cancelled by user'
    runtime_session = await get_sherlock_runtime_session(
        session_id=session_id,
        app_id=app_id,
        auth=auth,
        db=db,
    )
    if runtime_session is None:
        return _session_not_found_response()

    turn = await get_turn(
        runtime_session=runtime_session,
        turn_id=turn_id,
        db=db,
    )
    if turn is None:
        return JSONResponse(status_code=404, content={'error': 'turn_not_found'})

    if _is_terminal_turn_status(turn.status):
        return BuilderTurnCancelResponse(
            session_id=session_id,
            turn_id=turn_id,
            result='already_terminal',
            turn_status=turn.status,
            message='Turn already finished',
        )

    if _has_live_turn_task(turn.id):
        task = _SHERLOCK_BACKGROUND_TASKS_BY_TURN.get(turn.id)
        if task is not None and not task.done():
            task.cancel(reason)
            with contextlib.suppress(asyncio.CancelledError):
                await task
        refreshed = await get_turn(
            runtime_session=runtime_session,
            turn_id=turn_id,
            db=db,
        )
        return BuilderTurnCancelResponse(
            session_id=session_id,
            turn_id=turn_id,
            result='cancelled',
            turn_status=refreshed.status if refreshed is not None else 'interrupted',
            message=reason,
        )

    await _force_interrupt_turn(
        runtime_session=runtime_session,
        turn=turn,
        auth=auth,
        db=db,
        reason=reason,
    )
    refreshed_turn = await get_turn(
        runtime_session=runtime_session,
        turn_id=turn_id,
        db=db,
    )
    if refreshed_turn is not None:
        snapshot = await get_sherlock_runtime_session_snapshot(
            session_id=runtime_session.chat_session_id,
            app_id=runtime_session.app_id,
            auth=auth,
            db=db,
        )
        terminal_event = _build_terminal_stream_event(snapshot=snapshot, turn=refreshed_turn)
        await _publish_turn_event(refreshed_turn.id, terminal_event)
        await _close_turn_stream(refreshed_turn.id)
    return BuilderTurnCancelResponse(
        session_id=session_id,
        turn_id=turn_id,
        result='forced_interrupted',
        turn_status='interrupted',
        message='Turn had no live worker task; marked interrupted',
    )


@v2_router.post('/chat/stream')
async def chat_stream_v2(
    body: BuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    """Dedicated v2 SSE runtime path with strict session semantics and background resume."""
    try:
        runtime_session = await resolve_sherlock_runtime_session(
            session_id=body.session_id,
            app_id=body.app_id,
            auth=auth,
            provider=body.provider or 'openai',
            model=body.model,
            initial_user_message=body.message,
            db=db,
            strict_session_id=body.session_id is not None,
        )
    except SherlockSessionNotFoundError:
        return _session_not_found_response()

    turn = await get_or_create_turn(
        runtime_session=runtime_session,
        turn_id=str(body.turn_id),
        user_message=body.message,
        provider=runtime_session.provider,
        model=runtime_session.model,
        db=db,
    )
    await db.commit()

    async def _start_turn_event_generator():
        if _is_terminal_turn_status(turn.status):
            async for chunk in _stream_turn_snapshot(
                runtime_session=runtime_session,
                turn=turn,
                auth=auth,
            ):
                yield chunk
            return

        if _has_live_turn_task(turn.id):
            event_queue = _register_turn_subscriber(turn.id)
            async for chunk in _stream_registered_turn_queue(
                turn_id=turn.id,
                event_queue=event_queue,
                session_payload=_session_payload(runtime_session),
            ):
                yield chunk
            return

        if turn.status != 'queued':
            async for chunk in _poll_turn_until_terminal(
                runtime_session=runtime_session,
                turn_id=turn.client_turn_id,
                auth=auth,
            ):
                yield chunk
            return

        event_queue = _register_turn_subscriber(turn.id)

        async def _on_event(event: dict[str, Any]) -> None:
            await _publish_turn_event(turn.id, event)

        async def _turn_task() -> None:
            try:
                await run_sherlock_v3_chat_turn(
                    runtime_session=runtime_session,
                    user_message=body.message or '',
                    turn=turn,
                    on_event=_on_event,
                )
            finally:
                await _close_turn_stream(turn.id)

        task = asyncio.create_task(_turn_task())
        _track_background_task(turn.id, task)

        async for chunk in _stream_registered_turn_queue(
            turn_id=turn.id,
            event_queue=event_queue,
            session_payload=_session_payload(runtime_session),
        ):
            yield chunk

    if body.operation == 'resume':
        if _has_live_turn_task(turn.id):
            return StreamingResponse(
                _stream_registered_turn_queue(
                    turn_id=turn.id,
                    event_queue=_register_turn_subscriber(turn.id),
                    session_payload=_session_payload(runtime_session),
                ),
                media_type='text/event-stream',
            )
        if _is_terminal_turn_status(turn.status):
            return StreamingResponse(
                _stream_turn_snapshot(
                    runtime_session=runtime_session,
                    turn=turn,
                    auth=auth,
                ),
                media_type='text/event-stream',
            )
        return StreamingResponse(
            _poll_turn_until_terminal(
                runtime_session=runtime_session,
                turn_id=turn.client_turn_id,
                auth=auth,
            ),
            media_type='text/event-stream',
        )

    return StreamingResponse(_start_turn_event_generator(), media_type='text/event-stream')
