/**
 * Typed client for the server-side LLM-assist endpoints.
 *
 * Every call goes through the backend, which resolves provider credentials
 * via `resolve_llm_credentials` — the browser never holds an API key.
 */
import { apiRequest } from '@/services/api/client';
import type { LLMProvider } from '@/services/api/aiSettingsApi';

export type AssistPromptType = 'transcription' | 'evaluation' | 'extraction';
export type ExtractPromptType = 'freeform' | 'schema';
export type ExtractInputSource = 'transcript' | 'audio' | 'both';

export interface GeneratePromptBody {
  provider: LLMProvider;
  model: string;
  promptType: AssistPromptType;
  userIdea: string;
}

export interface GenerateSchemaBody {
  provider: LLMProvider;
  model: string;
  promptType: AssistPromptType;
  userIdea: string;
}

export interface ExtractStructuredBody {
  provider: LLMProvider;
  model: string;
  prompt: string;
  promptType: ExtractPromptType;
  inputSource: ExtractInputSource;
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
}

export interface ExtractStructuredResponse {
  result: Record<string, unknown>;
  status: 'completed' | 'failed';
  error: string | null;
}

export const llmAssistApi = {
  generatePrompt: (body: GeneratePromptBody): Promise<{ prompt: string }> =>
    apiRequest<{ prompt: string }>('/api/llm/assist/generate-prompt', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateSchema: (
    body: GenerateSchemaBody,
  ): Promise<{ schema: Record<string, unknown> }> =>
    apiRequest<{ schema: Record<string, unknown> }>('/api/llm/assist/generate-schema', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  extractStructured: (body: ExtractStructuredBody): Promise<ExtractStructuredResponse> =>
    apiRequest<ExtractStructuredResponse>('/api/llm/assist/extract-structured', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
