import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils';

interface ErrorFallbackProps {
  error?: Error;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}

export function ErrorFallback({ error, onRetry, title = 'Something went wrong', compact = false }: ErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'p-6' : 'min-h-[400px] p-12'
      )}
    >
      <div className={cn(
        'mb-4 flex items-center justify-center rounded-full bg-[var(--color-error-light)]',
        compact ? 'h-10 w-10' : 'h-16 w-16'
      )}>
        <AlertCircle className={cn('text-[var(--color-error)]', compact ? 'h-5 w-5' : 'h-8 w-8')} />
      </div>
      
      <h2 className={cn(
        'font-semibold text-[var(--text-primary)]',
        compact ? 'text-base' : 'text-lg'
      )}>
        {title}
      </h2>
      
      {error && (
        <p className={cn(
          'mt-2 text-[var(--text-secondary)]',
          compact ? 'text-[12px]' : 'text-[13px]'
        )}>
          {error.message}
        </p>
      )}
      
      {onRetry && (
        <Button
          variant="secondary"
          size={compact ? 'sm' : 'md'}
          onClick={onRetry}
          className="mt-4"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}
