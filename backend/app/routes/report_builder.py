"""API routes for the report builder chat."""
from __future__ import annotations

import json as json_mod

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.auth import AuthContext, get_auth_context
from app.database import get_db
from app.services.report_builder.chat_handler import run_chat_turn, run_chat_turn_streaming
from app.services.report_builder.schemas import (
    BuilderChatRequest,
    BuilderChatResponse,
    BuilderMessageOut,
    BuilderRuntimeEventOut,
    BuilderRuntimeEventsResponse,
    BuilderSessionResponse,
    BuilderSessionSnapshotResponse,
    ChartOut,
    ChartSpecOut,
    ComposedReportOut,
    LegacyBuilderChatRequest,
    ToolCallOut,
)
from app.services.report_builder.runtime_store import (
    SherlockRuntimeSession,
    SherlockSessionNotFoundError,
    get_sherlock_runtime_session,
    get_sherlock_runtime_session_snapshot,
    list_sherlock_runtime_events,
    resolve_sherlock_runtime_session,
)
from app.services.report_builder.turn_store import get_or_create_turn

router = APIRouter(prefix='/api/report-builder', tags=['report-builder'])
v2_router = APIRouter(prefix='/api/report-builder/v2', tags=['report-builder'])


def _to_chat_handler_session(runtime_session: SherlockRuntimeSession) -> dict:
    return {
        'chat_session_id': runtime_session.chat_session_id,
        'app_id': runtime_session.app_id,
        'tenant_id': runtime_session.tenant_id,
        'user_id': runtime_session.user_id,
        'provider': runtime_session.provider,
        'model': runtime_session.model,
        'messages': list(runtime_session.message_state),
        'scratchpad': dict(runtime_session.scratchpad),
    }


def _session_not_found_response() -> JSONResponse:
    return JSONResponse(status_code=404, content={'error': 'session_not_found'})


def _serialize_tool_call(tool_call: dict) -> ToolCallOut:
    return ToolCallOut(
        tool_call_id=tool_call.get('tool_call_id'),
        name=tool_call['name'],
        summary=tool_call['summary'],
        detail=tool_call.get('detail'),
    )


@router.get('/sessions/{session_id}', response_model=BuilderSessionResponse)
async def get_builder_session(
    session_id: str,
    app_id: str,
    auth: AuthContext = Depends(get_auth_context),
):
    runtime_session = await get_sherlock_runtime_session(
        session_id=session_id,
        app_id=app_id,
        auth=auth,
    )
    if runtime_session is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail='Session not found')

    return BuilderSessionResponse(
        session_id=runtime_session.chat_session_id,
        provider=runtime_session.provider,
        model=runtime_session.model,
    )


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
        payload = await list_sherlock_runtime_events(
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


@router.post('/chat', response_model=BuilderChatResponse)
async def chat(
    body: LegacyBuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    runtime_session = await resolve_sherlock_runtime_session(
        session_id=body.session_id,
        app_id=body.app_id,
        auth=auth,
        provider=body.provider,
        model=body.model,
        initial_user_message=body.message,
        db=db,
    )
    await db.commit()
    session = _to_chat_handler_session(runtime_session)

    result = await run_chat_turn(
        session,
        body.message,
        provider=runtime_session.provider,
        model=runtime_session.model,
        db=db,
        auth=auth,
    )

    composed = None
    if result.get('composed_report'):
        composed = ComposedReportOut(
            report_name=result['composed_report']['report_name'],
            sections=result['composed_report']['sections'],
        )

    chart_out = None
    if result.get('chart'):
        chart_out = ChartOut(
            spec=ChartSpecOut(**result['chart']['spec']),
            data=result['chart']['data'],
            sql_query=result['chart']['sql_query'],
            source_question=result['chart']['source_question'],
        )

    return BuilderChatResponse(
        session_id=runtime_session.chat_session_id,
        provider=runtime_session.provider,
        model=runtime_session.model,
        content=result.get('content', ''),
        terminal_status=result.get('terminal_status'),
        tool_calls=[_serialize_tool_call(tool_call) for tool_call in result.get('tool_calls', [])],
        composed_report=composed,
        chart=chart_out,
        warnings=result.get('warnings', []),
    )


@router.post('/chat/stream')
async def chat_stream(
    body: LegacyBuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    """SSE streaming version of the chat endpoint."""
    runtime_session = await resolve_sherlock_runtime_session(
        session_id=body.session_id,
        app_id=body.app_id,
        auth=auth,
        provider=body.provider,
        model=body.model,
        initial_user_message=body.message,
        db=db,
    )
    await db.commit()
    session = _to_chat_handler_session(runtime_session)

    async def event_generator():
        yield (
            'event: session\n'
            f"data: {json_mod.dumps(jsonable_encoder({'sessionId': runtime_session.chat_session_id, 'provider': runtime_session.provider, 'model': runtime_session.model}))}\n\n"
        )
        async for event in run_chat_turn_streaming(
            session,
            body.message,
            provider=runtime_session.provider,
            model=runtime_session.model,
            db=db,
            auth=auth,
        ):
            yield f"event: {event['event']}\ndata: {json_mod.dumps(jsonable_encoder(event['data']))}\n\n"

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@v2_router.post('/chat/stream')
async def chat_stream_v2(
    body: BuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    """Dedicated v2 SSE runtime path with strict session semantics and replay support."""
    try:
        runtime_session = await resolve_sherlock_runtime_session(
            session_id=body.session_id,
            app_id=body.app_id,
            auth=auth,
            provider=body.provider,
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
    session = _to_chat_handler_session(runtime_session)

    async def _resume_turn_event_generator(after_seq: int):
        last_event_seq = max(runtime_session.next_event_seq - 1, 0)
        session_payload = {
            'sessionId': runtime_session.chat_session_id,
            'provider': runtime_session.provider,
            'model': runtime_session.model,
            'lastEventSeq': last_event_seq,
        }
        yield f"event: session\ndata: {json_mod.dumps(jsonable_encoder(session_payload))}\n\n"

        replay = await list_sherlock_runtime_events(
            session_id=runtime_session.chat_session_id,
            app_id=body.app_id,
            auth=auth,
            after_seq=after_seq,
            db=db,
        )
        for event in replay['events']:
            payload = {'seq': event['seq'], **event['payload']}
            yield f"event: {event['event_type']}\ndata: {json_mod.dumps(jsonable_encoder(payload))}\n\n"

    async def _start_turn_event_generator():
        if turn.status != 'queued':
            async for chunk in _resume_turn_event_generator(0):
                yield chunk
            return

        async for chunk in _resume_turn_event_generator(0):
            if chunk.startswith('event: session'):
                yield chunk
                break

        async for event in run_chat_turn_streaming(
            session,
            body.message or '',
            provider=runtime_session.provider,
            model=runtime_session.model,
            db=db,
            auth=auth,
            turn=turn,
        ):
            yield f"event: {event['event']}\ndata: {json_mod.dumps(jsonable_encoder(event['data']))}\n\n"

    if body.operation == 'resume':
        return StreamingResponse(
            _resume_turn_event_generator(body.resume_from_seq or 0),
            media_type='text/event-stream',
        )

    return StreamingResponse(_start_turn_event_generator(), media_type='text/event-stream')
