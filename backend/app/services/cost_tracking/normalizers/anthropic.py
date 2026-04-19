"""Anthropic Messages API normalizer.

Stable documented fields:
- ``usage.input_tokens``
- ``usage.output_tokens``
- ``usage.cache_creation_input_tokens``
- ``usage.cache_read_input_tokens``

Server-tool and TTL-split cache-write details are NOT reliably exposed as
top-level billing fields. We record them only when the live SDK payload
explicitly surfaces them.
"""
from __future__ import annotations

from typing import Any

from app.services.cost_tracking.models import LLMCallMetadata, empty_metadata


def _get(obj: Any, name: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _int_or_zero(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def normalize_anthropic(response: Any) -> LLMCallMetadata:
    """Return a best-effort metadata envelope for an Anthropic Messages response."""
    meta = empty_metadata()
    meta['provider'] = 'anthropic'
    meta['api_surface'] = 'messages'

    usage = _get(response, 'usage')
    if usage is not None:
        meta['input_tokens'] = _int_or_zero(_get(usage, 'input_tokens'))
        meta['output_tokens'] = _int_or_zero(_get(usage, 'output_tokens'))
        meta['cached_read_tokens'] = _int_or_zero(_get(usage, 'cache_read_input_tokens'))
        cached_write = _int_or_zero(_get(usage, 'cache_creation_input_tokens'))
        meta['cached_write_tokens'] = cached_write

        # TTL split (5m default, 1h extended) — only surfaced by newer SDK
        # payloads via ``cache_creation`` sub-object. Read defensively.
        cache_creation = _get(usage, 'cache_creation')
        if isinstance(cache_creation, dict):
            ephemeral_5m = _int_or_zero(cache_creation.get('ephemeral_5m_input_tokens'))
            ephemeral_1h = _int_or_zero(cache_creation.get('ephemeral_1h_input_tokens'))
            if ephemeral_1h > ephemeral_5m and cached_write > 0:
                meta['cached_write_ttl'] = '1h'
            elif cached_write > 0:
                meta['cached_write_ttl'] = '5m'

        server_tool = _get(usage, 'server_tool_use')
        if server_tool is not None:
            server = _coerce_to_dict(server_tool)
            if server:
                meta['server_tool_usage'] = server

        raw_usage = _coerce_to_dict(usage)
        if raw_usage:
            meta['raw_usage'] = raw_usage

    stop_reason = _get(response, 'stop_reason')
    if stop_reason:
        meta['finish_reason'] = str(stop_reason)

    request_id = _get(response, 'id')
    if request_id:
        meta['request_id'] = str(request_id)

    return meta


def _coerce_to_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return {k: v for k, v in obj.items()}
    if hasattr(obj, 'model_dump'):
        try:
            return obj.model_dump()
        except Exception:
            pass
    return {
        key: getattr(obj, key)
        for key in dir(obj)
        if not key.startswith('_') and not callable(getattr(obj, key, None))
    }
