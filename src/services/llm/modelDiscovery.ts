import { GoogleGenAI } from '@google/genai';

export interface GeminiModel {
  name: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

// Cache models to avoid repeated API calls
let cachedModels: GeminiModel[] | null = null;
let cacheApiKey: string | null = null;

export async function discoverGeminiModels(apiKey: string): Promise<GeminiModel[]> {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  // Return cached models if same API key
  if (cachedModels && cacheApiKey === apiKey) {
    return cachedModels;
  }

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
    cacheApiKey = apiKey;
    
    return models;
  } catch (error) {
    console.error('Failed to discover models:', error);
    throw error;
  }
}

export function clearModelCache(): void {
  cachedModels = null;
  cacheApiKey = null;
}
