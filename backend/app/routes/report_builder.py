"""API routes for the report builder chat."""
from __future__ import annotations

import json as json_mod

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from app.auth import AuthContext, get_auth_context
from app.database import get_db
from app.services.report_builder.chat_handler import run_chat_turn, run_chat_turn_streaming
from app.services.report_builder.schemas import (
    BuilderChatRequest,
    BuilderChatResponse,
    BuilderSessionResponse,
    ChartOut,
    ChartSpecOut,
    ComposedReportOut,
    ToolCallOut,
)
from app.services.report_builder.runtime_store import (
    SherlockRuntimeSession,
    get_sherlock_runtime_session,
    resolve_sherlock_runtime_session,
)

router = APIRouter(prefix="/api/report-builder", tags=["report-builder"])


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


@router.post("/chat", response_model=BuilderChatResponse)
async def chat(
    body: BuilderChatRequest,
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
    )
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
    if result.get("composed_report"):
        cr = result["composed_report"]
        composed = ComposedReportOut(
            report_name=cr["report_name"],
            sections=cr["sections"],
        )

    chart_out = None
    if result.get("chart"):
        c = result["chart"]
        chart_out = ChartOut(
            spec=ChartSpecOut(**c["spec"]),
            data=c["data"],
            sql_query=c["sql_query"],
            source_question=c["source_question"],
        )

    return BuilderChatResponse(
        session_id=runtime_session.chat_session_id,
        provider=runtime_session.provider,
        model=runtime_session.model,
        content=result.get("content", ""),
        tool_calls=[
            ToolCallOut(name=tc["name"], summary=tc["summary"], detail=tc.get("detail"))
            for tc in result.get("tool_calls", [])
        ],
        composed_report=composed,
        chart=chart_out,
    )


@router.post("/chat/stream")
async def chat_stream(
    body: BuilderChatRequest,
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
    )
    session = _to_chat_handler_session(runtime_session)

    async def event_generator():
        # First event: session ID
        yield (
            'event: session\n'
            f"data: {json_mod.dumps(jsonable_encoder({'sessionId': runtime_session.chat_session_id, 'provider': runtime_session.provider, 'model': runtime_session.model}))}\n\n"
        )
        async for event in run_chat_turn_streaming(
            session, body.message,
            provider=runtime_session.provider,
            model=runtime_session.model,
            db=db,
            auth=auth,
        ):
            yield f"event: {event['event']}\ndata: {json_mod.dumps(jsonable_encoder(event['data']))}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
