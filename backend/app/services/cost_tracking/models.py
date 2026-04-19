"""Typed envelopes exchanged between provider wrappers and the recorder."""
from __future__ import annotations

from typing import Any, Literal, TypedDict


class LLMCallMetadata(TypedDict, total=False):
    """Best-effort per-call metadata normalized by provider adapters.

    Tokens are authoritative when present; other fields are best-effort and may
    be absent. The recorder never fabricates values — missing keys persist as
    NULL / 0 defaults.
    """

    provider: str
    model: str
    api_surface: str
    input_tokens: int
    output_tokens: int
    cached_read_tokens: int
    cached_write_tokens: int
    cached_write_ttl: Literal['5m', '1h']
    reasoning_tokens: int
    tool_use_prompt_tokens: int
    audio_seconds: float
    modality_details: dict[str, Any]
    duration_ms: int
    status: str
    error_code: str
    finish_reason: str
    request_id: str
    traffic_type: str
    server_tool_usage: dict[str, Any]
    raw_usage: dict[str, Any]


# Keys that are numeric (defaulted to 0 at persistence time when missing).
_TOKEN_KEYS: tuple[str, ...] = (
    'input_tokens',
    'output_tokens',
    'cached_read_tokens',
    'cached_write_tokens',
    'reasoning_tokens',
    'tool_use_prompt_tokens',
)


def empty_metadata() -> LLMCallMetadata:
    """Return an empty metadata envelope populated with zero-token defaults."""
    meta: LLMCallMetadata = {}
    for key in _TOKEN_KEYS:
        meta[key] = 0  # type: ignore[literal-required]
    return meta
