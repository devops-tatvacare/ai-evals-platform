/**
 * LLM Invocation Pipeline
 * The BRAIN - single entry point for ALL LLM invocations
 * 
 * Features:
 * - Normalized inputs
 * - Observable pipeline stages
 * - Intelligent timeout management
 * - Lenient schema validation
 * - Clear error surfacing
 */

import { GeminiProvider } from '../GeminiProvider';
import { createAbortControllerWithTimeout } from '@/utils';
import { TimeoutStrategy } from './TimeoutStrategy';
import { SchemaValidator } from './SchemaValidator';
import { InvocationStateManager } from './InvocationStateManager';
import { InvocationError } from './types';
import type {
  LLMInvocationRequest,
  LLMInvocationResponse,
} from './types';

interface PreparedInvocation {
  prompt: string;
  schema?: Record<string, unknown>;
  audioBlob?: Blob;
  audioMimeType?: string;
  config: {
    temperature?: number;
    maxOutputTokens?: number;
    topK?: number;
    topP?: number;
    timeoutMs: number;
  };
  abortController: AbortController;
  cleanup: () => void;
}

export class LLMInvocationPipeline {
  private provider: GeminiProvider;
  private timeoutStrategy: TimeoutStrategy;
  private schemaValidator: SchemaValidator;
  private stateManager: InvocationStateManager;
  
  constructor(apiKey: string, model: string) {
    this.provider = new GeminiProvider(apiKey, model);
    this.timeoutStrategy = new TimeoutStrategy();
    this.schemaValidator = new SchemaValidator();
    this.stateManager = new InvocationStateManager();
  }
  
  /**
   * Single entry point for ALL LLM invocations
   */
  async invoke(request: LLMInvocationRequest): Promise<LLMInvocationResponse> {
    console.log('[LLMPipeline] Starting invocation:', {
      source: request.context.source,
      sourceId: request.context.sourceId,
      hasSchema: !!request.output.schema,
      hasAudio: !!request.media?.audio,
    });
    
    // Subscribe to state changes if callback provided
    let unsubscribe: (() => void) | undefined;
    if (request.stateTracking?.onStateChange) {
      unsubscribe = this.stateManager.subscribe(request.stateTracking.onStateChange);
    }
    
    try {
      // STAGE 1: Validation
      this.validateRequest(request);
      
      // STAGE 2: Preparation
      const prepared = this.prepareInvocation(request);
      
      // STAGE 3: Execution
      const result = await this.executeWithTracking(prepared, request);
      
      // STAGE 4: Post-processing
      return this.formatResponse(result, request);
      
    } catch (error) {
      console.error('[LLMPipeline] Invocation failed:', {
        source: request.context.source,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    } finally {
      unsubscribe?.();
      this.stateManager.reset();
    }
  }
  
  private validateRequest(request: LLMInvocationRequest): void {
    this.stateManager.setState({ status: 'validating', step: 'request' });
    
    if (!request.prompt?.trim()) {
      throw new InvocationError('Prompt cannot be empty', 'INVALID_REQUEST');
    }
    
    if (request.output.schema) {
      this.stateManager.setState({ status: 'validating', step: 'schema' });
      
      const validation = this.schemaValidator.validate(
        request.output.schema,
        request.context.source
      );
      
      // LENIENT: Log warnings but only fail on critical errors
      if (validation.warnings.length > 0) {
        console.warn('[LLMPipeline] Schema warnings:', validation.warnings);
      }
      
      if (!validation.valid) {
        // Still proceed, but log the issues
        console.error('[LLMPipeline] Schema validation failed (proceeding anyway):', 
          validation.errors);
      }
    }
    
    if (request.media?.audio) {
      this.stateManager.setState({ status: 'validating', step: 'media' });
      
      if (!request.media.audio.blob || !request.media.audio.mimeType) {
        throw new InvocationError('Invalid audio: missing blob or mimeType', 'INVALID_MEDIA');
      }
    }
  }
  
  private prepareInvocation(request: LLMInvocationRequest): PreparedInvocation {
    this.stateManager.setState({ status: 'preparing', step: 'timeout' });
    
    const timeoutMs = this.timeoutStrategy.calculateTimeout(request);
    
    console.log('[LLMPipeline] Using timeout:', timeoutMs, 'ms');
    
    // Create timeout-based abort controller
    const { controller, cleanup } = createAbortControllerWithTimeout(timeoutMs);
    
    // If external abort signal provided, link it to our controller
    if (request.config?.abortSignal) {
      const externalSignal = request.config.abortSignal;
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', () => {
          controller.abort();
        });
      }
    }
    
