import { cn } from '@/utils';

interface TextDisplayProps {
  value: unknown;
  className?: string;
}

export function TextDisplay({ value, className }: TextDisplayProps) {
  if (value === null || value === undefined) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        —
      </div>
    );
  }

  const text = String(value);

  if (text.length === 0) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        (empty)
      </div>
    );
  }

  return (
    <div className={cn('text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap', className)}>
      {text}
    </div>
  );
}
