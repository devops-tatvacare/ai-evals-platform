import { useState, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import { cn } from '@/utils';
import { Input } from '@/components/ui';

export type ThreadScope = 'all' | 'sample' | 'specific';

interface ThreadScopeStepProps {
  scope: ThreadScope;
  sampleSize: number;
  selectedThreadIds: string[];
  availableThreadIds: string[];
  onScopeChange: (scope: ThreadScope) => void;
  onSampleSizeChange: (size: number) => void;
  onSelectedThreadsChange: (ids: string[]) => void;
}

const SCOPE_OPTIONS: { value: ThreadScope; label: string; description: string }[] = [
  { value: 'all', label: 'All threads', description: 'Evaluate every thread in the CSV' },
  { value: 'sample', label: 'Random sample', description: 'Evaluate a random subset of threads' },
  { value: 'specific', label: 'Specific threads', description: 'Select individual threads to evaluate' },
];

export function ThreadScopeStep({
  scope,
  sampleSize,
  selectedThreadIds,
  availableThreadIds,
  onScopeChange,
  onSampleSizeChange,
  onSelectedThreadsChange,
}: ThreadScopeStepProps) {
  const [threadSearch, setThreadSearch] = useState('');

  const filteredThreadIds = useMemo(() => {
    if (!threadSearch) return availableThreadIds;
    const q = threadSearch.toLowerCase();
    return availableThreadIds.filter((id) => id.toLowerCase().includes(q));
  }, [availableThreadIds, threadSearch]);

  const toggleThread = (id: string) => {
    if (selectedThreadIds.includes(id)) {
      onSelectedThreadsChange(selectedThreadIds.filter((t) => t !== id));
    } else {
      onSelectedThreadsChange([...selectedThreadIds, id]);
    }
  };

  const toggleAll = () => {
    if (selectedThreadIds.length === filteredThreadIds.length) {
      onSelectedThreadsChange([]);
    } else {
      onSelectedThreadsChange([...filteredThreadIds]);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-2">
          Thread Selection
        </label>

        {/* Radio group */}
        <div className="space-y-2">
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex items-start gap-3 px-3 py-2.5 rounded-[6px] border cursor-pointer transition-colors',
                scope === opt.value
                  ? 'border-[var(--interactive-primary)] bg-[var(--color-brand-accent)]/5'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <input
                type="radio"
                name="threadScope"
                value={opt.value}
                checked={scope === opt.value}
                onChange={() => onScopeChange(opt.value)}
                className="mt-0.5 accent-[var(--interactive-primary)]"
              />
              <div>
                <span className="text-[13px] font-medium text-[var(--text-primary)]">{opt.label}</span>
                <p className="text-[11px] text-[var(--text-muted)]">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Sample size input */}
      {scope === 'sample' && (
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
            Sample Size
          </label>
          <Input
            type="number"
            min={1}
            max={availableThreadIds.length}
            value={sampleSize}
            onChange={(e) => onSampleSizeChange(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {availableThreadIds.length} threads available
          </p>
        </div>
      )}

      {/* Thread multi-select */}
      {scope === 'specific' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[var(--text-primary)]">
              Select Threads
            </label>
            <span className="text-[11px] text-[var(--text-muted)]">
              {selectedThreadIds.length} of {availableThreadIds.length} selected
            </span>
          </div>

          {/* Search */}
          <Input
            icon={<Search className="h-4 w-4" />}
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Search thread IDs..."
            className="mb-2"
          />

          {/* Select all toggle */}
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-[var(--text-brand)] hover:underline mb-1.5"
          >
            {selectedThreadIds.length === filteredThreadIds.length ? 'Deselect all' : 'Select all'}
          </button>

          {/* Thread list */}
          <div className="max-h-48 overflow-y-auto rounded-[6px] border border-[var(--border-subtle)]">
            {filteredThreadIds.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-[var(--text-muted)]">
                No threads found
              </p>
            ) : (
              filteredThreadIds.map((id) => {
                const isSelected = selectedThreadIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleThread(id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
                      'hover:bg-[var(--interactive-secondary)]',
                      isSelected && 'bg-[var(--color-brand-accent)]/5'
                    )}
                  >
                    <div
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                        isSelected
                          ? 'bg-[var(--interactive-primary)] border-[var(--interactive-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-primary)]'
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-[var(--text-on-color)]" />}
                    </div>
                    <span className="text-[var(--text-primary)] truncate font-mono text-[12px]">{id}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
