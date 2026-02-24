import { useState, useMemo, useEffect } from 'react';
import { Search, X, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { useEvaluatorsStore } from '@/stores';
import { cn } from '@/utils';

interface RunAllOverlayProps {
  open: boolean;
  onClose: () => void;
  onRun: (evaluatorIds: string[]) => void;
}

export function RunAllOverlay({ open, onClose, onRun }: RunAllOverlayProps) {
  const evaluators = useEvaluatorsStore((s) => s.evaluators);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(evaluators.map(e => e.id)));
  const [search, setSearch] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  // Sync selection when overlay opens with new evaluator list
  const evaluatorIds = evaluators.map(e => e.id).join(',');
  const [lastIds, setLastIds] = useState(evaluatorIds);
  if (evaluatorIds !== lastIds) {
    setLastIds(evaluatorIds);
    setSelected(new Set(evaluators.map(e => e.id)));
  }

  // Slide-in animation
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setIsVisible(true));
    }
    return () => setIsVisible(false);
  }, [open]);

  // Escape key + body scroll lock
  useEffect(() => {
    if (open) {
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
  }, [open, onClose]);

  const filteredEvaluators = useMemo(() => {
    if (!search) return evaluators;
    const q = search.toLowerCase();
    return evaluators.filter(e =>
      e.name.toLowerCase().includes(q) || e.prompt.toLowerCase().includes(q)
    );
  }, [evaluators, search]);

  function handleSubmit() {
    if (selected.size === 0) return;
    onRun(Array.from(selected));
    onClose();
  }

  function toggleEvaluator(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(evaluators.map(e => e.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          'ml-auto relative z-10 h-full w-[var(--overlay-width-sm)] max-w-[85vw] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden',
          'flex flex-col',
          'transform transition-transform duration-300 ease-out',
          isVisible ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Run All Evaluators</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Select evaluators to run on this listing. They will execute in parallel.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search + select all/none */}
        <div className="shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search evaluators..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[6px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
            />
          </div>
          <button onClick={selectAll} className="text-xs text-[var(--text-brand)] hover:underline shrink-0">All</button>
          <button onClick={selectNone} className="text-xs text-[var(--text-muted)] hover:underline shrink-0">None</button>
        </div>

        {/* Evaluator list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
          {evaluators.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">No evaluators configured for this listing.</p>
          ) : filteredEvaluators.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">No evaluators match your search.</p>
          ) : (
            filteredEvaluators.map(ev => (
              <label
                key={ev.id}
                className={cn(
                  'flex items-start gap-2.5 p-3 rounded-lg cursor-pointer transition-colors',
                  selected.has(ev.id)
                    ? 'bg-[var(--surface-info)] border border-[var(--border-info)]'
                    : 'bg-[var(--bg-secondary)] border border-transparent hover:border-[var(--border-subtle)]'
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(ev.id)}
                  onChange={() => toggleEvaluator(ev.id)}
                  className="mt-0.5 rounded accent-[var(--interactive-primary)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{ev.name}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                    {ev.prompt.slice(0, 100)}{ev.prompt.length > 100 ? '...' : ''}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {ev.outputSchema?.length ?? 0} output field{(ev.outputSchema?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{selected.size} of {evaluators.length} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selected.size === 0}
              icon={PlayCircle}
            >
              Run {selected.size} Evaluator{selected.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
