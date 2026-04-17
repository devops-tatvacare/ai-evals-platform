"""Canonical runtime contract for Sherlock chat streaming."""
from __future__ import annotations

from typing import Literal

TerminalStatus = Literal['done', 'degraded', 'error', 'interrupted']
TurnLifecycleStatus = Literal['queued', 'active', 'done', 'degraded', 'error', 'interrupted']
RuntimeOperation = Literal['send', 'resume']

RUNTIME_EVENT_TYPES = (
    'session',
    'entity_recognition',
    'tool_call_start',
    'tool_call_end',
    'content_delta',
    'chart',
    'done',
    'error',
)
