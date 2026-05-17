import type { LLMProvider } from '@/services/api/aiSettingsApi';

export const LLM_PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: 'OpenAI',
  azure_openai: 'Azure OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export const LLM_PROVIDER_LOGOS: Record<LLMProvider, string> = {
  openai: '/llm-logos/openai.svg',
  azure_openai: '/llm-logos/azure.svg',
  anthropic: '/llm-logos/anthropic.svg',
  gemini: '/llm-logos/gemini.svg',
};

