import { Star } from 'lucide-react';
import { cn } from '@/utils';

interface StarToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}

export function StarToggle({
  checked,
  onChange,
  disabled = false,
  title = 'Mark as main metric',
}: StarToggleProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[6px] border transition-colors',
        checked
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
          : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--color-warning)]',
      )}
    >
      <Star className={cn('h-4 w-4', checked && 'fill-current')} />
    </button>
  );
}
