/**
 * BatchCustomEvaluatorPicker — overlay for selecting custom evaluators to include in batch eval.
 *
 * Loads kaira-bot registry evaluators and allows multi-select with checkboxes.
 */

import { useState, useEffect } from 'react';
import { X, Search, Library, Check, Eye } from 'lucide-react';
import { Button, Input, EmptyState } from '@/components/ui';
import { evaluatorsRepository } from '@/services/storage';
import { cn } from '@/utils';
import { EvaluatorPreviewOverlay } from './EvaluatorPreviewOverlay';
import type { EvaluatorDefinition } from '@/types';

interface BatchCustomEvaluatorPickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function BatchCustomEvaluatorPicker({
  isOpen,
  onClose,
  selectedIds,
  onSelectionChange,
}: BatchCustomEvaluatorPickerProps) {
  const [search, setSearch] = useState('');
  const [evaluators, setEvaluators] = useState<EvaluatorDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selectedIds));
  const [previewEvaluator, setPreviewEvaluator] = useState<EvaluatorDefinition | null>(null);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
      setLocalSelected(new Set(selectedIds));
    } else {
      setIsVisible(false);
    }
  }, [isOpen, selectedIds]);

  useEffect(() => {
    if (isOpen) {
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      evaluatorsRepository.getRegistry('kaira-bot').then(list => {
        setEvaluators(list);
        setLoading(false);
      });
    }
  }, [isOpen]);

  const filtered = evaluators.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    onSelectionChange(Array.from(localSelected));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0"
        )}
      />

      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[500px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Custom Evaluators
          </h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search evaluators..."
              className="pl-10"
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Select custom evaluators from the registry to run alongside default evaluators.
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand-accent)] border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={search ? Search : Library}
              title={search ? 'No matching evaluators' : 'No registry evaluators'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Create evaluators in the Kaira Bot Evaluators tab and add them to the registry first.'
              }
              className="w-full"
            />
          ) : (
            <div className="space-y-2">
              {filtered.map(evaluator => {
                const isSelected = localSelected.has(evaluator.id);
                return (
                  <button
                    key={evaluator.id}
                    onClick={() => toggle(evaluator.id)}
                    className={cn(
                      "w-full text-left border rounded-lg p-4 transition-colors",
                      isSelected
                        ? "border-[var(--interactive-primary)] bg-[var(--color-brand-accent)]/5"
                        : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--color-brand-accent)]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "mt-0.5 shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors",
                        isSelected
                          ? "bg-[var(--interactive-primary)] border-[var(--interactive-primary)]"
                          : "border-[var(--border-default)]"
                      )}>
                        {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-[var(--text-primary)] truncate">
                          {evaluator.name}
                        </h3>
                        <p className="text-sm text-[var(--text-muted)] mt-1 line-clamp-2">
                          {evaluator.prompt.slice(0, 150)}...
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                            <span>{evaluator.outputSchema.length} output field(s)</span>
                            <span>{evaluator.modelId}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewEvaluator(evaluator);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--color-brand-accent)] transition-colors"
                          >
                            <Eye className="h-3 w-3" />
                            View
                          </button>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <span className="text-sm text-[var(--text-muted)]">
            {localSelected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleApply}>Apply</Button>
          </div>
        </div>
      </div>

      <EvaluatorPreviewOverlay
        isOpen={!!previewEvaluator}
        onClose={() => setPreviewEvaluator(null)}
        evaluator={previewEvaluator}
      />
    </div>
  );
}
