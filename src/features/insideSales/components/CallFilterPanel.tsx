/**
 * Filter panel for Inside Sales collection views.
 */

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Combobox } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { useInsideSalesStore } from '@/stores';
import { useLeadsStore } from '@/stores/insideSalesStore';
import { apiRequest } from '@/services/api/client';
import type { CallFilters, LeadFilters } from '@/services/api/insideSales';
import type { AppCollectionFilterConfig } from '@/types';
import { cn } from '@/utils/cn';
import { useRightOverlay } from '@/hooks';

interface CallFilterPanelProps {
  onClose: () => void;
  activeTab?: 'leads' | 'calls';
}

const INPUT_CLASS =
  'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]';

function readDateValue(value: unknown): string {
  return typeof value === 'string' ? value.split(' ')[0] : '';
}

function renderFilterControl(
  filter: AppCollectionFilterConfig,
  values: CallFilters | LeadFilters,
  setPatch: (patch: Partial<CallFilters> | Partial<LeadFilters>) => void,
  agentOptions: Array<{ value: string; label: string }>,
) {
  const fields = filter.fields ?? [filter.key];

  switch (filter.control) {
    case 'date-range':
      return (
        <div className="flex gap-2">
          <input
            type="date"
            value={readDateValue(values[fields[0] as keyof typeof values])}
            onChange={(event) => setPatch({ [fields[0]]: `${event.target.value} 00:00:00` })}
            className={INPUT_CLASS}
          />
          <input
            type="date"
            value={readDateValue(values[fields[1] as keyof typeof values])}
            onChange={(event) => setPatch({ [fields[1]]: `${event.target.value} 23:59:59` })}
            className={INPUT_CLASS}
          />
        </div>
      );
    case 'text':
      return (
        <input
          type="text"
          value={String(values[fields[0] as keyof typeof values] ?? '')}
          onChange={(event) => setPatch({ [fields[0]]: event.target.value })}
          placeholder={filter.placeholder}
          className={cn(INPUT_CLASS, fields[0] === 'prospectId' && 'font-mono')}
        />
      );
    case 'multi-select':
      return (
        <Combobox
          multi
          value={Array.isArray(values[fields[0] as keyof typeof values]) ? values[fields[0] as keyof typeof values] as string[] : []}
          onChange={(nextValue) => setPatch({ [fields[0]]: nextValue })}
          options={filter.optionSource === 'agents' ? agentOptions : (filter.options ?? [])}
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
                values[fields[0] as keyof typeof values] === option.value
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

export function CallFilterPanel({ onClose, activeTab = 'calls' }: CallFilterPanelProps) {
  const titleId = useId();
  const ariaProps = useRightOverlay(true, { onClose, labelledBy: titleId });
  const appConfig = useAppConfig('inside-sales');
  const datasetKey = activeTab === 'leads' ? 'leads' : 'calls';
  const datasetConfig = appConfig.collections.datasets[datasetKey];

  const callFilters = useInsideSalesStore((state) => state.filters);
  const leadFilters = useLeadsStore((state) => state.leadFilters);
  const [agentOptions, setAgentOptions] = useState<Array<{ value: string; label: string }>>([]);

  const values = datasetKey === 'leads' ? leadFilters : callFilters;
  const setPatch = (patch: Partial<CallFilters> | Partial<LeadFilters>) => {
    if (datasetKey === 'leads') {
      useLeadsStore.getState().setLeadFilters(patch as Partial<LeadFilters>);
      return;
    }
    useInsideSalesStore.getState().setFilters(patch as Partial<CallFilters>);
  };

  const resetFilters = () => {
    if (datasetKey === 'leads') {
      useLeadsStore.getState().clearLeadFilters();
      return;
    }
    useInsideSalesStore.getState().clearFilters();
  };

  useEffect(() => {
    const needsAgentOptions = datasetConfig?.filters.some((filter) => filter.optionSource === 'agents');
    if (!needsAgentOptions || datasetKey !== 'calls') {
      setAgentOptions([]);
      return;
    }

    const params = new URLSearchParams({
      date_from: callFilters.dateFrom,
      date_to: callFilters.dateTo,
    });

    apiRequest<{ agents: string[] }>(`/api/inside-sales/agents?${params.toString()}`)
      .then((data) => setAgentOptions(data.agents.map((agent) => ({ value: agent, label: agent }))))
      .catch(() => setAgentOptions([]));
  }, [callFilters.dateFrom, callFilters.dateTo, datasetConfig?.filters, datasetKey]);

  return (
    <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        {...ariaProps}
        className="absolute top-0 right-0 bottom-0 w-[380px] bg-[var(--bg-primary)] border-l border-[var(--border-default)] shadow-xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
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
              <label className="text-xs font-medium text-[var(--text-secondary)]">{filter.label}</label>
              {renderFilterControl(filter, values, setPatch, agentOptions)}
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
      </div>
    </div>
  );
}
