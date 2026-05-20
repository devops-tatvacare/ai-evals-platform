"""Server-side LLM-assist endpoints.

Replaces the legacy browser-side LLM pipeline. Each request resolves
through ``resolve_llm_call`` with call site ``assist_prompt_or_schema`` —
the encrypted key never leaves the backend.
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
    CallSiteCapabilityMismatch,
    CallSiteCapabilityUnknown,
    CallSiteNotConfiguredError,
    ProviderNotConfiguredError,
    ResolvedLlmCall,
    resolve_llm_call,
)


router = APIRouter(prefix="/api/llm/assist", tags=["llm-assist"])


async def _resolve_or_409(
    db: AsyncSession,
    auth: AuthContext,
    *,
    provider: str | None,
    model: str | None,
) -> ResolvedLlmCall:
    try:
        return await resolve_llm_call(
            db, auth.tenant_id, "assist_prompt_or_schema",
            provider_override=provider or None,
            model_override=model or None,
        )
    except (
        CallSiteNotConfiguredError,
        CallSiteCapabilityMismatch,
        CallSiteCapabilityUnknown,
        ProviderNotConfiguredError,
    ) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(
    body: GeneratePromptRequest,
    auth: AuthContext = require_permission("asset:create"),
    db: AsyncSession = Depends(get_db),
):
    resolved = await _resolve_or_409(db, auth, provider=body.provider, model=body.model)
    try:
        prompt = await llm_assist_service.run_generate_prompt(
            resolved=resolved,
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
    resolved = await _resolve_or_409(db, auth, provider=body.provider, model=body.model)
    try:
        schema = await llm_assist_service.run_generate_schema(
            resolved=resolved,
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
    resolved = await _resolve_or_409(db, auth, provider=body.provider, model=body.model)
    return await llm_assist_service.run_extract_structured(
        resolved=resolved,
        body=body,
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
    )
