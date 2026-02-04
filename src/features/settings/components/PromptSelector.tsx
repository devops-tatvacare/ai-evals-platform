import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PromptDefinition } from '@/types';
import { cn } from '@/utils';

interface PromptSelectorProps {
  prompts: PromptDefinition[];
  selectedId: string | null;
  onSelect: (promptId: string) => void;
  label: string;
  disabled?: boolean;
}

export function PromptSelector({
  prompts,
  selectedId,
  onSelect,
  label,
  disabled,
}: PromptSelectorProps) {
  const selectedPrompt = useMemo(
    () => prompts.find(p => p.id === selectedId),
    [prompts, selectedId]
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const promptId = e.target.value;
    if (promptId) {
      onSelect(promptId);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <div className="relative">
        <select
          value={selectedId || ''}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            'w-full h-9 rounded-[6px] border px-3 pr-8 text-[13px] appearance-none cursor-pointer transition-colors',
            'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]',
            'hover:border-[var(--border-hover)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <option value="">Select prompt template...</option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name}
              {prompt.isDefault ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
      </div>
      {selectedPrompt?.description && (
        <p className="text-[11px] text-[var(--text-muted)]">
          {selectedPrompt.description}
        </p>
      )}
    </div>
  );
}
