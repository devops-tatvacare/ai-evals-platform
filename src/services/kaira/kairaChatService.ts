/**
 * Kaira Chat Service
 * API client for interacting with the Kaira AI Orchestrator (new /api/chat endpoint)
 */

import type { KairaStreamChunk } from '@/types';
import { parseSSEStream, createAbortControllerWithTimeout } from '@/utils/streamParser';
import { logger } from '@/services/logger';
import { useAppSettingsStore } from '@/stores/appSettingsStore';

const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

function getKairaConfig() {
  const settings = useAppSettingsStore.getState().settings['kaira-bot'];
  if (!settings.kairaApiUrl) {
    throw new KairaChatServiceError('Kaira API URL is not configured. Go to Settings > AI Configuration to set it.');
  }
  if (!settings.kairaAuthToken) {
    throw new KairaChatServiceError('Kaira Auth Token is not configured. Go to Settings > AI Configuration to set it.');
  }
  return {
    baseUrl: settings.kairaApiUrl,
    authToken: settings.kairaAuthToken,
  };
}

export interface StreamMessageParams {
  message: string;
  user_id: string;
  new_session: boolean;
  session_id?: string;   // omit on first turn
  image_id?: string;
  timezone?: string;
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
   * Send a message with streaming response via SSE.
   * Returns an async generator that yields stream chunks.
   */
  async *streamMessage(
    params: StreamMessageParams,
    abortSignal?: AbortSignal
  ): AsyncGenerator<KairaStreamChunk> {
    const { controller, cleanup } = createAbortControllerWithTimeout(DEFAULT_TIMEOUT_MS);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        controller.abort(abortSignal.reason);
      });
    }

    try {
      const requestBody: Record<string, unknown> = {
        message: params.message,
        user_id: params.user_id,
        new_session: params.new_session,
        timezone: params.timezone ?? 'Asia/Kolkata',
      };

      if (!params.new_session && params.session_id) {
        requestBody.session_id = params.session_id;
      }

      if (params.image_id) {
        requestBody.image_id = params.image_id;
      }

      logger.debug('[KairaChatService] Streaming request', { body: requestBody });

      const { baseUrl, authToken } = getKairaConfig();
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'token': authToken,
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

      for await (const chunk of parseSSEStream(response)) {
        yield chunk;
      }

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
};

export { KairaChatServiceError };
