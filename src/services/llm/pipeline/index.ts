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
  const { apiKey, selectedModel } = useLLMSettingsStore.getState();

  if (!apiKey) {
    throw new Error('API key not configured');
  }

  return new LLMInvocationPipeline(apiKey, selectedModel);
}

/**
 * Create a pipeline with specific model (for evaluators that specify their own model)
 */
export function createLLMPipelineWithModel(modelId: string): LLMInvocationPipeline {
  const { apiKey } = useLLMSettingsStore.getState();

  if (!apiKey) {
    throw new Error('API key not configured');
  }

  return new LLMInvocationPipeline(apiKey, modelId);
}
