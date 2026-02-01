/**
 * LLM Provider icon registry
 * Maps provider names to their icon paths
 */

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'mistral' | 'cohere' | 'unknown';

export const providerIcons: Record<LLMProvider, string> = {
  gemini: '/images/gemini.svg',
  openai: '/images/openai.svg',
  anthropic: '/images/anthropic.svg',
  mistral: '/images/mistral.svg',
  cohere: '/images/cohere.svg',
  unknown: '/images/gemini.svg', // fallback
};

export const providerLabels: Record<LLMProvider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  mistral: 'Mistral',
  cohere: 'Cohere',
  unknown: 'AI',
};

/**
 * Detect provider from model name string
 */
export function detectProvider(modelName: string): LLMProvider {
  const lower = modelName.toLowerCase();
  
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('mistral')) return 'mistral';
  if (lower.includes('cohere') || lower.includes('command')) return 'cohere';
  
  return 'unknown';
}
