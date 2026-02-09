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
const AUTH_TOKEN = 'ILtFcw+xtbuy8IgsBCSyD6nSpgZd5AOz7T+g3N8Tef/INZi+dxwPJhnBc2kfdq2eU8J2VKsvSof00ofiSh9HLEJR2nzQoUkw1tLch7hgkmB38aJp+72H2skaQ85Rbm4N/gl3/eyGz8izfuRHDWVjMrYfj4XFeTZN5lfCB7KV4PEwaw22IcNZQj3/s8rcY6w8PqgWIbuO9Q0aOxkF9ySbZy3cOvfrQvjsK11C0XT9ZcLxTpan7L9DB1bmwKx2mcyVm9PjSnKYFfoZpW/ddLfQYdUhGwpK11pvmLJvMBkWW7ZUEc5+GKmSzhsPWfmeajNDt93qEzEg/cwY7tfmvCzArg1OCsZdFouPC6R6Eket4KqGQwyD8eLZ7syS40weVvD7opTtb+pUXg5nntxVCe53fIL77hO1FZ4d+OCMElbk1M64JKBictSwjwG8lqWt1KLbta0mKn4Um4CLmWHjCNsUSnI2HEuZ0/tIXCVVWg/u9Qa1cBOioL4ZBlAytoZ8U2lOOm8PnsHnXARLK3ps9yGyfBUIjotxTZ0pDaq0NVWGOFTLafHPtOEzdfvUX2S1YtdM5WE5kxX4MwiV1zhAknOXYlaRYrZLzef1hwaDRmRnGFp/zPoEMf9ttel6UwWN9POayzkpG/jytEATiEDDY0vIPY44jatEvDdFsZZTo8Vap63qx9RhrFMYtqBx9ph2bbHsahXEavf8bnapcPhDPZyLkEfFP+Fe+/NjCSCkozUFNKaEk69Lx6wNjuLQK6uXeSh69kqvyvByTBRFLdtqqYLeQRbKADb5yRKDB7v9IyIo0MsK9CYccSejDgPIiuB5hPlNugJhuWsx398eLiYtfA6ESn4dCVD0ulqlOUSn4ql7oGpNV7jEi1z7iBBzf5UDQMHmiGgJ/9A+Zu/ZaOTHVREsFIp2baN31LYluNIaf4iMHfK2j8c9yYeQs+7vQzctpc9nNcUboUPeqrW/i+LicpyiWFllHKeHTZDWktXrwLxVOer3UWet7idZXYqj+ix0Vpc69vSLdVtOdC7JI6Z9szPOwhUjc9OlOhrFbDwBog99HzFlAVjb2aO2ez9SqBGSbet2nbtEQlqLYj0fyEwTgeEgLmVYdKGwWZNBLf+VtWVEifzAgSqJaV8ghaH9wm08WhmhJScAhQ15R7VDje+jC/ZC5sxunIDVw73euPUMkyIKbkPvP2ytfD1vdOQTyedIoPwmvU7A8BspbubNJ2nZOrDoWCltmbUPJxHiuwTPGi7xtf5TUH66LFQFb/e0bcVtS8oIHVlgNy8q341kqWT1H+e75QwGVDtunX15nP2ruAG5Etw=';

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
  user_id: string;
  session_id: string;
  context?: Record<string, unknown>;
  stream?: boolean;
  thread_id?: string;
  end_session: boolean;
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
      // Build request body with proper field order
      const requestBody: Record<string, unknown> = {
        query: params.query,
        user_id: params.user_id,
        session_id: params.session_id,
      };
      
      if (params.context) {
        requestBody.context = params.context;
      }
      
      requestBody.stream = params.stream ?? false;
      
      if (params.thread_id) {
        requestBody.thread_id = params.thread_id;
      }
      
      requestBody.end_session = params.end_session;

      console.log('[KairaChatService] Streaming request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'token': AUTH_TOKEN,
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
