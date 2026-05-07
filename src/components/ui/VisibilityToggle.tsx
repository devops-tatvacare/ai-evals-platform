import { Lock, Share2 } from 'lucide-react';
import { cn } from '@/utils';
import type { AssetVisibility } from '@/types';

interface VisibilityToggleProps {
  value: AssetVisibility;
  onChange: (value: AssetVisibility) => void;
  disabled?: boolean;
  variant?: 'panel' | 'toolbar';
  iconOnly?: boolean;
}

const OPTIONS: Array<{
  value: AssetVisibility;
  label: string;
  icon: typeof Lock;
}> = [
  { value: 'private', label: 'Private', icon: Lock },
  { value: 'shared', label: 'Shared', icon: Share2 },
];

export function VisibilityToggle({
  value,
  onChange,
  disabled = false,
  variant = 'panel',
  iconOnly = false,
}: VisibilityToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center',
        variant === 'panel'
          ? 'rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1'
          : 'gap-1',
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            title={option.label}
            aria-label={option.label}
            className={cn(
              variant === 'panel'
                ? 'inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors'
                : 'inline-flex h-7 items-center justify-center gap-1.5 rounded-[6px] border px-2.5 text-[13px] font-medium transition-colors',
              variant === 'panel'
                ? (isActive
                    ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]')
                : (isActive
                    ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'),
              iconOnly && 'w-7 px-0',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {iconOnly ? <span className="sr-only">{option.label}</span> : option.label}
          </button>
        );
      })}
    </div>
  );
}
