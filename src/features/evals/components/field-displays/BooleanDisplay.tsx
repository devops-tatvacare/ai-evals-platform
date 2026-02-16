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
          <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
          <span className="text-sm font-medium text-[var(--color-success)]">
            Yes
          </span>
        </>
      ) : (
        <>
          <XCircle className="h-5 w-5 text-[var(--color-error)]" />
          <span className="text-sm font-medium text-[var(--color-error)]">
            No
          </span>
        </>
      )}
    </div>
  );
}
