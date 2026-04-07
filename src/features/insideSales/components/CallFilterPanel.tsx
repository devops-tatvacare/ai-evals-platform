/**
 * Call Filter Panel — right-slide overlay for call listing filters.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Combobox } from '@/components/ui';
import { useInsideSalesStore } from '@/stores';
import { useLeadsStore } from '@/stores/insideSalesStore';
import { apiRequest } from '@/services/api/client';
import { cn } from '@/utils/cn';

interface CallFilterPanelProps {
  onClose: () => void;
  activeTab?: 'leads' | 'calls';
}

const STAGE_OPTIONS = [
  'New Lead', 'Call Back', 'RNR', 'Interested in future plan',
  'Not Interested', 'Converted', 'Invalid / Junk', 'Re-enquired',
].map((s) => ({ value: s, label: s }));

const CONDITION_OPTIONS = ['Diabetes', 'PCOS', 'Fatty Liver', 'Obesity', 'Hypertension']
  .map((c) => ({ value: c, label: c }));


export function CallFilterPanel({ onClose, activeTab }: CallFilterPanelProps) {
  const filters = useInsideSalesStore((s) => s.filters);
  const leadFilters = useLeadsStore((s) => s.leadFilters);
  const [agentOptions, setAgentOptions] = useState<{ value: string; label: string }[]>([]);

  // Load agent list for the current date range
  useEffect(() => {
    if (activeTab === 'leads') return;
    const params = new URLSearchParams({
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
    });
    apiRequest<{ agents: string[] }>(`/api/inside-sales/agents?${params.toString()}`)
      .then((data) => setAgentOptions(data.agents.map((a) => ({ value: a, label: a }))))
      .catch(() => {});
  }, [filters.dateFrom, filters.dateTo, activeTab]);

  const handleApply = () => {
    onClose();
  };

  const handleReset = () => {
    useInsideSalesStore.getState().clearFilters();
    onClose();
  };

  const handleDateChange = (field: 'dateFrom' | 'dateTo', value: string) => {
    useInsideSalesStore.getState().setFilters({ [field]: value });
  };

  const handleFieldChange = (field: string, value: string) => {
    useInsideSalesStore.getState().setFilters({ [field]: value });
  };

  return (
    <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="absolute top-0 right-0 bottom-0 w-[380px] bg-[var(--bg-primary)] border-l border-[var(--border-default)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Filters</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {activeTab === 'leads' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Date range */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Date Range (Lead Created)</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={leadFilters.dateFrom.split(' ')[0]}
                  onChange={(e) => useLeadsStore.getState().setLeadFilters({ dateFrom: e.target.value + ' 00:00:00' })}
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
                <input
                  type="date"
                  value={leadFilters.dateTo.split(' ')[0]}
                  onChange={(e) => useLeadsStore.getState().setLeadFilters({ dateTo: e.target.value + ' 23:59:59' })}
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
              </div>
            </div>

            {/* Prospect ID */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Prospect ID</label>
              <input
                type="text"
                value={leadFilters.prospectId}
                onChange={(e) => useLeadsStore.getState().setLeadFilters({ prospectId: e.target.value })}
                placeholder="Paste or type prospect ID..."
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
              />
            </div>

            {/* Stage */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Stage</label>
              <Combobox
                multi
                value={leadFilters.stage}
                onChange={(stage) => useLeadsStore.getState().setLeadFilters({ stage })}
                options={STAGE_OPTIONS}
                placeholder="Select stages..."
              />
            </div>

            {/* MQL Score */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">MQL Score</label>
              <div className="flex gap-2">
                {[{ label: 'Any', value: '' }, { label: '≥ 3', value: '3' }, { label: '= 5 (MQL)', value: '5' }].map(({ label, value }) => (
                  <button key={value}
                    onClick={() => useLeadsStore.getState().setLeadFilters({ mqlMin: value })}
                    className={cn(
                      'flex-1 rounded-md py-1.5 text-xs font-medium border transition-colors',
                      leadFilters.mqlMin === value
                        ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--text-brand)]'
                        : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                    )}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Condition */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Condition</label>
              <Combobox
                multi
                value={leadFilters.condition}
                onChange={(condition) => useLeadsStore.getState().setLeadFilters({ condition })}
                options={CONDITION_OPTIONS}
                placeholder="Select conditions..."
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Date range */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Date Range</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.dateFrom.split(' ')[0]}
                  onChange={(e) => handleDateChange('dateFrom', e.target.value + ' 00:00:00')}
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
                <input
                  type="date"
                  value={filters.dateTo.split(' ')[0]}
                  onChange={(e) => handleDateChange('dateTo', e.target.value + ' 23:59:59')}
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
              </div>
            </div>

            {/* Agent */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Agent</label>
              <Combobox
                multi
                value={filters.agents}
                onChange={(agents) => useInsideSalesStore.getState().setFilters({ agents })}
                options={agentOptions}
                placeholder="Select agents..."
              />
            </div>

            {/* Prospect ID */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Prospect ID</label>
              <input
                type="text"
                value={filters.prospectId}
                onChange={(e) => handleFieldChange('prospectId', e.target.value)}
                placeholder="Paste or type prospect ID..."
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
              />
            </div>

            {/* Direction */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Direction</label>
              <div className="flex gap-2">
                {['', 'inbound', 'outbound'].map((val) => (
                  <button
                    key={val}
                    onClick={() => handleFieldChange('direction', val)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      filters.direction === val
                        ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                        : 'bg-[var(--interactive-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {val === '' ? 'All' : val === 'inbound' ? 'Inbound' : 'Outbound'}
                  </button>
                ))}
              </div>
            </div>

            {/* Call Status */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Call Status</label>
              <div className="flex gap-2">
                {['', 'answered', 'notanswered'].map((val) => (
                  <button
                    key={val}
                    onClick={() => handleFieldChange('status', val)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      filters.status === val
                        ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                        : 'bg-[var(--interactive-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {val === '' ? 'All' : val === 'answered' ? 'Answered' : 'Missed'}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration range */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Duration (seconds)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={filters.durationMin}
                  onChange={(e) => handleFieldChange('durationMin', e.target.value)}
                  placeholder="Min"
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
                <input
                  type="number"
                  value={filters.durationMax}
                  onChange={(e) => handleFieldChange('durationMax', e.target.value)}
                  placeholder="Max"
                  className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-default)]">
          <Button variant="ghost" size="sm" onClick={() => {
            if (activeTab === 'leads') useLeadsStore.getState().clearLeadFilters();
            else handleReset();
            onClose();
          }}>
            Reset
          </Button>
          <Button size="sm" onClick={() => {
            if (activeTab === 'leads') {
              useLeadsStore.getState().loadLeads();
              onClose();
            } else {
              handleApply();
            }
          }}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
