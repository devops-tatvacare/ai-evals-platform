/**
 * SelectCallsStep — wizard step 2 for inside-sales eval wizard.
 *
 * Reads from the synced source mirror via the same routes as the listing
 * page. No date-range scoping: the user picks calls from the full
 * synced history, paginated server-side.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, Check, Info, Filter, X } from 'lucide-react';
import { fetchCalls, fetchCallsForSelection } from '@/services/api/insideSales';
import { Input, Button } from '@/components/ui';
import type { CallFilters, CallRecord } from '@/services/api/insideSales';
import { formatDuration } from '@/utils/formatters';
import { cn } from '@/utils';
import { CallFilterPanel } from '@/features/crmWorkspace/components/CallFilterPanel';

export interface CallSelectionConfig {
  // Filter dimensions — must mirror CallFilters so the shared CallFilterPanel can drive it.
  agents: string[];
  leadId: string[];
  direction: string;
  status: string;
  durationMin: string;
  durationMax: string;
  hasRecording: boolean;
  eventCodes: string;
  // Eval-specific modifiers
  selectionMode: 'all' | 'sample' | 'specific';
  sampleSize: number;
  selectedCallIds: string[];
  skipEvaluated: boolean;
  minDuration: boolean;
}

interface SelectCallsStepProps {
  config: CallSelectionConfig;
  onConfigChange: (updates: Partial<CallSelectionConfig>) => void;
  previewCalls: CallRecord[];
  matchingCount: number;
  onPreviewLoaded: (calls: CallRecord[], total: number) => void;
}

const SCOPE_OPTIONS: { value: CallSelectionConfig['selectionMode']; label: string; description: string }[] = [
  { value: 'all', label: 'All calls', description: 'Evaluate every call matching the filters' },
  { value: 'sample', label: 'Random sample', description: 'Evaluate a random subset of matching calls' },
  { value: 'specific', label: 'Specific calls', description: 'Select individual calls to evaluate' },
];

function activeFilterCount(config: CallSelectionConfig): number {
  return [
    config.agents.length ? 'y' : '',
    config.leadId.length ? 'y' : '',
    config.direction,
    config.status,
    config.durationMin,
    config.durationMax,
    config.hasRecording ? 'y' : '',
    config.eventCodes,
  ].filter(Boolean).length;
}

// ── Main component ─────────────────────────────────────────────────────────

export function SelectCallsStep({
  config,
  onConfigChange,
  matchingCount,
  onPreviewLoaded,
}: SelectCallsStepProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [allCalls, setAllCalls] = useState<CallRecord[]>([]);
  const [callSearch, setCallSearch] = useState('');
  const [sampleSizeLocal, setSampleSizeLocal] = useState<string | null>(null);
  const [sampleSizeError, setSampleSizeError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const callFilters = useMemo<CallFilters>(() => ({
    agents: config.agents,
    leadId: config.leadId,
    direction: config.direction,
    status: config.status,
    hasRecording: config.hasRecording,
    eventCodes: config.eventCodes,
    durationMin: config.durationMin,
    durationMax: config.durationMax,
  }), [
    config.agents,
    config.leadId,
    config.direction,
    config.status,
    config.hasRecording,
    config.eventCodes,
    config.durationMin,
    config.durationMax,
  ]);

  const handleFilterReset = useCallback(() => {
    onConfigChange({
      agents: [],
      leadId: [],
      direction: '',
      status: '',
      durationMin: '',
      durationMax: '',
      hasRecording: false,
      eventCodes: '',
    });
  }, [onConfigChange]);

  // Fetch preview (first 5) for stats + preview table
  const fetchPreview = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchCalls(callFilters, 1, 5);
      onPreviewLoaded(data.calls, data.total);
    } catch {
      onPreviewLoaded([], 0);
    } finally {
      setIsLoading(false);
    }
  }, [callFilters, onPreviewLoaded]);

  useEffect(() => {
    const timer = setTimeout(fetchPreview, 300);
    return () => clearTimeout(timer);
  }, [fetchPreview]);

  // Fetch all calls for specific mode (debounced with preview so we avoid redundant requests)
  useEffect(() => {
    if (config.selectionMode !== 'specific') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchCallsForSelection(callFilters, 500);
        if (!cancelled) setAllCalls(data.calls);
      } catch {
        if (!cancelled) setAllCalls([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [config.selectionMode, callFilters]);

  const filteredCalls = useMemo(() => {
    if (!callSearch) return allCalls;
    const q = callSearch.toLowerCase();
    return allCalls.filter(
      (c) =>
        c.repName.toLowerCase().includes(q) ||
        c.displayNumber.includes(q) ||
        c.activityId.toLowerCase().includes(q)
    );
  }, [allCalls, callSearch]);

  const toggleCall = (activityId: string) => {
    const ids = config.selectedCallIds;
    if (ids.includes(activityId)) {
      onConfigChange({ selectedCallIds: ids.filter((id) => id !== activityId) });
    } else {
      onConfigChange({ selectedCallIds: [...ids, activityId] });
    }
  };

  const toggleAll = () => {
    const filteredIds = filteredCalls.map((c) => c.activityId);
    if (config.selectedCallIds.length === filteredIds.length) {
      onConfigChange({ selectedCallIds: [] });
    } else {
      onConfigChange({ selectedCallIds: [...filteredIds] });
    }
  };

  const callLabel = (c: CallRecord) => {
    const name = c.displayNumber || c.leadId || c.activityId.slice(0, 8);
    const rep = c.repName || '—';
    const dur = c.durationSeconds > 0 ? formatDuration(c.durationSeconds) : '—';
    return { name, agent: rep, dur, status: c.status || '—' };
  };

  const filterCount = activeFilterCount(config);

  return (
    <div className="space-y-4">
      {/* Info callout */}
      <div className="flex items-start gap-2.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
        <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-[12px] text-[var(--text-secondary)]">
          Calls are loaded from synced source data. Picks come from the full synced history; freshness is governed by the scheduled sync.
        </p>
      </div>

      {/* Filters button */}
      <div className="flex justify-end items-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className="gap-1.5 shrink-0"
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {filterCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-brand-accent)] text-[11px] font-bold text-white">
              {filterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Active filter summary pills */}
      {filterCount > 0 && (
        <div className="flex flex-wrap gap-1.5 -mt-1">
          {config.agents.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              Agents: {config.agents.join(', ')}
              <button onClick={() => onConfigChange({ agents: [] })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {config.leadId.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              Leads: {config.leadId.length === 1 ? config.leadId[0] : `${config.leadId.length} selected`}
              <button onClick={() => onConfigChange({ leadId: [] })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {config.eventCodes && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              Events: {config.eventCodes}
              <button onClick={() => onConfigChange({ eventCodes: '' })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {config.direction && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              {config.direction === 'inbound' ? 'Inbound' : 'Outbound'}
              <button onClick={() => onConfigChange({ direction: '' })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {config.status && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              {config.status === 'answered' ? 'Answered' : 'Missed'}
              <button onClick={() => onConfigChange({ status: '' })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {(config.durationMin || config.durationMax) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              Duration: {config.durationMin || '0'}s – {config.durationMax ? config.durationMax + 's' : '∞'}
              <button onClick={() => onConfigChange({ durationMin: '', durationMax: '' })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
          {config.hasRecording && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              Has recording
              <button onClick={() => onConfigChange({ hasRecording: false })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* Call Selection radio group */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-2">
          Call Selection
        </label>
        <div className="space-y-2">
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex items-start gap-3 px-3 py-2.5 rounded-[6px] border cursor-pointer transition-colors',
                config.selectionMode === opt.value
                  ? 'border-[var(--interactive-primary)] bg-[var(--color-brand-accent)]/5'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <input
                type="radio"
                name="callScope"
                value={opt.value}
                checked={config.selectionMode === opt.value}
                onChange={() => onConfigChange({ selectionMode: opt.value })}
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
      {config.selectionMode === 'sample' && (
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
            Sample Size
          </label>
          <Input
            type="number"
            min={1}
            max={matchingCount}
            value={sampleSizeLocal ?? String(config.sampleSize)}
            error={sampleSizeError}
            onFocus={() => setSampleSizeLocal(String(config.sampleSize))}
            onChange={(e) => {
              const raw = e.target.value;
              setSampleSizeLocal(raw);
              const parsed = parseInt(raw);
              if (raw === '' || isNaN(parsed)) {
                setSampleSizeError('');
              } else if (parsed < 1) {
                setSampleSizeError('Minimum is 1');
              } else if (parsed > matchingCount) {
                setSampleSizeError(`Maximum is ${matchingCount}`);
              } else {
                setSampleSizeError('');
                onConfigChange({ sampleSize: parsed });
              }
            }}
            onBlur={() => {
              const parsed = parseInt(sampleSizeLocal ?? '');
              if (!isNaN(parsed) && parsed > matchingCount) onConfigChange({ sampleSize: matchingCount });
              setSampleSizeError('');
              setSampleSizeLocal(null);
            }}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {isLoading ? '...' : `${matchingCount} calls available`}
          </p>
        </div>
      )}

      {/* Specific call multi-select */}
      {config.selectionMode === 'specific' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[var(--text-primary)]">Select Calls</label>
            <span className="text-[11px] text-[var(--text-muted)]">
              {config.selectedCallIds.length} of {allCalls.length} selected
            </span>
          </div>
          <Input
            icon={<Search className="h-4 w-4" />}
            value={callSearch}
            onChange={(e) => setCallSearch(e.target.value)}
            placeholder="Search by agent, lead, phone..."
            className="mb-2"
          />
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] text-[var(--text-brand)] hover:underline mb-1.5"
          >
            {config.selectedCallIds.length === filteredCalls.length && filteredCalls.length > 0
              ? 'Deselect all' : 'Select all'}
          </button>
          <div className="max-h-48 overflow-y-auto rounded-[6px] border border-[var(--border-subtle)]">
            {filteredCalls.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-[var(--text-muted)]">
                {allCalls.length === 0 ? 'Loading calls...' : 'No calls found'}
              </p>
            ) : (
              filteredCalls.map((c) => {
                const isSelected = config.selectedCallIds.includes(c.activityId);
                const info = callLabel(c);
                return (
                  <button
                    key={c.activityId}
                    type="button"
                    onClick={() => toggleCall(c.activityId)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
                      'hover:bg-[var(--interactive-secondary)]',
                      isSelected && 'bg-[var(--color-brand-accent)]/5'
                    )}
                  >
                    <div className={cn(
                      'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      isSelected
                        ? 'bg-[var(--interactive-primary)] border-[var(--interactive-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-primary)]'
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-[var(--text-on-color)]" />}
                    </div>
                    <span className="text-[var(--text-primary)] truncate flex-1">{info.name}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0">{info.agent}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0 w-10 text-right">{info.dur}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0 w-16 text-right">{info.status}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Skip evaluated + min duration checkboxes */}
      <div className="border-t border-[var(--border-subtle)] pt-3 mt-1">
        <label className="flex items-start gap-3 cursor-pointer mb-2">
          <input
            type="checkbox"
            checked={config.skipEvaluated}
            onChange={(e) => onConfigChange({ skipEvaluated: e.target.checked })}
            className="mt-0.5 accent-[var(--interactive-primary)]"
          />
          <div>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Skip previously evaluated calls</span>
            <p className="text-[11px] text-[var(--text-muted)]">
              Calls already evaluated in any past run will be excluded.
              {config.selectionMode === 'sample' && ' Sampling will draw from the remaining unevaluated calls.'}
            </p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.minDuration}
            onChange={(e) => onConfigChange({ minDuration: e.target.checked })}
            className="mt-0.5 accent-[var(--interactive-primary)]"
          />
          <div>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Minimum duration ≥ 10 seconds</span>
            <p className="text-[11px] text-[var(--text-muted)]">Skip very short or failed calls with no meaningful conversation.</p>
          </div>
        </label>
      </div>

      {/* Stats summary */}
      <div className="flex gap-4 text-xs">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Matching</div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{isLoading ? '...' : matchingCount}</div>
        </div>
        <div className="rounded-md border border-[var(--border-brand)]/30 bg-[var(--color-brand-accent)]/5 px-3 py-2">
          <div className="text-[10px] font-medium text-[var(--text-brand)] uppercase">To Evaluate</div>
          <div className="text-sm font-semibold text-[var(--text-brand)]">
            {isLoading ? '...' : config.selectionMode === 'specific'
              ? config.selectedCallIds.length
              : config.selectionMode === 'sample'
                ? Math.min(config.sampleSize, matchingCount)
                : matchingCount}
          </div>
        </div>
      </div>

      {/* Filter panel overlay — shared with the listing's filter panel */}
      <CallFilterPanel
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        activeTab="calls"
        values={callFilters}
        onPatch={(patch) => onConfigChange(patch as Partial<CallSelectionConfig>)}
        onReset={handleFilterReset}
      />
    </div>
  );
}
