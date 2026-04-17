"""
Chat engine for Sherlock.
OpenAI (native + Azure) via the Agents SDK.
"""
from __future__ import annotations

from app.services.chat_engine.openai_agents_adapter import (
    SherlockContext,
    build_sherlock_tools,
    create_openai_client,
    run_sherlock_sdk_turn,
)
