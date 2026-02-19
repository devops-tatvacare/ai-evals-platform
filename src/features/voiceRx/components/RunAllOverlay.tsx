import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useEvaluatorsStore } from '@/stores';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';

interface RunAllOverlayProps {
  listingId: string;
  appId: string;
  open: boolean;
  onClose: () => void;
}

export function RunAllOverlay({ listingId, appId, open, onClose }: RunAllOverlayProps) {
  const evaluators = useEvaluatorsStore((s) => s.evaluators);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(evaluators.map(e => e.id)));
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  // Sync selection when overlay opens with new evaluator list
  const evaluatorIds = evaluators.map(e => e.id).join(',');
  const [lastIds, setLastIds] = useState(evaluatorIds);
  if (evaluatorIds !== lastIds) {
    setLastIds(evaluatorIds);
    setSelected(new Set(evaluators.map(e => e.id)));
  }

  const filteredEvaluators = useMemo(() => {
    if (!search) return evaluators;
    const q = search.toLowerCase();
    return evaluators.filter(e =>
      e.name.toLowerCase().includes(q) || e.prompt.toLowerCase().includes(q)
    );
  }, [evaluators, search]);

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);

    try {
      await jobsApi.submit('evaluate-custom-batch', {
        evaluator_ids: Array.from(selected),
        listing_id: listingId,
        app_id: appId,
        parallel: true,
      });

      notificationService.success(`Running ${selected.size} evaluator${selected.size !== 1 ? 's' : ''}...`);
      onClose();
    } catch (e) {
      notificationService.error(`Failed to start evaluators: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Run All Evaluators</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Select evaluators to run on this listing. They will execute in parallel.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + select all/none */}
        <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search evaluators..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
            />
          </div>
          <button onClick={selectAll} className="text-xs text-[var(--text-brand)] hover:underline shrink-0">All</button>
          <button onClick={selectNone} className="text-xs text-[var(--text-muted)] hover:underline shrink-0">None</button>
        </div>

        {/* Evaluator list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
          {evaluators.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">No evaluators configured for this listing.</p>
          ) : filteredEvaluators.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">No evaluators match your search.</p>
          ) : (
            filteredEvaluators.map(ev => (
              <label
                key={ev.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-md cursor-pointer transition-colors ${
                  selected.has(ev.id)
                    ? 'bg-[var(--surface-info)] border border-[var(--border-info)]'
                    : 'bg-[var(--bg-secondary)] border border-transparent hover:border-[var(--border-subtle)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(ev.id)}
                  onChange={() => toggleEvaluator(ev.id)}
                  className="mt-0.5 rounded accent-[var(--color-brand-accent)]"
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
        <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{selected.size} of {evaluators.length} selected</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={selected.size === 0 || submitting}
              className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--color-brand-accent)] rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Starting...' : `Run ${selected.size} Evaluator${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
