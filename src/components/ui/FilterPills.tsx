import { cn } from '@/utils';

interface FilterPillOption {
  id: string;
  label: string;
}

interface FilterPillsProps {
  options: FilterPillOption[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function FilterPills({ options, active, onChange, className }: FilterPillsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] font-medium cursor-pointer transition-colors',
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
