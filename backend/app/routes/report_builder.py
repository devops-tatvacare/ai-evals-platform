"""API routes for the report builder chat."""
from __future__ import annotations

import asyncio
import contextlib
import json as json_mod
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import AuthContext, get_auth_context
from app.auth.app_scope import ensure_registered_app_access
from app.database import async_session, get_db
from app.services.orchestration_authoring.builder_snapshot import BuilderSnapshot
from app.services.orchestration_authoring.tenant_guard import assert_workflow_owned
from app.services.sherlock_v3.turn_orchestrator import run_chat_turn as run_sherlock_v3_chat_turn
from app.services.report_builder.schemas import (
    BuilderChatRequest,
    BuilderMessageOut,
    BuilderRuntimePartOut,
    BuilderRuntimePartsResponse,
    BuilderSessionSnapshotResponse,
    BuilderTurnCancelResponse,
    OrchestrationBuilderPageContext,
)
from app.services.report_builder.runtime_store import (
    SherlockAgentSessionState,
    SherlockSessionNotFoundError,
    finalize_assistant_message,
    get_sherlock_runtime_session,
    get_sherlock_runtime_session_snapshot,
    list_sherlock_parts,
    record_user_message,
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
    seq = await _emit_interrupt_parts(
        runtime_session=runtime_session,
        turn=turn,
        reason=reason,
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


async def _emit_interrupt_parts(
    *,
    runtime_session: SherlockAgentSessionState,
    turn,
    reason: str,
) -> int:
    """Emit ErrorPart + StepFinishPart for an interrupted turn via a temp PartEmitter."""
    from app.services.sherlock_v3.contracts import (
        ErrorPart, StepFinishPart, new_part_id,
    )
    from app.services.sherlock_v3.emitter import PartEmitter

    last_seq = turn.last_event_seq

    async def _noop(_turn_id: str, _payload: dict[str, Any]) -> None:
        nonlocal last_seq
        last_seq = int(_payload.get('seq') or last_seq)

    async with async_session() as event_db:
        emitter = PartEmitter(
            db=event_db,
            chat_session_id=uuid.UUID(runtime_session.chat_session_id),
            tenant_id=uuid.UUID(runtime_session.tenant_id),
            user_id=uuid.UUID(runtime_session.user_id),
            app_id=runtime_session.app_id,
            turn_id=turn.id,
            publish=_noop,
        )
        await emitter.emit(ErrorPart(
            id=new_part_id(),
            chat_session_id='',
            seq=0,
            created_at=0,
            source='orchestrator',
            message=reason,
        ))
        await emitter.emit(StepFinishPart(
            id=new_part_id(),
            chat_session_id='',
            seq=0,
            created_at=0,
            turn_id=str(turn.id),
            status='interrupted',
        ))
        await event_db.commit()
    return last_seq


def _build_terminal_stream_event(
    *,
    snapshot: dict[str, Any],
    turn,
) -> dict[str, Any]:
    """Synthetic terminal marker — FE refetches /parts to hydrate full history."""
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
    metadata = assistant_message.get('metadata') if assistant_message else None
    metadata = metadata if isinstance(metadata, dict) else {}
    terminal_status = str(metadata.get('terminalStatus') or turn.status)

    return {
        'event': 'turn_terminal',
        'data': {
            'seq': turn.last_event_seq,
            'turn_id': turn.id,
            'status': terminal_status,
            'final_message_id': turn.assistant_message_id,
            'last_error': turn.last_error or metadata.get('lastError'),
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
                yield _format_sse('turn_terminal', {
                    'status': 'error',
                    'source': 'orchestrator',
                    'message': 'session_not_found',
                })
                return

            polled_turn = await get_turn(
                runtime_session=fresh_runtime_session,
                turn_id=turn_id,
                db=session_db,
            )
            if polled_turn is None:
                yield _format_sse('turn_terminal', {
                    'status': 'error',
                    'source': 'orchestrator',
                    'message': 'turn_not_found',
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

    yield _format_sse('turn_terminal', {
        'status': 'error',
        'source': 'orchestrator',
        'message': 'Timed out waiting for Sherlock to finish the turn',
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


@v2_router.get('/sessions/{session_id}/parts', response_model=BuilderRuntimePartsResponse)
async def get_builder_runtime_parts_v2(
    session_id: str,
    app_id: str,
    after_seq: int = 0,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    try:
        payload = await list_sherlock_parts(
            session_id=session_id,
            app_id=app_id,
            auth=auth,
            after_seq=after_seq,
            db=db,
        )
    except SherlockSessionNotFoundError:
        return _session_not_found_response()

    return BuilderRuntimePartsResponse(
        session_id=payload['session_id'],
        last_event_seq=payload['last_event_seq'],
        parts=[BuilderRuntimePartOut(**part) for part in payload['parts']],
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


async def _resolve_builder_snapshot(
    *,
    body: BuilderChatRequest,
    auth: AuthContext,
    db,
) -> BuilderSnapshot | None:
    """Validate `pageContext` and return a `BuilderSnapshot` or None.

    Three-layer enforcement (Decision §R1):
      1. App-access on body.app_id AND pageContext.app_id; mismatch → 400.
      2. Workflow tenant ownership via `assert_workflow_owned` (404 not 403).
      3. Edit-mode + permission gate. Failing those drops the context
         (warn-log) so the chat continues read-only.

    Log-redaction contract: `body.page_context.definition` is the entire
    canvas snapshot and can be tens of KB. The current request middleware
    (`app.middleware.correlation`, `app.middleware.gzip_safe`) does NOT
    log request bodies, so today's logging surface is clean. If a future
    middleware starts logging request bodies, it MUST redact
    `pageContext.definition` per Decision §R Risks.
    """
    page = body.page_context
    if page is None or not isinstance(page, OrchestrationBuilderPageContext):
        return None

    await ensure_registered_app_access(db, auth, body.app_id)
    await ensure_registered_app_access(db, auth, page.app_id)
    if body.app_id != page.app_id:
        from fastapi import HTTPException
        raise HTTPException(400, 'app_id mismatch between body and pageContext')

    workflow = await assert_workflow_owned(
        db, workflow_id=page.workflow_id, auth=auth,
    )
    if workflow.app_id != page.app_id:
        from fastapi import HTTPException
        raise HTTPException(400, 'pageContext app_id does not match workflow')

    if page.view_mode != 'edit':
        logger.info(
            'sherlock_v3 builder context dropped: tenant=%s user=%s app=%s '
            'workflow=%s — builder is in view mode',
            auth.tenant_id, auth.user_id, page.app_id, page.workflow_id,
        )
        return None

    # Owner role bypasses permission lists; use the canonical helper instead
    # of a raw `in` check (Phase 2 hotfix — Owners were silently dropped
    # because they hold no literal permissions).
    from app.auth.permissions import missing_permissions
    if missing_permissions(auth, 'orchestration:manage'):
        logger.warning(
            'sherlock_v3 builder context dropped: tenant=%s user=%s app=%s '
            'workflow=%s — missing orchestration:manage',
            auth.tenant_id, auth.user_id, page.app_id, page.workflow_id,
        )
        return None

    if page.version_id is None:
        snapshot_version_id = workflow.current_published_version_id
    else:
        try:
            snapshot_version_id = uuid.UUID(page.version_id)
        except ValueError:
            from fastapi import HTTPException
            raise HTTPException(400, 'pageContext.version_id must be a UUID')

    return BuilderSnapshot(
        workflow_id=workflow.id,
        version_id=snapshot_version_id,
        workflow_type=page.workflow_type,
        app_id=page.app_id,
        definition=page.definition,
        data_hash=page.data_hash,
        selected_node_id=page.selected_node_id,
        view_mode=page.view_mode,
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
            initial_user_message=body.message or '',
            db=db,
            strict_session_id=body.session_id is not None,
        )
    except SherlockSessionNotFoundError:
        return _session_not_found_response()

    builder_snapshot = await _resolve_builder_snapshot(
        body=body, auth=auth, db=db,
    )

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

        # Persist the user message BEFORE the turn task starts so session
        # restore replays "user → assistant" pairs instead of orphan
        # assistant rows. The runtime contract (sherlock_v3/runtime.py
        # docstring) explicitly requires this; the v3 cutover dropped the
        # call site. Only fires on the fresh-queued-turn path — resumes
        # skip this branch and never re-record.
        if body.message:
            await record_user_message(
                runtime_session=runtime_session,
                content=body.message,
                db=db,
            )
            await db.commit()

        async def _on_event(event: dict[str, Any]) -> None:
            await _publish_turn_event(turn.id, event)

        async def _turn_task() -> None:
            try:
                await run_sherlock_v3_chat_turn(
                    runtime_session=runtime_session,
                    user_message=body.message or '',
                    turn=turn,
                    on_event=_on_event,
                    auth=auth,
                    builder_context=builder_snapshot,
                )
            finally:
                # Publish a terminal frame on the live queue so the client gets a
                # clean turn_terminal instead of an EOF-error fallback. The
                # snapshot/poll paths already emit one; the live path did not.
                try:
                    async with async_session() as terminal_db:
                        final_turn = await get_turn(
                            runtime_session=runtime_session,
                            turn_id=turn.client_turn_id,
                            db=terminal_db,
                        )
                    if final_turn is not None:
                        terminal_event = _build_terminal_stream_event(
                            snapshot={}, turn=final_turn,
                        )
                        await _publish_turn_event(turn.id, terminal_event)
                except Exception:
                    logger.exception('failed to publish turn_terminal on live path')
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
