import { GoogleGenAI } from '@google/genai';
import { apiRequest } from '@/services/api/client';

export interface GeminiModel {
  name: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

// Cache models to avoid repeated API calls
let cachedModels: GeminiModel[] | null = null;
let cacheAuthKey: string | null = null;

export async function discoverGeminiModels(apiKey: string): Promise<GeminiModel[]> {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  // Return cached models if same auth
  if (cachedModels && cacheAuthKey === apiKey) {
    return cachedModels;
  }

  // Initialize client with API key
  const client = new GoogleGenAI({ apiKey });

  try {
    const response = await client.models.list();
    const models: GeminiModel[] = [];

    // response is a pager, iterate through models
    for await (const model of response) {
      // Only include generative models (exclude embedding models, etc.)
      if (model.name && model.name.includes('gemini')) {
        models.push({
          name: model.name.replace('models/', ''),
          displayName: model.displayName ?? model.name.replace('models/', ''),
          description: model.description ?? undefined,
          inputTokenLimit: model.inputTokenLimit ?? undefined,
          outputTokenLimit: model.outputTokenLimit ?? undefined,
        });
      }
    }

    // Sort by name
    models.sort((a, b) => a.name.localeCompare(b.name));

    // Cache results
    cachedModels = models;
    cacheAuthKey = apiKey;

    return models;
  } catch (error) {
    console.error('Failed to discover models:', error);
    throw error;
  }
}

export function clearModelCache(): void {
  cachedModels = null;
  cacheAuthKey = null;
  cachedBackendModels = null;
  cachedOpenAIModels = null;
  openAICacheAuthKey = null;
}

// ── Backend-proxied model discovery (service account mode) ──────

let cachedBackendModels: GeminiModel[] | null = null;

export async function discoverModelsViaBackend(provider: string): Promise<GeminiModel[]> {
  if (cachedBackendModels) return cachedBackendModels;

  const models = await apiRequest<GeminiModel[]>(`/api/llm/models?provider=${provider}`);
  cachedBackendModels = models;
  return models;
}

// ── OpenAI model discovery ──────────────────────────────────────

const OPENAI_FALLBACK_MODELS: GeminiModel[] = [
  { name: 'gpt-4o', displayName: 'GPT-4o', inputTokenLimit: 128000, outputTokenLimit: 16384 },
  { name: 'gpt-4o-mini', displayName: 'GPT-4o Mini', inputTokenLimit: 128000, outputTokenLimit: 16384 },
  { name: 'gpt-4o-audio-preview', displayName: 'GPT-4o Audio Preview', inputTokenLimit: 128000, outputTokenLimit: 16384 },
];

let cachedOpenAIModels: GeminiModel[] | null = null;
let openAICacheAuthKey: string | null = null;

export async function discoverOpenAIModels(apiKey: string): Promise<GeminiModel[]> {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (cachedOpenAIModels && openAICacheAuthKey === apiKey) {
    return cachedOpenAIModels;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const models: GeminiModel[] = (data.data || [])
      .filter((m: { id: string }) =>
        m.id.includes('gpt-4o') || m.id.includes('gpt-4') || m.id.includes('o1') || m.id.includes('o3')
      )
      .map((m: { id: string }) => ({
        name: m.id,
        displayName: m.id,
        inputTokenLimit: 128000,
        outputTokenLimit: 16384,
      }))
      .sort((a: GeminiModel, b: GeminiModel) => a.name.localeCompare(b.name));

    cachedOpenAIModels = models.length > 0 ? models : OPENAI_FALLBACK_MODELS;
    openAICacheAuthKey = apiKey;
    return cachedOpenAIModels;
  } catch (error) {
    console.error('Failed to discover OpenAI models, using fallback:', error);
    cachedOpenAIModels = OPENAI_FALLBACK_MODELS;
    openAICacheAuthKey = apiKey;
    return OPENAI_FALLBACK_MODELS;
  }
}
