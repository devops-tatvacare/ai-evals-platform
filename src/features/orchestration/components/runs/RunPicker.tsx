import { useMemo } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui';
import type { WorkflowRun } from '@/features/orchestration/types';

interface Props {
  runs: WorkflowRun[];
  selectedRunId: string | null;
  onChange(runId: string): void;
  /** Hard cap on rows shown in the dropdown. Higher counts hurt scroll
   *  perf without adding value — most operators jump to a recent run.
   *  When the cap is hit, callers can surface a "View all runs" footer
   *  in the parent (the inspector header). */
  limit?: number;
  disabled?: boolean;
  className?: string;
}

function shortTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationSummary(run: WorkflowRun): string {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const end = run.completedAt ? new Date(run.completedAt).getTime() : null;
  if (start && end && end >= start) {
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  return run.status;
}

/**
 * Searchable run picker for the run inspector overlay. Reuses the
 * platform `Combobox` so the dropdown matches every other typeahead in
 * the app (search, keyboard nav, focus restoration). Each row's `meta`
 * carries the run's status + duration so operators can disambiguate
 * runs by outcome without opening them.
 *
 * The picker is intentionally label-less — the inspector header places
 * "Active run" copy beside it, matching `ScheduleHistoryOverlay`'s
 * "Active schedule" pattern.
 */
export function RunPicker({
  runs,
  selectedRunId,
  onChange,
  limit = 50,
  disabled,
  className,
}: Props) {
  const options = useMemo<ComboboxOption[]>(() => {
    return runs.slice(0, limit).map((run) => ({
      value: run.id,
      label: `${shortTimestamp(run.startedAt ?? run.createdAt)}  ·  ${run.id.slice(0, 8)}`,
      // `meta` shows on the right of each row in the dropdown and
      // also feeds into the search index, so typing "failed" filters
      // to failed runs.
      meta: `${run.status}  ·  ${durationSummary(run)}`,
      searchText: `${run.id} ${run.status} ${run.startedAt ?? ''}`,
    }));
  }, [runs, limit]);

  return (
    <Combobox
      options={options}
      value={selectedRunId ?? ''}
      onChange={onChange}
      placeholder="Select a run"
      size="sm"
      disabled={disabled || runs.length === 0}
      className={className}
    />
  );
}
