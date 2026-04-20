import { cn } from '@/utils';

interface FilterPillOption {
  id: string;
  label: string;
}

interface FilterPillsProps {
  options: FilterPillOption[];
  active: string;
  onChange: (id: string) => void;
  /** `md` (default) = px-3 py-1.5 text-[13px]; `sm` = px-2.5 py-0.5 text-[11px]. */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<FilterPillsProps['size']>, string> = {
  md: 'px-3 py-1.5 text-[13px]',
  sm: 'px-2.5 py-0.5 text-[11px]',
};

export function FilterPills({ options, active, onChange, size = 'md', className }: FilterPillsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-full font-medium cursor-pointer transition-colors',
              SIZE_CLASSES[size],
              isActive
                ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)] border border-transparent'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
