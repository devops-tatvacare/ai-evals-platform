import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, Check, History } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
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
  const [isOpen, setIsOpen] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const selectedPrompt = useMemo(
    () => prompts.find(p => p.id === selectedId) || prompts[0],
    [prompts, selectedId]
  );

  const handleSelect = useCallback((promptId: string) => {
    onSelect(promptId);
    setIsOpen(false);
  }, [onSelect]);

  return (
    <>
      <div className="space-y-1.5">
        <label className="block text-[13px] font-medium text-[var(--text-primary)]">
          {label}
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setIsOpen(true)}
            disabled={disabled}
            className={cn(
              'flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-[6px] border text-[13px] transition-colors',
              'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]',
              'hover:border-[var(--border-hover)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span className="truncate">
              {selectedPrompt?.name || 'Select prompt...'}
            </span>
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          </button>
          
          {prompts.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowVersionHistory(true)}
              disabled={disabled}
              title="View version history"
              className="shrink-0"
            >
              <History className="h-4 w-4" />
            </Button>
          )}
        </div>
        {selectedPrompt?.description && (
          <p className="text-[11px] text-[var(--text-muted)]">
            {selectedPrompt.description}
          </p>
        )}
      </div>

      {/* Prompt Selection Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`Select ${label}`}
        className="max-w-2xl"
      >
        <div className="space-y-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              onClick={() => handleSelect(prompt.id)}
              className={cn(
                'w-full p-3 rounded-[var(--radius-default)] border text-left transition-colors',
                selectedId === prompt.id
                  ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/5'
                  : 'border-[var(--border-default)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {prompt.name}
                    </span>
                    {prompt.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        built-in
                      </span>
                    )}
                  </div>
                  {prompt.description && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">
                      {prompt.description}
                    </p>
                  )}
                </div>
                {selectedId === prompt.id && (
                  <Check className="h-4 w-4 text-[var(--color-brand-primary)] shrink-0" />
                )}
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {/* Version History Modal */}
      <Modal
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        title={`${label} - Version History`}
        className="max-w-3xl max-h-[80vh]"
      >
        <div className="space-y-3">
          <p className="text-[13px] text-[var(--text-secondary)]">
            {prompts.length} version{prompts.length !== 1 ? 's' : ''} available
          </p>
          {prompts.map((prompt, index) => (
            <div
              key={prompt.id}
              className={cn(
                'p-4 rounded-[var(--radius-default)] border',
                selectedId === prompt.id
                  ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/5'
                  : 'border-[var(--border-default)]'
              )}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {prompt.name}
                  </span>
                  {prompt.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                      built-in
                    </span>
                  )}
                  {selectedId === prompt.id && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)]">
                      <Check className="h-3 w-3" />
                      selected
                    </span>
                  )}
                  {index === 0 && !prompt.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]">
                      latest
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={selectedId === prompt.id ? 'secondary' : 'primary'}
                  onClick={() => handleSelect(prompt.id)}
                  disabled={selectedId === prompt.id}
                >
                  {selectedId === prompt.id ? 'Selected' : 'Use This'}
                </Button>
              </div>
              {prompt.description && (
                <p className="text-[11px] text-[var(--text-muted)] mb-2">
                  {prompt.description}
                </p>
              )}
              <div className="max-h-48 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                <pre className="text-[10px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                  {prompt.prompt.length > 500 
                    ? prompt.prompt.substring(0, 500) + '...' 
                    : prompt.prompt}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
