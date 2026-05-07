import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import type { CohortSource, WorkflowType } from '@/features/orchestration/types';
import { fetchCohortSources } from '@/services/api/orchestration';
import { cn } from '@/utils';

interface Props {
  appId: string;
  workflowType?: WorkflowType;
  /** Currently-selected ``source_ref`` (e.g. ``"crm.lead_record"`` or
   *  ``"dataset.<uuid>"``). ``null`` / ``''`` means nothing is picked. */
  value: string | null;
  /** Fired when the operator picks an entry. The full ``CohortSource`` is
   *  forwarded so the inspector can repopulate dependent UI (allowed-column
   *  pickers, filter rows) without a second lookup. */
  onChange(sourceRef: string, entry: CohortSource): void;
  /** Optional — fired once the catalog fetch resolves. The inspector uses
   *  this to hydrate the *selected* entry from a saved ``source_ref`` on
   *  mount, since the picker itself does not surface the loaded entries. */
  onSourcesLoaded?(sources: CohortSource[]): void;
  disabled?: boolean;
}

const STATIC_GROUP_LABEL = 'Built-in';
const DATASET_GROUP_LABEL = 'Dataset';
const PREVIEW_COLUMN_COUNT = 5;

/**
 * Phase 12 (Task 8) — grouped + searchable source picker for the
 * ``source.cohort_query`` node config inspector.
 *
 * Reads the merged cohort-source catalog (engineering-owned static entries
 * + tenant-owned dataset versions) and renders both kinds in the same
 * dropdown. Entries are sorted with built-in sources first, datasets
 * second; the underlying ``Combobox`` shows the group name in the option's
 * ``meta`` slot so authors can tell them apart at a glance.
 *
 * When a dataset entry is selected, the picker renders a small affordance
 * card below itself summarising the version label, column count and the
 * first few column names, plus a link to the datasets page.
 */
export function DatasetSourcePicker({
  appId,
  workflowType,
  value,
  onChange,
  onSourcesLoaded,
  disabled,
}: Props) {
  const orchestrationRoutes = useOrchestrationRoutes();

  const [sources, setSources] = useState<CohortSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Stable ref so adding ``onSourcesLoaded`` to the deps below doesn't cause
  // re-fetch loops when the parent passes an inline closure.
  const onSourcesLoadedRef = useRef(onSourcesLoaded);
  useEffect(() => {
    onSourcesLoadedRef.current = onSourcesLoaded;
  }, [onSourcesLoaded]);

  useEffect(() => {
    let alive = true;
    setError(null);
    setSources(null);
    fetchCohortSources({ workflowType, appId })
      .then((rows) => {
        if (!alive) return;
        setSources(rows);
        onSourcesLoadedRef.current?.(rows);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load sources');
        setSources([]);
      });
    return () => {
      alive = false;
    };
  }, [appId, workflowType, reloadKey]);

  const grouped = useMemo(() => {
    const safe = sources ?? [];
    return {
      statics: safe.filter((s) => s.kind === 'static'),
      datasets: safe.filter((s) => s.kind === 'dataset'),
    };
  }, [sources]);

  const options: ComboboxOption[] = useMemo(() => {
    // Render static entries first, then datasets — Combobox doesn't
    // support non-selectable group headers, so the group label rides in
    // each option's ``meta`` slot. Search includes the group label too,
    // so typing "dataset" filters to dataset entries.
    const opts: ComboboxOption[] = [];
    for (const entry of grouped.statics) {
      opts.push({
        value: entry.sourceRef,
        label: entry.displayLabel,
        meta: STATIC_GROUP_LABEL,
        searchText: `${STATIC_GROUP_LABEL} ${entry.displayLabel} ${entry.sourceRef} ${entry.description}`,
      });
    }
    for (const entry of grouped.datasets) {
      opts.push({
        value: entry.sourceRef,
        label: entry.displayLabel,
        meta: DATASET_GROUP_LABEL,
        searchText: `${DATASET_GROUP_LABEL} ${entry.displayLabel} ${entry.sourceRef} ${entry.description}`,
      });
    }
    return opts;
  }, [grouped]);

  const selected = useMemo(
    () => sources?.find((s) => s.sourceRef === value) ?? null,
    [sources, value],
  );

  const handleChange = useCallback(
    (next: string) => {
      if (!sources) return;
      const entry = sources.find((s) => s.sourceRef === next);
      if (!entry) return;
      onChange(next, entry);
    },
    [onChange, sources],
  );

  const isLoading = sources === null;
  const isEmpty = sources !== null && sources.length === 0;
  const placeholder = isLoading ? 'Loading sources…' : 'Pick a source';

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        value={value ?? ''}
        onChange={handleChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled || isLoading}
      />

      {selected ? (
        <p className="text-xs text-[var(--text-secondary)]">{selected.description}</p>
      ) : null}

      {selected?.kind === 'dataset' ? (
        <DatasetAffordance
          entry={selected}
          datasetsRoute={orchestrationRoutes.datasets}
        />
      ) : null}

      {error ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--color-error)]">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className={cn(
              'rounded-[var(--radius-default)] border border-[var(--border-default)]',
              'px-2 py-0.5 text-[11px] text-[var(--text-secondary)]',
              'hover:bg-[var(--bg-tertiary)]',
            )}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!isLoading && isEmpty ? (
        <p className="text-xs text-[var(--text-secondary)]">
          No sources available.{' '}
          <Link
            to={orchestrationRoutes.datasets}
            className="text-[var(--text-brand)] underline underline-offset-2"
          >
            Create a dataset to get started.
          </Link>
        </p>
      ) : null}
    </div>
  );
}

interface AffordanceProps {
  entry: CohortSource;
  datasetsRoute: string;
}

function DatasetAffordance({ entry, datasetsRoute }: AffordanceProps) {
  // The backend derives ``allowedFilterColumns`` from the dataset's
  // ``schema_descriptor.columns[*].name`` — using it here keeps the affordance
  // honest without re-fetching the dataset detail.
  const columns = entry.allowedFilterColumns;
  const preview = columns.slice(0, PREVIEW_COLUMN_COUNT);
  const remaining = Math.max(columns.length - preview.length, 0);

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-[var(--radius-default)]',
        'border border-[var(--border-default)] bg-[var(--bg-tertiary)]',
        'px-3 py-2',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {entry.displayLabel}
        </span>
        <Link
          to={datasetsRoute}
          className="text-[11px] text-[var(--text-brand)] underline underline-offset-2"
        >
          View datasets
        </Link>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)]">
        {columns.length} {columns.length === 1 ? 'column' : 'columns'} detected
      </p>
      {preview.length > 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          {preview.join(', ')}
          {remaining > 0 ? ` +${remaining} more` : ''}
        </p>
      ) : null}
    </div>
  );
}
