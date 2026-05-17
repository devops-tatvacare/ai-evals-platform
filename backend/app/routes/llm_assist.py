"""Server-side LLM-assist endpoints.

Replaces the legacy browser-side LLM pipeline. Each request resolves
credentials via ``resolve_credentials`` — the encrypted key never leaves
the backend.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, require_permission
from app.database import get_db
from app.schemas.llm_assist import (
    ExtractStructuredRequest,
    ExtractStructuredResponse,
    GeneratePromptRequest,
    GeneratePromptResponse,
    GenerateSchemaRequest,
    GenerateSchemaResponse,
)
from app.services import llm_assist_service
from app.services.llm_credentials import (
    ProviderNotConfiguredError,
    ResolvedCredentials,
    resolve_credentials,
)


router = APIRouter(prefix="/api/llm/assist", tags=["llm-assist"])


async def _resolve_or_409(
    db: AsyncSession, auth: AuthContext, provider: str
) -> ResolvedCredentials:
    try:
        return await resolve_credentials(db, auth.tenant_id, provider)
    except ProviderNotConfiguredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(
    body: GeneratePromptRequest,
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    creds = await _resolve_or_409(db, auth, body.provider)
    try:
        prompt = await llm_assist_service.run_generate_prompt(
            creds=creds,
            model=body.model,
            prompt_type=body.prompt_type,
            user_idea=body.user_idea,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GeneratePromptResponse(prompt=prompt)


@router.post("/generate-schema", response_model=GenerateSchemaResponse)
async def generate_schema(
    body: GenerateSchemaRequest,
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    creds = await _resolve_or_409(db, auth, body.provider)
    try:
        schema = await llm_assist_service.run_generate_schema(
            creds=creds,
            model=body.model,
            prompt_type=body.prompt_type,
            user_idea=body.user_idea,
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GenerateSchemaResponse(schema=schema)


@router.post("/extract-structured", response_model=ExtractStructuredResponse)
async def extract_structured(
    body: ExtractStructuredRequest,
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    creds = await _resolve_or_409(db, auth, body.provider)
    return await llm_assist_service.run_extract_structured(
        creds=creds,
        model=body.model,
        body=body,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
