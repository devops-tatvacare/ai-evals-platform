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

/** Default model for AI-assist features (prompt/schema generators). Gemini-only, API-key mode. */
const GEMINI_ASSIST_MODEL = 'gemini-2.0-flash';

export function createLLMPipeline(): LLMInvocationPipeline {
  const { apiKey, _serviceAccountConfigured } = useLLMSettingsStore.getState();

  if (!apiKey) {
    if (_serviceAccountConfigured) {
      throw new Error(
        'AI-assist features require an API key. Background evaluation jobs still work using the server\'s service account. Add a Gemini API key in Settings.'
      );
    }
    throw new Error('API key not configured. Add your API key in Settings.');
  }

  return new LLMInvocationPipeline(apiKey, GEMINI_ASSIST_MODEL);
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
