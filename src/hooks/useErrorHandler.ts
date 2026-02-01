import { useCallback } from 'react';
import { useUIStore } from '@/stores';
import { handleError, createAppError } from '@/services/errors';
import { notificationService } from '@/services/notifications';
import type { AppError, ErrorCode } from '@/types';

export function useErrorHandler() {
  const addError = useUIStore((state) => state.addError);

  const handleAndNotify = useCallback((error: unknown): AppError => {
    const appError = handleError(error);
    addError(appError);
    
    if (appError.severity === 'error' || appError.severity === 'critical') {
      notificationService.error(appError.message);
    } else if (appError.severity === 'warning') {
      notificationService.warning(appError.message);
    }
    
    return appError;
  }, [addError]);

  const createAndNotify = useCallback((
    code: ErrorCode,
    options?: Parameters<typeof createAppError>[1]
  ): AppError => {
    const appError = createAppError(code, options);
    addError(appError);
    notificationService.error(appError.message);
    return appError;
  }, [addError]);

  return {
    handleError: handleAndNotify,
    createError: createAndNotify,
  };
}
