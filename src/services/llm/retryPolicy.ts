import type { ErrorCode } from '@/types';
import type { RetryConfig } from '@/types';
import { notificationService } from '@/services/notifications';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
  retryableErrors: ['LLM_RATE_LIMITED', 'LLM_NETWORK_ERROR', 'LLM_TIMEOUT'],
};

export interface RetryableError extends Error {
  code?: ErrorCode;
  retryable?: boolean;
}

function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error instanceof Error) {
    const retryError = error as RetryableError;
    // Check if explicitly marked as retryable
    if (retryError.retryable === false) return false;
    if (retryError.retryable === true) return true;
    // Check error code
    if (retryError.code && config.retryableErrors.includes(retryError.code)) {
      return true;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.multiplier, attempt);
  return Math.min(exponentialDelay, config.maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (!isRetryableError(error, finalConfig)) {
        throw lastError;
      }

      if (attempt < finalConfig.maxAttempts - 1) {
        const retryDelay = calculateDelay(attempt, finalConfig);
        const retryError = error as RetryableError;
        const errorType = retryError.code || 'error';
        
        notificationService.warning(
          `${errorType}: Retrying in ${Math.round(retryDelay / 1000)}s... (attempt ${attempt + 2}/${finalConfig.maxAttempts})`,
          'Retrying request'
        );
        
        await delay(retryDelay);
      }
    }
  }

  throw lastError;
}

export function createRetryableError(
  message: string,
  code: ErrorCode,
  retryable = true
): RetryableError {
  const error = new Error(message) as RetryableError;
  error.code = code;
  error.retryable = retryable;
  return error;
}
