/**
 * Kaira Chat Service
 * API client for interacting with the Kaira AI Orchestrator
 */

import type {
  KairaChatRequest,
  KairaChatResponse,
  KairaStreamChunk,
} from '@/types';
import { parseSSEStream, createAbortControllerWithTimeout } from '@/utils/streamParser';

const BASE_URL = 'https://mytatva-ai-orchestrator-prod.goodflip.in';
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

export interface SendMessageParams {
  query: string;
  userId: string;
  threadId?: string;             // Only sent after first response
  sessionId?: string;            // Only sent after first response
  context?: Record<string, unknown>;
  endSession?: boolean;
}

export interface StreamMessageParams {
  query: string;
  userId: string;
  threadId?: string;             // Only sent after first response
  sessionId?: string;            // Only sent after first response
  context?: Record<string, unknown>;
  endSession?: boolean;
}

class KairaChatServiceError extends Error {
  public statusCode?: number;
  public responseBody?: string;
  
  constructor(
    message: string,
    statusCode?: number,
    responseBody?: string
  ) {
    super(message);
    this.name = 'KairaChatServiceError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export const kairaChatService = {
  /**
   * Send a message (non-streaming)
   * Returns the complete response
   */
  async sendMessage(params: SendMessageParams): Promise<KairaChatResponse> {
    const { controller, cleanup } = createAbortControllerWithTimeout(DEFAULT_TIMEOUT_MS);

    try {
      const requestBody: KairaChatRequest = {
        query: params.query,
        user_id: params.userId,
        ...(params.threadId && { thread_id: params.threadId }),
        ...(params.sessionId && { session_id: params.sessionId }),
        ...(params.endSession !== undefined && { end_session: params.endSession }),
        ...(params.context && { context: params.context }),
      };

      const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      cleanup();

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        throw new KairaChatServiceError(
          `Chat request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      const data = await response.json() as KairaChatResponse;
      return data;
    } catch (error) {
      cleanup();
      
      if (error instanceof KairaChatServiceError) {
        throw error;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new KairaChatServiceError('Request was cancelled');
        }
        throw new KairaChatServiceError(error.message);
      }
      
      throw new KairaChatServiceError('Unknown error occurred');
    }
  },

  /**
   * Send a message with streaming response
   * Returns an async generator that yields stream chunks
   */
  async *streamMessage(
    params: StreamMessageParams,
    abortSignal?: AbortSignal
  ): AsyncGenerator<KairaStreamChunk> {
    const { controller, cleanup } = createAbortControllerWithTimeout(DEFAULT_TIMEOUT_MS);

    // If an external abort signal is provided, link it
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        controller.abort(abortSignal.reason);
      });
    }

    try {
      const requestBody = {
        query: params.query,
        user_id: params.userId,
        ...(params.threadId && { thread_id: params.threadId }),
        ...(params.sessionId && { session_id: params.sessionId }),
        ...(params.context && { context: params.context }),
        ...(params.endSession !== undefined && { end_session: params.endSession }),
      };

      console.log('[KairaChatService] Streaming request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        cleanup();
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        throw new KairaChatServiceError(
          `Stream request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      // Yield chunks from the SSE stream
      for await (const chunk of parseSSEStream(response)) {
        yield chunk;
      }
      
      // Clean up timeout only after stream completes successfully
      cleanup();
    } catch (error) {
      cleanup();
      
      if (error instanceof KairaChatServiceError) {
        throw error;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new KairaChatServiceError('Stream was cancelled or timed out');
        }
        throw new KairaChatServiceError(error.message);
      }
      
      throw new KairaChatServiceError('Unknown error occurred during streaming');
    }
  },

  /**
   * End a chat session explicitly
   */
  async endSession(userId: string, threadId: string): Promise<void> {
    try {
      const response = await fetch(`${BASE_URL}/session/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          thread_id: threadId,
        }),
      });

      if (!response.ok) {
        console.warn(`Failed to end session: ${response.status}`);
      }
    } catch (error) {
      // Log but don't throw - ending session is not critical
      console.warn('Error ending session:', error);
    }
  },
};

export { KairaChatServiceError };
