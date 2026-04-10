"""API routes for the chat engine."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends

from app.auth import AuthContext, get_auth_context

router = APIRouter(prefix="/api/chat-engine", tags=["chat-engine"])


@router.get("/defaults")
async def get_defaults(auth: AuthContext = Depends(get_auth_context)):
    """Return default model per provider for the chat widget."""
    return {
        "gemini": {
            "model": os.getenv("GEMINI_MODEL", "") or "gemini-2.5-flash",
        },
        "openai": {
            "model": os.getenv("OPENAI_MODEL", "") or "gpt-4o-mini",
        },
    }
