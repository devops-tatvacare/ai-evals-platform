/**
 * LLM Invocation Pipeline
 * Exports and factory function
 */

export { LLMInvocationPipeline } from './LLMInvocationPipeline';
export { TimeoutStrategy } from './TimeoutStrategy';
export { SchemaValidator } from './SchemaValidator';
export { InvocationStateManager } from './InvocationStateManager';
export * from './types';

// Factory function
import { LLMInvocationPipeline } from './LLMInvocationPipeline';
import { useLLMSettingsStore } from '@/stores';

export function createLLMPipeline(): LLMInvocationPipeline {
  const { apiKey, selectedModel, _serviceAccountConfigured } = useLLMSettingsStore.getState();

  if (!apiKey) {
    if (_serviceAccountConfigured) {
      throw new Error(
        'AI-assist features require an API key. Background evaluation jobs still work using the server\'s service account. Add a Gemini API key in Settings.'
      );
    }
    throw new Error('API key not configured. Add your API key in Settings.');
  }

  return new LLMInvocationPipeline(apiKey, selectedModel);
}

/**
 * Create a pipeline with specific model (for evaluators that specify their own model)
 */
export function createLLMPipelineWithModel(modelId: string): LLMInvocationPipeline {
  const { apiKey, _serviceAccountConfigured } = useLLMSettingsStore.getState();

  if (!apiKey) {
    if (_serviceAccountConfigured) {
      throw new Error(
        'AI-assist features require an API key. Background evaluation jobs still work using the server\'s service account. Add a Gemini API key in Settings.'
      );
    }
    throw new Error('API key not configured. Add your API key in Settings.');
  }

  return new LLMInvocationPipeline(apiKey, modelId);
}
