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
    ComposedReportOut,
    ToolCallOut,
)
from app.services.report_builder.session_store import create_session, get_session

router = APIRouter(prefix="/api/report-builder", tags=["report-builder"])


@router.post("/chat", response_model=BuilderChatResponse)
async def chat(
    body: BuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    if body.session_id:
        session = get_session(body.session_id)
    else:
        session = None

    if not session:
        session_id, session = create_session(
            app_id=body.app_id,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            provider=body.provider,
            model=body.model,
        )
    else:
        session_id = body.session_id  # type: ignore[assignment]

    result = await run_chat_turn(
        session,
        body.message,
        provider=body.provider,
        model=body.model,
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

    return BuilderChatResponse(
        session_id=session_id,
        content=result.get("content", ""),
        tool_calls=[
            ToolCallOut(name=tc["name"], summary=tc["summary"], detail=tc.get("detail"))
            for tc in result.get("tool_calls", [])
        ],
        composed_report=composed,
    )


@router.post("/chat/stream")
async def chat_stream(
    body: BuilderChatRequest,
    auth: AuthContext = Depends(get_auth_context),
    db=Depends(get_db),
):
    """SSE streaming version of the chat endpoint."""
    if body.session_id:
        session = get_session(body.session_id)
    else:
        session = None

    if not session:
        session_id, session = create_session(
            app_id=body.app_id,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            provider=body.provider,
            model=body.model,
        )
    else:
        session_id = body.session_id

    async def event_generator():
        # First event: session ID
        yield f"event: session\ndata: {json_mod.dumps(jsonable_encoder({'sessionId': session_id}))}\n\n"
        async for event in run_chat_turn_streaming(
            session, body.message,
            provider=body.provider, model=body.model, db=db, auth=auth,
        ):
            yield f"event: {event['event']}\ndata: {json_mod.dumps(jsonable_encoder(event['data']))}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
