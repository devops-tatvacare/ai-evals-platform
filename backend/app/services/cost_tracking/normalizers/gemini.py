"""Gemini (Vertex + Developer API) response normalizer.

Docs guarantee ``prompt_token_count``, ``candidates_token_count``,
``total_token_count``. Cache, reasoning, tool-use-prompt, modality, and
traffic-type fields are read defensively — missing on many calls.
"""
from __future__ import annotations

from typing import Any

from app.services.cost_tracking.models import LLMCallMetadata, empty_metadata


def _get(obj: Any, name: str) -> Any:
    """Safe getattr that also tolerates dict-shaped payloads (for tests)."""
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


def normalize_gemini(response: Any) -> LLMCallMetadata:
    """Return a best-effort metadata envelope for a Gemini response."""
    meta = empty_metadata()
    meta['provider'] = 'gemini'
    meta['api_surface'] = 'generate_content'

    usage = _get(response, 'usage_metadata')
    if usage is None:
        return meta

    prompt_tokens = _int_or_zero(_get(usage, 'prompt_token_count'))
    cached = _int_or_zero(_get(usage, 'cached_content_token_count'))
    candidates = _int_or_zero(_get(usage, 'candidates_token_count'))
    thoughts = _int_or_zero(_get(usage, 'thoughts_token_count'))
    tool_use = _int_or_zero(_get(usage, 'tool_use_prompt_token_count'))

    # prompt_token_count is the total input (cached + uncached). Split for the
    # fact table so cost math can apply the reduced cache-read rate.
    uncached_input = max(0, prompt_tokens - cached)
    meta['input_tokens'] = uncached_input
    meta['cached_read_tokens'] = cached
    meta['output_tokens'] = candidates
    meta['reasoning_tokens'] = thoughts
    meta['tool_use_prompt_tokens'] = tool_use

    modality_details = _get(usage, 'prompt_tokens_details')
    if modality_details is not None:
        meta['modality_details'] = _coerce_to_dict(modality_details)

    traffic_type = _get(response, 'traffic_type') or _get(usage, 'traffic_type')
    if traffic_type:
        meta['traffic_type'] = str(traffic_type)

    finish_reason = _extract_finish_reason(response)
    if finish_reason:
        meta['finish_reason'] = finish_reason

    raw_usage = _coerce_to_dict(usage)
    if raw_usage:
        meta['raw_usage'] = raw_usage

    return meta


def _extract_finish_reason(response: Any) -> str | None:
    candidates = _get(response, 'candidates')
    if not candidates:
        return None
    try:
        first = candidates[0]
    except (IndexError, TypeError):
        return None
    reason = _get(first, 'finish_reason')
    if reason is None:
        return None
    # SDK returns an enum whose name carries the stable label.
    name = getattr(reason, 'name', None)
    if name:
        return str(name)
    return str(reason)


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
    if hasattr(obj, 'to_dict'):
        try:
            result = obj.to_dict()
            if isinstance(result, dict):
                return result
        except Exception:
            pass
    # Last resort: read public attributes only.
    return {
        key: getattr(obj, key)
        for key in dir(obj)
        if not key.startswith('_') and not callable(getattr(obj, key, None))
    }