    this.stateManager.setState({ status: 'preparing', step: 'context' });
    
    return {
      prompt: request.prompt,
      schema: request.output.schema,
      audioBlob: request.media?.audio?.blob,
      audioMimeType: request.media?.audio?.mimeType,
      config: {
        ...request.config,
        timeoutMs,
      },
      abortController: controller,
      cleanup,
    };
  }
  
  private async executeWithTracking(
    prepared: PreparedInvocation,
    request: LLMInvocationRequest
  ): Promise<{ text: string; raw: unknown; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; durationMs: number }> {
    const startTime = Date.now();
    
    // Start progress tracking
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      this.stateManager.setState({
        status: 'executing',
        elapsedMs: elapsed,
        estimatedTotalMs: prepared.config.timeoutMs,
      });
      
      // Call user's progress callback
      request.stateTracking?.onProgress?.(elapsed);
    }, 1000);
    
    try {
      // Call the LLM provider
      let response;
      
      if (prepared.audioBlob && prepared.audioMimeType) {
        response = await this.provider.generateContentWithAudio(
          prepared.prompt,
          prepared.audioBlob,
          prepared.audioMimeType,
          {
            responseSchema: prepared.schema,
            temperature: prepared.config.temperature,
            maxOutputTokens: prepared.config.maxOutputTokens,
            topK: prepared.config.topK,
            topP: prepared.config.topP,
            abortSignal: prepared.abortController.signal,
          }
        );
      } else {
        response = await this.provider.generateContent(
          prepared.prompt,
          {
            responseSchema: prepared.schema,
            temperature: prepared.config.temperature,
            maxOutputTokens: prepared.config.maxOutputTokens,
            topK: prepared.config.topK,
            topP: prepared.config.topP,
            abortSignal: prepared.abortController.signal,
          }
        );
      }
      
      const durationMs = Date.now() - startTime;
      
      this.stateManager.setState({ status: 'completed', durationMs });
      
      return {
        text: response.text,
        raw: response.raw,
        usage: response.usage,
        durationMs,
      };
      
    } catch (error) {
      // Determine stage where failure occurred
      const stage = this.determineFailureStage(error);
      
      this.stateManager.setState({
        status: 'failed',
        error: error as Error,
        stage,
      });
      
      throw this.enhanceError(error, request, stage);
      
    } finally {
      clearInterval(progressInterval);
      prepared.cleanup();
    }
  }
  
  private determineFailureStage(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return 'timeout';
      }
      if (error.message.includes('network') || error.message.includes('fetch')) {
        return 'network';
      }
      if (error.message.includes('schema') || error.message.includes('parse')) {
        return 'parsing';
      }
    }
    return 'unknown';
  }
  
  private enhanceError(
    error: unknown,
    request: LLMInvocationRequest,
    stage: string
  ): Error {
    if (error instanceof Error) {
      const enhanced = new InvocationError(
        error.message,
        `LLM_${stage.toUpperCase()}`,
        {
          source: request.context.source,
          sourceId: request.context.sourceId,
          stage,
        }
      );
      enhanced.stack = error.stack;
      return enhanced;
    }
    return new InvocationError('Unknown error', 'LLM_UNKNOWN', { stage });
  }
  
  private formatResponse(
    result: { text: string; raw: unknown; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; durationMs: number },
    request: LLMInvocationRequest
  ): LLMInvocationResponse {
    let parsed: unknown | undefined;
    
    if (request.output.schema || request.output.format === 'json') {
      try {
        parsed = JSON.parse(result.text);
      } catch (error) {
        console.error('[LLMPipeline] Failed to parse JSON response:', error);
        // Don't throw - return text as-is
      }
    }
    
    return {
      output: {
        text: result.text,
        parsed,
        raw: result.raw,
      },
      execution: {
        durationMs: result.durationMs,
        tokenUsage: result.usage ? {
          prompt: result.usage.promptTokens,
          completion: result.usage.completionTokens,
          total: result.usage.totalTokens,
        } : undefined,
      },
      request: {
        source: request.context.source,
        sourceId: request.context.sourceId,
        hadSchema: !!request.output.schema,
        hadMedia: !!request.media,
      },
    };
  }
  
  cancel(): void {
    this.provider.cancel();
  }
}
