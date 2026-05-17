import type { LlmProvider } from '@/services/api/llmCredentialsApi';

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  azure_openai: 'Azure OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  vertex: 'Vertex AI',
  bedrock: 'AWS Bedrock',
};

export const LLM_PROVIDER_LOGOS: Record<LlmProvider, string> = {
  openai: '/llm-logos/openai.svg',
  azure_openai: '/llm-logos/azure.svg',
  anthropic: '/llm-logos/anthropic.svg',
  gemini: '/llm-logos/gemini.svg',
  vertex: '/llm-logos/vertex.svg',
  bedrock: '/llm-logos/bedrock.svg',
};

