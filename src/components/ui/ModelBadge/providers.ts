import type { LlmProvider } from '@/services/api/llmCredentialsApi';
import { LLM_PROVIDER_LOGOS } from '@/constants/llmProviders';

const VALID_PROVIDERS = new Set<string>(Object.keys(LLM_PROVIDER_LOGOS));

/** Best-effort provider guess from a free model/deployment string. */
export function detectProvider(modelName: string): LlmProvider | null {
  const lower = modelName.toLowerCase();
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('vertex')) return 'vertex';
  if (lower.includes('bedrock')) return 'bedrock';
  if (lower.includes('azure')) return 'azure_openai';
  if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
  return null;
}

/** Prefer an explicit provider key, then detect from the hint, then the model string. */
export function resolveProvider(hint: string | undefined, modelName: string): LlmProvider | null {
  if (hint && VALID_PROVIDERS.has(hint)) return hint as LlmProvider;
  return detectProvider(hint ?? '') ?? detectProvider(modelName);
}
