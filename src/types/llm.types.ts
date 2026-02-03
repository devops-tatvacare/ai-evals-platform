export type LLMRequestStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type EvaluationCallNumber = 1 | 2;
export type EvaluationStage = 'preparing' | 'normalizing' | 'transcribing' | 'critiquing' | 'comparing' | 'complete' | 'failed';

export interface LLMMessage {
  role: 'user' | 'model';
  content: string;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxOutputTokens?: number;
  topK?: number;
  topP?: number;
  responseSchema?: Record<string, unknown>;
  responseMimeType?: string;
}

export interface LLMResponse {
  text: string;
  raw?: unknown;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ILLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generateContent(
    prompt: string,
    options?: LLMGenerateOptions
  ): Promise<LLMResponse>;
  generateContentWithAudio(
    prompt: string,
    audioBlob: Blob,
    mimeType: string,
    options?: LLMGenerateOptions
  ): Promise<LLMResponse>;
  cancel(): void;
}

export interface LLMTask {
  id: string;
  listingId: string;
  type: 'structured_output' | 'ai_eval';
  status: LLMRequestStatus;
  prompt?: string;
  inputSource?: 'transcript' | 'audio' | 'both';
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  // Evaluation-specific tracking
  callNumber?: EvaluationCallNumber;
  stage?: EvaluationStage;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  multiplier: number;
  retryableErrors: string[];
}
