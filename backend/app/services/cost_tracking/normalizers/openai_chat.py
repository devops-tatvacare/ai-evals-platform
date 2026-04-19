"""OpenAI / Azure OpenAI ``chat.completions`` response normalizer.

Documented fields:
- ``usage.prompt_tokens``
- ``usage.completion_tokens``
- ``usage.prompt_tokens_details.cached_tokens``
- ``usage.completion_tokens_details.reasoning_tokens``

All reads are defensive; older deployments may not expose ``*_details``.
Request id comes from the response header / ``response.id`` when present.
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


def normalize_openai_chat(response: Any, *, provider: str = 'openai') -> LLMCallMetadata:
    """Return a best-effort metadata envelope for a Chat Completions response."""
    meta = empty_metadata()
    meta['provider'] = provider
    meta['api_surface'] = 'chat_completions'

    usage = _get(response, 'usage')
    if usage is None:
        _populate_top_level(meta, response)
        return meta

    prompt_tokens = _int_or_zero(_get(usage, 'prompt_tokens'))
    completion_tokens = _int_or_zero(_get(usage, 'completion_tokens'))

    prompt_details = _get(usage, 'prompt_tokens_details')
    cached_read = _int_or_zero(_get(prompt_details, 'cached_tokens')) if prompt_details else 0

    completion_details = _get(usage, 'completion_tokens_details')
    reasoning_tokens = (
        _int_or_zero(_get(completion_details, 'reasoning_tokens'))
        if completion_details
        else 0
    )

    meta['input_tokens'] = max(0, prompt_tokens - cached_read)
    meta['cached_read_tokens'] = cached_read
    meta['output_tokens'] = max(0, completion_tokens - reasoning_tokens)
    meta['reasoning_tokens'] = reasoning_tokens

    if prompt_details is not None:
        modality = _coerce_to_dict(prompt_details)
        if modality:
            meta['modality_details'] = modality

    raw_usage = _coerce_to_dict(usage)
    if raw_usage:
        meta['raw_usage'] = raw_usage

    _populate_top_level(meta, response)
    return meta


def _populate_top_level(meta: LLMCallMetadata, response: Any) -> None:
    finish_reason = _extract_finish_reason(response)
    if finish_reason:
        meta['finish_reason'] = finish_reason

    request_id = _get(response, 'id')
    if request_id:
        meta['request_id'] = str(request_id)


def _extract_finish_reason(response: Any) -> str | None:
    choices = _get(response, 'choices')
    if not choices:
        return None
    try:
        first = choices[0]
    except (IndexError, TypeError):
        return None
    reason = _get(first, 'finish_reason')
    if reason is None:
        return None
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
    return {
        key: getattr(obj, key)
        for key in dir(obj)
        if not key.startswith('_') and not callable(getattr(obj, key, None))
    }
