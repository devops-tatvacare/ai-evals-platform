import { apiRequest } from '@/services/api/client';

export interface DiscoveredModel {
  name: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/** @deprecated Use `DiscoveredModel` instead. Kept for backward compat with existing imports. */
export type GeminiModel = DiscoveredModel;

// ── Cache: keyed by "provider:apiKey:endpoint" ──────────────────

const modelCache = new Map<string, DiscoveredModel[]>();

function cacheKey(provider: string, creds?: DiscoverCredentials): string {
  return `${provider}:${creds?.apiKey ?? ''}:${creds?.endpoint ?? ''}`;
}

export function clearModelCache(): void {
  modelCache.clear();
}

// ── Unified discovery — single POST to backend ──────────────────

interface DiscoverCredentials {
  apiKey?: string;
  endpoint?: string;
  apiVersion?: string;
}

const DISCOVER_TIMEOUT_MS = 15_000;

export async function discoverModels(
  provider: string,
  credentials?: DiscoverCredentials,
): Promise<DiscoveredModel[]> {
  const key = cacheKey(provider, credentials);
  const cached = modelCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);

  try {
    const models = await apiRequest<DiscoveredModel[]>('/api/llm/discover-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        apiKey: credentials?.apiKey || undefined,
        endpoint: credentials?.endpoint || undefined,
        apiVersion: credentials?.apiVersion || undefined,
      }),
      signal: controller.signal,
    });

    modelCache.set(key, models);
    return models;
  } finally {
    clearTimeout(timer);
  }
}

// ── Legacy re-exports (thin wrappers) ───────────────────────────
// Used by PromptGeneratorModal, SchemaGeneratorModal, SchemaModal

export async function discoverGeminiModels(apiKey: string): Promise<DiscoveredModel[]> {
  return discoverModels('gemini', { apiKey });
}

export async function discoverOpenAIModels(apiKey: string): Promise<DiscoveredModel[]> {
  return discoverModels('openai', { apiKey });
}

export async function discoverAnthropicModels(): Promise<DiscoveredModel[]> {
  return discoverModels('anthropic');
}

export async function discoverModelsViaBackend(provider: string): Promise<DiscoveredModel[]> {
  return discoverModels(provider);
}
