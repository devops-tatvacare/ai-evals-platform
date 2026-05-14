/**
 * Filter panel for Inside Sales collection views.
 *
 * Every filter dropdown is backed by `/api/inside-sales/collections/{family}/suggestions`,
 * which reads from the same raw column the listing query matches against —
 * so what the user sees in the dropdown is exactly what filtering returns.
 */

import { useId } from 'react';
import { X } from 'lucide-react';
import { Button, Combobox, RightSlideOverShell } from '@/components/ui';
import { useAppConfig, useCurrentAppId } from '@/hooks';
import { useInsideSalesStore } from '@/stores';
import { useLeadsStore } from '@/stores/insideSalesStore';
import type { CallFilters, InsideSalesCollectionFamily, LeadFilters } from '@/services/api/insideSales';
import type { AppCollectionFilterConfig } from '@/types';
import { cn } from '@/utils/cn';
import { useCollectionSuggestions } from '../hooks/useCollectionSuggestions';
import { useCrmSchema, type CrmSchema } from '../queries/crmSchema';

// The manifest catalog table each collection's filters resolve against.
const FAMILY_SCHEMA_TABLE: Record<InsideSalesCollectionFamily, string> = {
  leads: 'dim_lead',
  calls: 'fact_lead_activity',
};

/** Manifest description for a filter, sourced from `useCrmSchema` (Phase
 *  11E). A filter's `suggestionField` / `key` is matched against the
 *  catalog table's structural columns first, then its `attributes` keys.
 *  `undefined` when the manifest carries no description — the label then
 *  renders without a tooltip; no hardcoded fallback copy. */
function filterTooltip(
  schema: CrmSchema | undefined,
  filter: AppCollectionFilterConfig,
): string | undefined {
  if (!schema) return undefined;
  const field = filter.suggestionField ?? filter.fields?.[0] ?? filter.key;
  const column = schema.columns?.[field]?.description;
  if (column) return column;
  for (const bucket of Object.values(schema.attributeSchemas ?? {})) {
    const attr = bucket?.[field]?.description;
    if (attr) return attr;
  }
  return undefined;
}

interface CallFilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab?: 'leads' | 'calls';
  /** Calls-tab overrides. When provided, the panel reads/writes through these instead of the store.
   *  Used by the eval overlay to drive filters from local component state. Listing keeps the default. */
  values?: CallFilters;
  onPatch?: (patch: Partial<CallFilters>) => void;
  onReset?: () => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]';

/** Multi-select combobox backed by `/api/inside-sales/collections/{family}/suggestions`. */
function AsyncMultiSelectControl({
  filter,
  values,
  setPatch,
  family,
}: {
  filter: AppCollectionFilterConfig;
  values: CallFilters | LeadFilters;
  setPatch: (patch: Partial<CallFilters> | Partial<LeadFilters>) => void;
  family: InsideSalesCollectionFamily;
}) {
  const field = filter.suggestionField;
  const fields = filter.fields ?? [filter.key];
  const raw = Reflect.get(values, fields[0]) as unknown;
  const selected = Array.isArray(raw) ? (raw as string[]) : [];

  const { options, loading, onSearchChange } = useCollectionSuggestions(
    family,
    // Invariant: `suggestionField` is required for `async-multi-select`
    // entries. Fall through to `rep_name` as a last resort so the UI
    // still loads rather than crashes on a stale app config.
    field ?? 'rep_name',
    { debounceMs: 250, limit: 20 },
  );

  // Options from server, plus anything the user has already selected so
  // the selected labels render even when the user clears their search.
  const merged = Array.from(new Set([...(selected ?? []), ...(options ?? [])]));
  const comboOptions = merged.map((value) => ({ value, label: value }));

  return (
    <Combobox
      multi
      value={selected}
      onChange={(next) => setPatch({ [fields[0]]: next } as Partial<CallFilters> | Partial<LeadFilters>)}
      options={comboOptions}
      onSearchChange={onSearchChange}
      loading={loading}
      placeholder={filter.placeholder}
      size="sm"
    />
  );
}

