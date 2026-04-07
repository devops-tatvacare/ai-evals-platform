import { useMemo } from 'react';
import type { PromptDefinition } from '@/types';
import { Select } from '@/components/ui';

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

  const promptOptions = useMemo(
    () => prompts.map((prompt) => ({
      value: prompt.id,
      label: prompt.name + (prompt.isDefault ? ' (built-in)' : ''),
    })),
    [prompts]
  );

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <div>
        <Select
          value={selectedId || ''}
          onChange={(val) => { if (val) onSelect(val); }}
          options={promptOptions}
          placeholder="Select prompt template..."
          disabled={disabled}
        />
      </div>
      {selectedPrompt?.description && (
        <p className="text-[11px] text-[var(--text-muted)]">
          {selectedPrompt.description}
        </p>
      )}
    </div>
  );
}
