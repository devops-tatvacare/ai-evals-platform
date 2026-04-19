"""Provider-specific usage normalizers.

Each normalizer converts a raw SDK response into an ``LLMCallMetadata``
envelope. Missing fields stay absent — normalizers never fabricate billing
data from prose output or exception strings.
"""
from app.services.cost_tracking.normalizers.anthropic import normalize_anthropic
from app.services.cost_tracking.normalizers.gemini import normalize_gemini
from app.services.cost_tracking.normalizers.openai_chat import normalize_openai_chat
from app.services.cost_tracking.normalizers.openai_responses import normalize_openai_responses

__all__ = [
    'normalize_anthropic',
    'normalize_gemini',
    'normalize_openai_chat',
    'normalize_openai_responses',
]