function renderFilterControl(
  filter: AppCollectionFilterConfig,
  values: CallFilters | LeadFilters,
  setPatch: (patch: Partial<CallFilters> | Partial<LeadFilters>) => void,
  family: InsideSalesCollectionFamily,
) {
  const fields = filter.fields ?? [filter.key];

  switch (filter.control) {
    case 'async-multi-select':
      return (
        <AsyncMultiSelectControl
          filter={filter}
          values={values}
          setPatch={setPatch}
          family={family}
        />
      );
    case 'text':
      return (
        <input
          type="text"
          value={String(values[fields[0] as keyof typeof values] ?? '')}
          onChange={(event) => setPatch({ [fields[0]]: event.target.value })}
          placeholder={filter.placeholder}
          className={cn(INPUT_CLASS, fields[0] === 'leadId' && 'font-mono')}
        />
      );
    case 'multi-select':
      return (
        <Combobox
          multi
          value={Array.isArray(values[fields[0] as keyof typeof values]) ? values[fields[0] as keyof typeof values] as string[] : []}
          onChange={(nextValue) => setPatch({ [fields[0]]: nextValue })}
          options={filter.options ?? []}
          placeholder={filter.placeholder}
        />
      );
    case 'segmented':
      return (
        <div className="flex gap-2">
          {(filter.options ?? []).map((option) => (
            <button
              key={option.value}
              onClick={() => setPatch({ [fields[0]]: option.value })}
              className={cn(
                'flex-1 rounded-md py-1.5 text-xs font-medium border transition-colors',
                String(values[fields[0] as keyof typeof values] ?? '') === option.value
                  ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--text-brand)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    case 'number-range':
      return (
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={String(values[fields[0] as keyof typeof values] ?? '')}
            onChange={(event) => setPatch({ [fields[0]]: event.target.value })}
            placeholder="Min"
            className={INPUT_CLASS}
          />
          <input
            type="number"
            min={0}
            value={String(values[fields[1] as keyof typeof values] ?? '')}
            onChange={(event) => setPatch({ [fields[1]]: event.target.value })}
            placeholder="Max"
            className={INPUT_CLASS}
          />
        </div>
      );
    case 'toggle':
      return (
        <label className="flex items-center gap-3 cursor-pointer rounded-md border border-[var(--border-default)] px-3 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors">
          <input
            type="checkbox"
            checked={Boolean(values[fields[0] as keyof typeof values])}
            onChange={(event) => setPatch({ [fields[0]]: event.target.checked })}
            className="accent-[var(--interactive-primary)] h-4 w-4"
          />
          <div>
            <span className="text-xs font-medium text-[var(--text-primary)]">{filter.label}</span>
            {filter.description && (
              <p className="text-[11px] text-[var(--text-muted)]">{filter.description}</p>
            )}
          </div>
        </label>
      );
    default:
      return null;
  }
}

export function CallFilterPanel({
  isOpen,
  onClose,
  activeTab = 'calls',
  values,
  onPatch,
  onReset,
}: CallFilterPanelProps) {
  const titleId = useId();
  const appId = useCurrentAppId();
  const appConfig = useAppConfig(appId);
  const datasetKey = activeTab === 'leads' ? 'leads' : 'calls';
  const datasetConfig = appConfig.collections.datasets[datasetKey];
  const { data: crmSchema } = useCrmSchema(appId, FAMILY_SCHEMA_TABLE[datasetKey]);

  const callFiltersFromStore = useInsideSalesStore((state) => state.filters);
  const leadFilters = useLeadsStore((state) => state.leadFilters);

  const callFiltersResolved = values ?? callFiltersFromStore;
  const resolvedValues = datasetKey === 'leads' ? leadFilters : callFiltersResolved;
  const setPatch = (patch: Partial<CallFilters> | Partial<LeadFilters>) => {
    if (datasetKey === 'leads') {
      useLeadsStore.getState().setLeadFilters(patch as Partial<LeadFilters>);
      return;
    }
    if (onPatch) {
      onPatch(patch as Partial<CallFilters>);
      return;
    }
    useInsideSalesStore.getState().setFilters(patch as Partial<CallFilters>);
  };

  const resetFilters = () => {
    if (datasetKey === 'leads') {
      useLeadsStore.getState().clearLeadFilters();
      return;
    }
    if (onReset) {
      onReset();
      return;
    }
    useInsideSalesStore.getState().clearFilters();
  };

  return (
    <RightSlideOverShell
      isOpen={isOpen}
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[380px]"
      zIndexClassName="z-[var(--z-dropdown)]"
      panelClassName="bg-[var(--bg-primary)] border-l border-[var(--border-default)]"
      backdropClassName="bg-black/40 backdrop-blur-sm"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">Filters</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {datasetConfig.filters.map((filter) => (
            <div key={filter.key} className="space-y-2">
              <label
                className="text-xs font-medium text-[var(--text-secondary)]"
                title={filterTooltip(crmSchema, filter)}
              >
                {filter.label}
              </label>
              {renderFilterControl(filter, resolvedValues, setPatch, datasetKey)}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-default)]">
          <Button variant="ghost" size="sm" onClick={() => { resetFilters(); onClose(); }}>
            Reset
          </Button>
          <Button size="sm" onClick={onClose}>
            Apply
          </Button>
        </div>
    </RightSlideOverShell>
  );
}
