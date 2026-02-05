/**
 * Types for LLM Invocation Pipeline
 * Single source of truth for all pipeline types
 */

export type InvocationSource = 
  | 'evaluator' 
  | 'voice-rx-eval' 
  | 'schema-gen' 
  | 'prompt-gen' 
  | 'structured-extraction' 
  | 'normalization';

export interface LLMInvocationRequest {
  prompt: string;
  
  context: {
    source: InvocationSource;
    sourceId: string;
    metadata?: Record<string, unknown>;
  };
  
  output: {
    schema?: Record<string, unknown>;
    format?: 'text' | 'json';
  };
  
  media?: {
    audio?: {
      blob: Blob;
      mimeType: string;
    };
  };
  
  config?: {
    temperature?: number;
    maxOutputTokens?: number;
    topK?: number;
    topP?: number;
    timeoutMs?: number;
    abortSignal?: AbortSignal; // External abort signal for cancellation
  };
  
  stateTracking?: {
    onProgress?: (elapsed: number) => void;
    onStateChange?: (state: InvocationState) => void;
  };
}

export type InvocationState = 
  | { status: 'validating'; step: 'request' | 'schema' | 'media' }
  | { status: 'preparing'; step: 'timeout' | 'context' }
  | { status: 'executing'; elapsedMs: number; estimatedTotalMs: number }
  | { status: 'completed'; durationMs: number }
  | { status: 'failed'; error: Error; stage: string };

export interface LLMInvocationResponse {
  output: {
    text: string;
    parsed?: unknown;
    raw: unknown;
  };
  
  execution: {
    durationMs: number;
    tokenUsage?: {
      prompt: number;
      completion: number;
      total: number;
    };
  };
  
  request: {
    source: string;
    sourceId: string;
    hadSchema: boolean;
    hadMedia: boolean;
  };
}

export class InvocationError extends Error {
  code: string;
  context?: Record<string, unknown>;
  
  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'InvocationError';
    this.code = code;
    this.context = context;
  }
}
