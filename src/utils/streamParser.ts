/**
 * Stream Parser Utility
 * Parse Server-Sent Events (SSE) style streams from Kaira API
 */

import type { KairaStreamChunk } from '@/types';

/**
 * Check if a line contains valid JSON data (not just a number or empty)
 */
function isValidJsonData(jsonStr: string): boolean {
  const trimmed = jsonStr.trim();
  // Filter out empty strings, lone numbers (like "0"), and other non-object data
  if (!trimmed || /^\d+$/.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Parse SSE-style "data: {...}" lines from a fetch Response
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<KairaStreamChunk> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip empty lines
        if (!trimmedLine) continue;
        
        // Check for stream end marker
        if (trimmedLine === 'data: [DONE]') {
          return;
        }
        
        // Parse SSE data lines
        if (trimmedLine.startsWith('data: ')) {
          const jsonStr = trimmedLine.slice(6);
          
          // Skip invalid JSON data (empty, lone numbers like "0")
          if (!isValidJsonData(jsonStr)) {
            continue;
          }
          
          try {
            const chunk = JSON.parse(jsonStr) as KairaStreamChunk;
            yield chunk;
          } catch (parseError) {
            console.warn('Failed to parse SSE chunk:', jsonStr, parseError);
          }
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      const trimmedLine = buffer.trim();
      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
        const jsonStr = trimmedLine.slice(6);
        
        // Skip invalid JSON data
        if (isValidJsonData(jsonStr)) {
          try {
            const chunk = JSON.parse(jsonStr) as KairaStreamChunk;
            yield chunk;
          } catch (parseError) {
            console.warn('Failed to parse final SSE chunk:', jsonStr, parseError);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Create an AbortController with timeout
 */
export function createAbortControllerWithTimeout(timeoutMs: number): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Request timeout'));
  }, timeoutMs);

  return {
    controller,
    timeoutId,
    cleanup: () => clearTimeout(timeoutId),
  };
}
