"""OpenAI Responses API normalizer.

Primary usage shape (as of 2026-04):
- ``usage.input_tokens``, ``usage.output_tokens``, ``usage.total_tokens``
- ``usage.input_tokens_details.cached_tokens``
- ``usage.output_tokens_details.reasoning_tokens``

Request id comes from the SDK response / ``x-request-id`` header.
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


def normalize_openai_responses(response: Any, *, provider: str = 'openai') -> LLMCallMetadata:
    """Return a best-effort metadata envelope for a Responses API call."""
    meta = empty_metadata()
    meta['provider'] = provider
    meta['api_surface'] = 'responses'

    usage = _get(response, 'usage')
    if usage is not None:
        input_tokens = _int_or_zero(_get(usage, 'input_tokens'))
        output_tokens = _int_or_zero(_get(usage, 'output_tokens'))

        input_details = _get(usage, 'input_tokens_details')
        cached_read = _int_or_zero(_get(input_details, 'cached_tokens')) if input_details else 0

        output_details = _get(usage, 'output_tokens_details')
        reasoning_tokens = (
            _int_or_zero(_get(output_details, 'reasoning_tokens')) if output_details else 0
        )

        meta['input_tokens'] = max(0, input_tokens - cached_read)
        meta['cached_read_tokens'] = cached_read
        meta['output_tokens'] = max(0, output_tokens - reasoning_tokens)
        meta['reasoning_tokens'] = reasoning_tokens

        if input_details is not None:
            modality = _coerce_to_dict(input_details)
            if modality:
                meta['modality_details'] = modality

        raw_usage = _coerce_to_dict(usage)
        if raw_usage:
            meta['raw_usage'] = raw_usage

    status = _get(response, 'status')
    if status:
        meta['finish_reason'] = str(status)

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
