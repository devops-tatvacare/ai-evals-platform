"""Provider/model normalization + heuristic pricing field derivation.

models.dev currently only guarantees ``cost.input`` and ``cost.output``.
Everything else (cache/reasoning/cache-write TTLs) uses the heuristics below
and is flagged in ``cost_breakdown.derived_pricing_fields`` so a later refresh
can distinguish source truth from heuristic fill-ins.
"""
from __future__ import annotations

from decimal import Decimal
from typing import TypedDict


class ProviderDerivedPricing(TypedDict, total=False):
    cached_read_multiplier: Decimal
    cache_write_5m_multiplier: Decimal
    cache_write_1h_multiplier: Decimal
    reasoning_from_output: bool


# models.dev source provider → (internal provider key, alias map for sub-providers)
PROVIDER_MAP: dict[str, tuple[str, dict[str, str]]] = {
    'google': ('gemini', {'vertex': 'gemini'}),
    'openai': ('openai', {}),
    'anthropic': ('anthropic', {}),
    'azure': ('azure_openai', {}),
}

ALLOWLIST: frozenset[str] = frozenset(PROVIDER_MAP.keys())


# Heuristic multipliers applied when the source lacks detailed cache/reasoning rates.
PROVIDER_DERIVED_PRICING: dict[str, ProviderDerivedPricing] = {
    'gemini': {
        'cached_read_multiplier': Decimal('0.1'),
        'cache_write_5m_multiplier': Decimal('0'),
        'cache_write_1h_multiplier': Decimal('0'),
        'reasoning_from_output': True,
    },
    'openai': {
        'cached_read_multiplier': Decimal('0.1'),
        'cache_write_5m_multiplier': Decimal('0'),
        'cache_write_1h_multiplier': Decimal('0'),
        'reasoning_from_output': True,
    },
    'azure_openai': {
        'cached_read_multiplier': Decimal('0.1'),
        'cache_write_5m_multiplier': Decimal('0'),
        'cache_write_1h_multiplier': Decimal('0'),
        'reasoning_from_output': True,
    },
    'anthropic': {
        'cached_read_multiplier': Decimal('0.1'),
        'cache_write_5m_multiplier': Decimal('1.25'),
        'cache_write_1h_multiplier': Decimal('2.0'),
        'reasoning_from_output': True,
    },
}


# Classname → internal provider key, used by ``LoggingLLMWrapper`` to translate
# ``type(inner).__name__`` into the recorder's canonical provider key.
PROVIDER_CLASS_KEYS: dict[str, str] = {
    'GeminiProvider': 'gemini',
    'OpenAIProvider': 'openai',
    'AzureOpenAIProvider': 'azure_openai',
    'AnthropicProvider': 'anthropic',
}


def internal_provider_from_classname(class_name: str) -> str:
    """Translate ``type(provider).__name__`` into the internal provider key."""
    return PROVIDER_CLASS_KEYS.get(class_name, class_name.lower())


def model_family_for(provider: str, model: str) -> str | None:
    """Return a coarse model family hint, best-effort only.

    Used to populate ``llm_usage.model_family``. None means unknown.
    """
    if not model:
        return None
    lowered = model.lower()
    if provider == 'gemini':
        if '3.1' in lowered or 'gemini-3' in lowered:
            return 'gemini-3'
        if '2.5' in lowered:
            return 'gemini-2.5'
        if '2.0' in lowered:
            return 'gemini-2.0'
        if '1.5' in lowered:
            return 'gemini-1.5'
        return 'gemini'
    if provider == 'anthropic':
        if 'opus' in lowered:
            return 'claude-opus'
        if 'sonnet' in lowered:
            return 'claude-sonnet'
        if 'haiku' in lowered:
            return 'claude-haiku'
        return 'claude'
    if provider in ('openai', 'azure_openai'):
        if 'gpt-5' in lowered:
            return 'gpt-5'
        if 'gpt-4o' in lowered:
            return 'gpt-4o'
        if 'gpt-4' in lowered:
            return 'gpt-4'
        if lowered.startswith('o'):
            return 'openai-reasoning'
        return 'openai'
    return None
