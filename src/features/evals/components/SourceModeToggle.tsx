import { cn } from '@/utils';

export type SourceMode = 'template' | 'custom';

interface SourceModeToggleProps {
  value: SourceMode;
  onChange: (mode: SourceMode) => void;
}

export function SourceModeToggle({ value, onChange }: SourceModeToggleProps) {
  const options: SourceMode[] = ['template', 'custom'];

  return (
    <div className="inline-flex rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
            value === option
              ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          {option === 'template' ? 'Use Template' : 'Write Custom'}
        </button>
      ))}
    </div>
  );
}
