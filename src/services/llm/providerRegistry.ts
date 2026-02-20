import type { ILLMProvider } from '@/types';
import { GeminiProvider } from './GeminiProvider';

type ProviderFactory = (apiKey: string, modelId?: string) => ILLMProvider;

interface ProviderRegistration {
  name: string;
  factory: ProviderFactory;
}

class LLMProviderRegistry {
  private providers = new Map<string, ProviderRegistration>();
  private defaultProvider: string = 'gemini';
  private activeInstances = new Map<string, ILLMProvider>();

  register(name: string, factory: ProviderFactory): void {
    this.providers.set(name, { name, factory });
  }

  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    this.defaultProvider = name;
  }

  getProvider(apiKey: string, modelId?: string, name?: string): ILLMProvider {
    const providerName = name ?? this.defaultProvider;
    const registration = this.providers.get(providerName);

    if (!registration) {
      throw new Error(`Provider "${providerName}" is not registered`);
    }

    // Create a cache key based on provider name, API key, and model
    const cacheKey = `${providerName}:${apiKey}:${modelId ?? 'default'}`;

    // Check if we have an existing instance
    let instance = this.activeInstances.get(cacheKey);
    if (!instance) {
      instance = registration.factory(apiKey, modelId);
      this.activeInstances.set(cacheKey, instance);
    }

    return instance;
  }

  clearCache(): void {
    this.activeInstances.clear();
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Create singleton instance
export const llmProviderRegistry = new LLMProviderRegistry();

// Register default providers
llmProviderRegistry.register('gemini', (apiKey: string, modelId?: string) => {
  return new GeminiProvider(apiKey, modelId ?? '');
});
