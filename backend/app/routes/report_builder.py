"""API routes for the report builder chat."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import AuthContext, get_auth_context
from app.database import get_db
from app.services.report_builder.chat_handler import run_chat_turn
from app.services.report_builder.schemas import (
    BuilderChatRequest,
    BuilderChatResponse,
    ComposedReportOut,
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
        composed_report=composed,
    )
