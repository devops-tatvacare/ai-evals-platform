"""Smoke tests for the Sherlock chat engine exports."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from app.services.chat_engine import (
    SherlockContext,
    build_sherlock_tools,
    create_openai_client,
    run_sherlock_sdk_turn,
)


def test_chat_engine_exports_sdk_symbols():
    ctx = SherlockContext(
        db=MagicMock(),
        auth=MagicMock(),
        app_id='kaira-bot',
        provider='openai',
        working_session={'scratchpad': {}, 'app_id': 'kaira-bot'},
        emit=AsyncMock(),
        tool_call_log=[],
    )

    assert ctx.provider == 'openai'
    assert callable(create_openai_client)
    assert callable(run_sherlock_sdk_turn)


def test_build_sherlock_tools_returns_function_tools():
    tools = build_sherlock_tools([
        {
            'name': 'discover',
            'description': 'Discover dimensions.',
            'inputSchema': {
                'type': 'object',
                'properties': {},
                'required': [],
            },
        },
    ])

    assert len(tools) == 1
    assert tools[0].name == 'discover'
