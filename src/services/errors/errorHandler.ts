import type { AppError, ErrorCode, ErrorSeverity } from '@/types';
import { ERROR_MESSAGES } from '@/types';
import { generateId } from '@/utils';
import { logger } from '@/services/logger';

export function createAppError(
  code: ErrorCode,
  options?: {
    message?: string;
    severity?: ErrorSeverity;
    context?: Record<string, unknown>;
    recoverable?: boolean;
    action?: AppError['action'];
  }
): AppError {
  return {
    id: generateId(),
    code,
    message: options?.message ?? ERROR_MESSAGES[code],
    severity: options?.severity ?? getSeverityForCode(code),
    timestamp: new Date(),
    context: options?.context,
    recoverable: options?.recoverable ?? isRecoverableCode(code),
    action: options?.action,
  };
}

function getSeverityForCode(code: ErrorCode): ErrorSeverity {
  if (code.startsWith('STORAGE_MIGRATION') || code === 'UNKNOWN_ERROR') {
    return 'critical';
  }
  if (code.includes('FAILED') || code.includes('INVALID')) {
    return 'error';
  }
  if (code.includes('EXCEEDED') || code.includes('LIMITED')) {
    return 'warning';
  }
  return 'info';
}

function isRecoverableCode(code: ErrorCode): boolean {
  const nonRecoverable: ErrorCode[] = [
    'STORAGE_MIGRATION_FAILED',
    'FILE_CORRUPTED',
  ];
  return !nonRecoverable.includes(code);
}

export function handleError(error: unknown): AppError {
  if (isAppError(error)) {
    logger.error(error.message, { code: error.code, ...error.context });
    return error;
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  const appError = createAppError('UNKNOWN_ERROR', {
    message,
    context: { originalError: error },
  });
  
  logger.error(message, { originalError: error });
  return appError;
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'severity' in error
  );
}
