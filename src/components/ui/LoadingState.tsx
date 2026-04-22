import { cn } from '@/utils';

interface LoadingStateProps {
  /** Message under the animation. Defaults to "Loading…". Pass empty string to hide. */
  message?: string;
  /** Fills the parent with min-h-full so content centers vertically. Default true. */
  fill?: boolean;
  className?: string;
}

/**
 * Unified loading surface — centered horizontally + vertically, animated brand
 * dots, optional message. Use this anywhere a page, panel, or tab is fetching
 * data. Replaces ad-hoc `<div>Loading...</div>` patterns across the platform.
 */
export function LoadingState({ message = 'Loading…', fill = true, className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        fill && 'min-h-full flex-1 py-12',
        className,
      )}
    >
      <div className="flex items-end gap-1.5" aria-label="Loading" role="status">
        <span
          className="h-2 w-2 rounded-full bg-[var(--color-brand-primary)] animate-bounce"
          style={{ animationDelay: '-0.3s', animationDuration: '1s' }}
        />
        <span
          className="h-2 w-2 rounded-full bg-[var(--color-brand-primary)] animate-bounce"
          style={{ animationDelay: '-0.15s', animationDuration: '1s' }}
        />
        <span
          className="h-2 w-2 rounded-full bg-[var(--color-brand-primary)] animate-bounce"
          style={{ animationDuration: '1s' }}
        />
      </div>
      {message && (
        <p className="text-xs text-[var(--text-muted)] tracking-wide">{message}</p>
      )}
    </div>
  );
}
