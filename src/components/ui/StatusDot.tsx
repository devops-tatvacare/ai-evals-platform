import { cn } from '@/utils';

type StatusDotStatus = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'running';
export type { StatusDotStatus };

interface StatusDotProps {
  status: StatusDotStatus;
  size?: 'sm' | 'md';
  pulse?: boolean;
  label?: string;
  className?: string;
}

const statusColors: Record<StatusDotStatus, string> = {
  success: 'bg-[var(--color-success)]',
  error: 'bg-[var(--color-error)]',
  warning: 'bg-[var(--color-warning)]',
  info: 'bg-[var(--color-info)]',
  neutral: 'bg-[var(--text-muted)]',
  running: 'bg-[var(--color-info)]',
};

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

export function StatusDot({ status, size = 'sm', pulse, label, className }: StatusDotProps) {
  const shouldPulse = pulse ?? status === 'running';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'shrink-0 rounded-full',
          statusColors[status],
          sizeStyles[size],
          shouldPulse && 'animate-pulse'
        )}
      />
      {label && (
        <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      )}
    </span>
  );
}
