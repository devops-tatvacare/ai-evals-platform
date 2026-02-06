import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/utils';

interface BooleanDisplayProps {
  value: unknown;
  className?: string;
}

export function BooleanDisplay({ value, className }: BooleanDisplayProps) {
  if (value === null || value === undefined) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        —
      </div>
    );
  }

  const boolValue = Boolean(value);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {boolValue ? (
        <>
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Yes
          </span>
        </>
      ) : (
        <>
          <XCircle className="h-5 w-5 text-red-500" />
          <span className="text-sm font-medium text-red-600 dark:text-red-400">
            No
          </span>
        </>
      )}
    </div>
  );
}
