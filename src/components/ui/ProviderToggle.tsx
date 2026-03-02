import type { LLMProvider } from '@/types';
import { providerIcons } from '@/components/ui/ModelBadge/providers';
import { cn } from '@/utils';

interface ProviderToggleProps {
  providers: { value: LLMProvider; label: string }[];
  value: LLMProvider;
  onChange: (v: LLMProvider) => void;
}

/**
 * Icons-only toggle when >2 providers, icon+label when <=2.
 * Shared across ReportTab, LLMConfigStep, and EvaluationOverlay.
 */
export function ProviderToggle({ providers, value, onChange }: ProviderToggleProps) {
  const iconOnly = providers.length > 2;

  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
      {providers.map((p) => {
        const isActive = value === p.value;
        return (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            title={p.label}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
              iconOnly ? 'flex-1 py-1.5 px-2' : 'py-1.5 px-3',
              isActive
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            )}
          >
            <img
              src={providerIcons[p.value]}
              alt={p.label}
              className={cn('h-4 w-4', p.value !== 'gemini' && 'provider-icon-invert')}
            />
            {!iconOnly && <span>{p.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
