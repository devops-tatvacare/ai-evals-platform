import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import type { ILLMProvider, LLMGenerateOptions, LLMResponse } from '@/types';
import { createRetryableError } from './retryPolicy';
import type { ErrorCode } from '@/types';

export class GeminiProvider implements ILLMProvider {
  name = 'gemini';
  private client: GoogleGenAI | null = null;
  private abortController: AbortController | null = null;
  private apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId: string = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.modelId = modelId;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.client) {
      return false;
    }
    try {
      // Simple test to check if API key works
      await this.client.models.generateContent({
        model: this.modelId,
        contents: 'test',
      });
      return true;
    } catch (error) {
      // If it's an auth error, return false
      if (error instanceof Error && error.message.includes('API key')) {
        return false;
      }
      // Other errors (rate limit, etc) mean the key is valid but we hit a limit
      return true;
    }
  }

  private mapError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return createRetryableError('Unknown error', 'UNKNOWN_ERROR', false);
    }

    const message = error.message.toLowerCase();
    let code: ErrorCode = 'UNKNOWN_ERROR';
    let retryable = false;

    if (message.includes('api key') || message.includes('api_key') || message.includes('unauthorized')) {
      code = 'LLM_API_KEY_INVALID';
    } else if (message.includes('rate') || message.includes('quota') || message.includes('429')) {
      code = 'LLM_RATE_LIMITED';
      retryable = true;
    } else if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      code = 'LLM_NETWORK_ERROR';
      retryable = true;
    } else if (message.includes('timeout') || message.includes('timed out')) {
      code = 'LLM_TIMEOUT';
      retryable = true;
    } else if (message.includes('invalid') || message.includes('malformed')) {
      code = 'LLM_RESPONSE_INVALID';
    }

    return createRetryableError(error.message, code, retryable);
  }

  async generateContent(
    prompt: string,
    options?: LLMGenerateOptions
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw createRetryableError('API key not configured', 'LLM_API_KEY_MISSING', false);
    }

    this.abortController = new AbortController();
    
    // Use provided signal or our internal one
    const signal = options?.abortSignal || this.abortController.signal;

    try {
      const config: Record<string, unknown> = {
        temperature: options?.temperature ?? 0.7,
        topK: options?.topK ?? 40,
        topP: options?.topP ?? 0.95,
        abortSignal: signal,
      };

      // Only set maxOutputTokens if explicitly provided
      if (options?.maxOutputTokens) {
        config.maxOutputTokens = options.maxOutputTokens;
        console.log('[GeminiProvider] Setting maxOutputTokens:', options.maxOutputTokens);
      }

      // Add structured output if schema provided
      if (options?.responseSchema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = options.responseSchema;
      }
      
      console.log('[GeminiProvider] Final config being sent to API:', {
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        hasSchema: !!config.responseSchema,
        hasAbortSignal: !!config.abortSignal,
      });

      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: prompt,
        config,
      });
      
      console.log('[GeminiProvider] Raw response received', {
        hasText: !!response.text,
        textLength: response.text?.length || 0,
        hasCandidates: !!(response as any).candidates?.length,
        finishReason: (response as any).candidates?.[0]?.finishReason,
        promptTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      });
      
      console.log('[GeminiProvider] Response metadata:', {
        finishReason: (response as any).candidates?.[0]?.finishReason,
        promptTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      });

      return {
        text: response.text ?? '',
        raw: response,
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        } : undefined,
      };
    } catch (error) {
      throw this.mapError(error);
    } finally {
      this.abortController = null;
    }
  }

  async generateContentWithAudio(
    prompt: string,
    audioBlob: Blob,
    mimeType: string,
    options?: LLMGenerateOptions
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw createRetryableError('API key not configured', 'LLM_API_KEY_MISSING', false);
    }

    this.abortController = new AbortController();
    
    // Use provided signal or our internal one
    const signal = options?.abortSignal || this.abortController.signal;

    try {
      // Upload the audio file first
      const file = new File([audioBlob], 'audio', { type: mimeType });
      
      console.log('[GeminiProvider] Starting audio file upload', {
        blobSize: audioBlob.size,
        mimeType,
      });
      
      const uploadedFile = await this.client.files.upload({
        file,
        config: { mimeType },
      });

      console.log('[GeminiProvider] Audio upload complete', {
        uri: uploadedFile.uri,
        state: (uploadedFile as any).state,
        mimeType: uploadedFile.mimeType,
        name: (uploadedFile as any).name,
      });

      if (!uploadedFile.uri || !uploadedFile.mimeType) {
        throw new Error('Failed to upload audio file');
      }

      // Generate content with the uploaded file
      const config: Record<string, unknown> = {
        temperature: options?.temperature ?? 0.7,
        topK: options?.topK ?? 40,
        topP: options?.topP ?? 0.95,
        abortSignal: signal,
      };

      // Only set maxOutputTokens if explicitly provided
      if (options?.maxOutputTokens) {
        config.maxOutputTokens = options.maxOutputTokens;
      }

      // Add structured output if schema provided
      if (options?.responseSchema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = options.responseSchema;
      }

      const response = await this.client.models.generateContent({
        model: this.modelId,
        contents: createUserContent([
          createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
          prompt,
        ]),
        config,
      });

      console.log('[GeminiProvider] Audio response received', {
        hasText: !!response.text,
        textLength: response.text?.length || 0,
        hasCandidates: !!(response as any).candidates?.length,
        finishReason: (response as any).candidates?.[0]?.finishReason,
        promptTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      });

      return {
        text: response.text ?? '',
        raw: response,
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        } : undefined,
      };
    } catch (error) {
      console.error('[GeminiProvider] Audio generation error', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw this.mapError(error);
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
