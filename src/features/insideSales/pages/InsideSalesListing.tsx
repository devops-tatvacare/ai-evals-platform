import { useEffect, useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCcw,
  Filter,
  X,
  Play,
  Square,
  Info,
} from 'lucide-react';
import { Button, EmptyState, Tabs, Tooltip, Pagination } from '@/components/ui';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { useAppConfig, usePoll } from '@/hooks';
import { useInsideSalesStore, useUIStore } from '@/stores';
import { useLeadsStore } from '@/stores/insideSalesStore';
import type { CallRecord } from '@/stores/insideSalesStore';
import type { CollectionFreshness, LeadListRecord } from '@/services/api/insideSales';
import { cn } from '@/utils';
import { formatDuration, formatFrt } from '@/utils/formatters';
import { scoreColor } from '@/utils/scoreUtils';
import { routes } from '@/config/routes';
import { notificationService } from '@/services/notifications';
import { CallFilterPanel } from '../components/CallFilterPanel';
import { MqlScoreBadge } from '../components/MqlScoreBadge';
import { StageBadge } from '../components/StageBadge';
import { buildCollectionFilterPills, countActiveCollectionFilters } from '../utils/collectionFilters';

/* ── Helpers ─────────────────────────────────────────────── */

function formatLastContact(days: number | null): { text: string; isStale: boolean } {
  if (days === null) return { text: '—', isStale: false };
  if (days === 0) return { text: 'Today', isStale: false };
  return { text: `${days}d ago`, isStale: days > 7 };
}

const TERMINAL_STAGES = new Set(['not interested', 'converted', 'invalid / junk']);

function ColHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip content={<span className="text-xs">{tip}</span>} position="bottom" maxWidth={220}>
        <Info className="h-3 w-3 text-[var(--text-muted)] cursor-default shrink-0" />
      </Tooltip>
    </span>
  );
}

function describeFreshness(freshness: CollectionFreshness | null): string {
  if (!freshness?.lastSyncedAt) {
    return 'Not synced yet';
  }
  const syncedAt = new Date(freshness.lastSyncedAt);
  const elapsedMs = Date.now() - syncedAt.getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
  if (elapsedMinutes < 1) return 'Synced just now';
  if (elapsedMinutes < 60) return `Synced ${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Synced ${elapsedHours}h ago`;
  return `Synced ${syncedAt.toLocaleString('en-IN')}`;
}

function FreshnessBadge({
  freshness,
  refreshing,
  onRefresh,
}: {
  freshness: CollectionFreshness | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const syncing = refreshing || freshness?.syncInProgress;
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="flex flex-col">
        <span
          className={cn(
            'text-xs font-medium',
            freshness?.stale ? 'text-[var(--color-warning)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {describeFreshness(freshness)}
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {syncing ? 'Sync in progress' : freshness?.stale ? 'Data may be stale' : 'Mirror serving is up to date'}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        disabled={syncing}
        className="gap-1.5"
      >
        <RefreshCcw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
        {syncing ? 'Refreshing' : 'Refresh'}
      </Button>
    </div>
  );
}

function LeadsTableContent({
  onOpenFilters,
  emptyState,
}: {
  onOpenFilters: () => void;
  emptyState?: { title: string; description: string };
}) {
  const navigate = useNavigate();
  const leads = useLeadsStore((s) => s.leads);
  const leadsTotal = useLeadsStore((s) => s.leadsTotal);
  const leadsPage = useLeadsStore((s) => s.leadsPage);
  const leadsPageSize = useLeadsStore((s) => s.leadsPageSize);
  const leadsLoading = useLeadsStore((s) => s.leadsLoading);
  const leadsError = useLeadsStore((s) => s.leadsError);
  const leadFilters = useLeadsStore((s) => s.leadFilters);
  const [search, setSearch] = useState('');

  const filterKey = `${leadFilters.dateFrom}|${leadFilters.dateTo}|${leadFilters.agents}|${leadFilters.stage.join(',')}|${leadFilters.condition.join(',')}|${leadFilters.mqlMin}|${leadFilters.city}|${leadFilters.prospectId}|${leadsPage}`;

  // Client-side search filter
  const visibleLeads = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        [l.firstName, l.lastName].filter(Boolean).join(' ').toLowerCase().includes(q) ||
        l.phone.includes(q)
    );
  }, [leads, search]);

  const appConfig = useAppConfig('inside-sales');
  const leadDatasetConfig = appConfig.collections.datasets.leads;
  const activeFilterCount = useMemo(
    () => countActiveCollectionFilters(leadDatasetConfig, leadFilters),
    [leadDatasetConfig, leadFilters],
  );
  const activeFilterPills = useMemo(
    () => buildCollectionFilterPills(leadDatasetConfig, leadFilters),
    [leadDatasetConfig, leadFilters],
  );

  useEffect(() => {
    useLeadsStore.getState().loadLeads();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(Math.max(leadsTotal, 1) / leadsPageSize));

  const handleRowClick = useCallback((lead: LeadListRecord) => {
    navigate(routes.insideSales.leadDetail(lead.prospectId));
  }, [navigate]);

  if (leadsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--color-brand-accent)]" />
          <span className="text-xs text-[var(--text-muted)]">Loading leads...</span>
        </div>
      </div>
    );
  }

  if (leadsError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={Phone}
          title="Failed to load leads"
          description={leadsError}
          action={{ label: 'Retry', onClick: () => useLeadsStore.getState().loadLeads() }}
        />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Phone}
          title={emptyState?.title ?? 'No leads found'}
          description={emptyState?.description ?? 'No leads for the selected date range and filters.'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 py-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
          />
        </div>

        <Button variant="secondary" size="sm" onClick={onOpenFilters} className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-brand-accent)] text-[13px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <button
            onClick={() => useLeadsStore.getState().clearLeadFilters()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Clear all
          </button>
        )}

      </div>

      {/* Active filter pills */}
      {activeFilterPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {activeFilterPills.map((pill) => (
            <FilterPill
              key={pill.key}
              label={pill.label}
              onRemove={() => useLeadsStore.getState().setLeadFilters(pill.clearPatch)}
            />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border border-[var(--border-default)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
            <tr className="border-b border-[var(--border-default)]">
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Lead" tip="Name and phone from LeadSquared." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Stage" tip="Current CRM stage in LeadSquared (ProspectStage field)." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="MQL" tip="Marketing Qualified Lead score (0–5). One point per signal: age in range, target city, qualifying condition, HbA1c, intent to pay." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Owner" tip="Assigned lead owner in LeadSquared (OwnerIdName). May differ from the agent shown in call timeline, who is the person who made each call." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Dials" tip="Total call attempts = RNR (no answer) + Answered. From LSQ mx_RNR_Count + mx_Answered_Call_Count." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Connect %" tip="Answered ÷ Total Dials × 100. Blank when no dials recorded." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="FRT" tip="First Response Time: lead creation → first call. Green ≤ 1h, amber ≤ 3h, red > 3h." />
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                <ColHeader label="Last Contact" tip="Days since most recent call activity. Red if > 7 days (stale) for active leads." />
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => {
              const frt = formatFrt(lead.frtSeconds);
              const lastContact = formatLastContact(lead.daysSinceLastContact);
              const isTerminal = TERMINAL_STAGES.has(lead.prospectStage.toLowerCase());
              return (
                <tr
                  key={lead.prospectId}
                  onClick={() => handleRowClick(lead)}
                  className="border-b border-[var(--border-subtle)] cursor-pointer transition-colors hover:bg-[var(--interactive-secondary)]"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-[var(--text-primary)]">
                      {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                    </div>
                    <div className="font-mono text-[13px] text-[var(--text-muted)]">{lead.phone}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge stage={lead.prospectStage} />
                  </td>
                  <td className="px-3 py-2.5">
                    <MqlScoreBadge score={lead.mqlScore} signals={lead.mqlSignals} />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                    {lead.agentName || '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--text-secondary)]">
                    {lead.totalDials > 0 ? lead.totalDials : '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--text-secondary)]">
                    {lead.connectRate !== null ? `${Math.round(lead.connectRate)}%` : '—'}
                  </td>
                  <td className={cn('px-3 py-2.5 tabular-nums', frt.color || 'text-[var(--text-secondary)]')}>
                    {frt.text}
                  </td>
                  <td className={cn(
                    'px-3 py-2.5 tabular-nums',
                    lastContact.isStale && !isTerminal ? 'text-red-400' : 'text-[var(--text-secondary)]'
                  )}>
                    {lastContact.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-3 pb-1">
        <Pagination
          page={leadsPage}
          totalPages={totalPages}
          onPageChange={(nextPage) => useLeadsStore.getState().setLeadsPage(nextPage)}
          showCount
          totalItems={leadsTotal}
          pageSize={leadsPageSize}
          className="w-full"
        />
      </div>
    </div>
  );
}

function formatCallTime(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function DirectionBadge({ direction }: { direction: string }) {
  const isInbound = direction === 'inbound';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isInbound
          ? 'bg-purple-500/15 text-purple-400'
          : 'bg-blue-500/15 text-blue-400'
      )}
    >
      {isInbound ? <PhoneIncoming className="h-3 w-3" /> : <PhoneOutgoing className="h-3 w-3" />}
      {isInbound ? 'In' : 'Out'}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isAnswered = status.toLowerCase() === 'answered';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isAnswered
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-red-500/15 text-red-400'
      )}
    >
      {isAnswered ? 'Answered' : 'Missed'}
    </span>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export function InsideSalesListing() {
  const appConfig = useAppConfig('inside-sales');
  const leadDatasetConfig = appConfig.collections.datasets.leads;
  const callDatasetConfig = appConfig.collections.datasets.calls;
  const navigate = useNavigate();
  const calls = useInsideSalesStore((s) => s.calls);
  const total = useInsideSalesStore((s) => s.total);
  const page = useInsideSalesStore((s) => s.page);
  const pageSize = useInsideSalesStore((s) => s.pageSize);
  const callsFreshness = useInsideSalesStore((s) => s.freshness);
  const isLoading = useInsideSalesStore((s) => s.isLoading);
  const error = useInsideSalesStore((s) => s.error);
  const isRefreshingCalls = useInsideSalesStore((s) => s.isRefreshing);
  const callsRefreshError = useInsideSalesStore((s) => s.refreshError);
  const callsRefreshJobId = useInsideSalesStore((s) => s.refreshJobId);
  const filters = useInsideSalesStore((s) => s.filters);
  const selectedCallIds = useInsideSalesStore((s) => s.selectedCallIds);
  const leadsFreshness = useLeadsStore((s) => s.leadsFreshness);
  const leadsRefreshing = useLeadsStore((s) => s.leadsRefreshing);
  const leadsRefreshError = useLeadsStore((s) => s.leadsRefreshError);
  const leadsRefreshJobId = useLeadsStore((s) => s.leadsRefreshJobId);

  const openModal = useUIStore((s) => s.openModal);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'leads' | 'calls'>('leads');
  const [callSearch, setCallSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  // Stable key from filter values + page — only re-fetch when these actually change
  const filterKey = [
    filters.dateFrom,
    filters.dateTo,
    filters.agents.join(','),
    filters.prospectId,
    filters.direction,
    filters.status,
    filters.hasRecording ? 'recording' : '',
    filters.durationMin,
    filters.durationMax,
    filters.eventCodes,
    page,
  ].join('|');

  useEffect(() => {
    if (activeTab !== 'calls') return;
    useInsideSalesStore.getState().loadCalls();
  }, [activeTab, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  usePoll({
    enabled: Boolean(callsRefreshJobId),
    fn: async () => useInsideSalesStore.getState().pollCallsRefresh(),
    intervalMs: 3000,
  });

  usePoll({
    enabled: Boolean(leadsRefreshJobId),
    fn: async () => useLeadsStore.getState().pollLeadsRefresh(),
    intervalMs: 3000,
  });

  useEffect(() => {
    if (callsRefreshError) {
      notificationService.error(callsRefreshError);
    }
  }, [callsRefreshError]);

  useEffect(() => {
    if (leadsRefreshError) {
      notificationService.error(leadsRefreshError);
    }
  }, [leadsRefreshError]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
      }
    };
  }, [audioEl]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Client-side search only; server-side filters own dataset counts and pagination.
  const filteredCalls = useMemo(() => {
    const q = callSearch.toLowerCase().trim();
    if (q) {
      return calls.filter(
        (c) =>
          c.agentName.toLowerCase().includes(q) ||
          c.displayNumber.includes(q) ||
          c.activityId.toLowerCase().includes(q)
      );
    }
    return calls;
  }, [calls, callSearch]);
  const activeFilterCount = useMemo(
    () => countActiveCollectionFilters(callDatasetConfig, filters),
    [callDatasetConfig, filters],
  );
  const activeFilterPills = useMemo(
    () => buildCollectionFilterPills(callDatasetConfig, filters),
    [callDatasetConfig, filters],
  );

  const handlePageChange = useCallback((newPage: number) => {
    useInsideSalesStore.getState().setPage(newPage);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setCallSearch(value);
  }, []);

  const handleRowClick = useCallback(
    (call: CallRecord) => {
      useInsideSalesStore.getState().setActiveCall(call);
      navigate(routes.insideSales.callView(call.activityId));
    },
    [navigate]
  );

  const handleToggleSelect = useCallback((activityId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    useInsideSalesStore.getState().toggleCallSelection(activityId);
  }, []);

  const handleSelectAll = useCallback(() => {
    const store = useInsideSalesStore.getState();
    const visibleIds = filteredCalls.map((call) => call.activityId);
    const visibleSelectedCount = visibleIds.filter((id) => selectedCallIds.has(id)).length;

    if (visibleSelectedCount === visibleIds.length) {
      store.replaceCallSelection(
        [...selectedCallIds].filter((id) => !visibleIds.includes(id)),
      );
    } else {
      store.replaceCallSelection([...new Set([...selectedCallIds, ...visibleIds])]);
    }
  }, [filteredCalls, selectedCallIds]);

  const handlePlayToggle = useCallback(
    (call: CallRecord, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!audioEl || !call.recordingUrl) return;

      if (playingId === call.activityId) {
        audioEl.pause();
        setPlayingId(null);
      } else {
        audioEl.src = call.recordingUrl;
        audioEl.play();
        setPlayingId(call.activityId);
        audioEl.onended = () => setPlayingId(null);
      }
    },
    [audioEl, playingId]
  );

  const handleClearFilters = useCallback(() => {
    useInsideSalesStore.getState().clearFilters();
  }, []);

  const handleRefresh = useCallback(async () => {
    if (activeTab === 'calls') {
      const jobId = await useInsideSalesStore.getState().refreshCalls();
      if (jobId) {
        notificationService.info('Calls refresh queued.');
      }
      return;
    }
    const jobId = await useLeadsStore.getState().refreshLeads();
    if (jobId) {
      notificationService.info('Leads refresh queued.');
    }
  }, [activeTab]);

  const activeFreshness = activeTab === 'calls' ? callsFreshness : leadsFreshness;
  const activeRefreshing = activeTab === 'calls' ? isRefreshingCalls : leadsRefreshing;

  const tableContent = (
    <div className="flex flex-col h-full">
      {/* Search + filter toolbar */}
      <div className="flex items-center gap-2 py-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={callSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search agent, number..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFilterPanelOpen(true)}
          className="gap-1.5"
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-brand-accent)] text-[13px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <button
            onClick={handleClearFilters}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Clear all
          </button>
        )}

      </div>

      {/* Active filter pills */}
      {activeFilterPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {activeFilterPills.map((pill) => (
            <FilterPill
              key={pill.key}
              label={pill.label}
              onRemove={() => useInsideSalesStore.getState().setFilters(pill.clearPatch)}
            />
          ))}
        </div>
      )}

      {/* Bulk selection bar */}
      {selectedCallIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-[var(--color-brand-accent)]/10 px-3 py-2 mb-2">
          <span className="text-xs font-medium text-[var(--text-brand)]">
            {selectedCallIds.size} selected
          </span>
          <button
            onClick={() => useInsideSalesStore.getState().deselectAll()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Deselect all
          </button>
          <PermissionGate action="evaluation:run">
            <Button size="sm" className="ml-auto" onClick={() => openModal('insideSalesEval')}>
              Evaluate Selected
            </Button>
          </PermissionGate>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--color-brand-accent)]" />
            <span className="text-xs text-[var(--text-muted)]">Loading calls...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <EmptyState
            icon={Phone}
            title="Failed to load calls"
            description={error}
            action={{
              label: 'Retry',
              onClick: () => useInsideSalesStore.getState().loadCalls(),
            }}
          />
        </div>
      ) : filteredCalls.length === 0 ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <EmptyState
            icon={Phone}
            title={callSearch ? 'No matching calls' : (callDatasetConfig.emptyState?.title ?? 'No calls found')}
            description={
              callSearch
                ? 'Try adjusting your search terms.'
                : (callDatasetConfig.emptyState?.description ?? 'No call activities for the selected date range.')
            }
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto rounded-md border border-[var(--border-default)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
                <tr className="border-b border-[var(--border-default)]">
                  <th className="w-8 px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={filteredCalls.length > 0 && filteredCalls.every((call) => selectedCallIds.has(call.activityId))}
                      onChange={handleSelectAll}
                      className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Date / Time</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Agent Name</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Prospect ID</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Score</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Direction</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Status</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call) => (
                  <tr
                    key={call.activityId}
                    onClick={() => handleRowClick(call)}
                    className={cn(
                      'border-b border-[var(--border-subtle)] cursor-pointer transition-colors',
                      'hover:bg-[var(--interactive-secondary)]',
                      selectedCallIds.has(call.activityId) && 'bg-[var(--color-brand-accent)]/5'
                    )}
                  >
                    <td className="w-8 px-2 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedCallIds.has(call.activityId)}
                        onClick={(e) => handleToggleSelect(call.activityId, e)}
                        onChange={() => {}}
                        className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] whitespace-nowrap">
                      {formatCallTime(call.callStartTime)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">
                      {call.agentName || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)] text-xs">
                      {call.prospectId || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                      {call.durationSeconds > 0 ? formatDuration(call.durationSeconds) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {call.evalCount && call.evalCount > 0 ? (
                        <span style={{ color: scoreColor(call.lastEvalScore ?? null) }} className="text-xs font-mono font-semibold">
                          {call.lastEvalScore !== null && call.lastEvalScore !== undefined
                            ? Math.round(call.lastEvalScore)
                            : '—'}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)] text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <DirectionBadge direction={call.direction} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="w-12 px-2 py-2.5">
                      {call.recordingUrl ? (
                        <button
                          onClick={(e) => handlePlayToggle(call, e)}
                          className={cn(
                            'rounded-full p-1.5 transition-colors',
                            playingId === call.activityId
                              ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                              : 'bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)] hover:bg-[var(--color-brand-accent)]/25'
                          )}
                          title={playingId === call.activityId ? 'Stop' : 'Play'}
                        >
                          {playingId === call.activityId ? (
                            <Square className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <span className="text-[var(--text-muted)] text-[13px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} showCount totalItems={total} pageSize={pageSize} />
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 shrink-0 pb-3 border-b border-[var(--border-default)]">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Inside Sales</h1>
          <p className="text-xs text-[var(--text-muted)]">
            PostgreSQL-backed collection serving with explicit sync refresh.
          </p>
        </div>
        <FreshnessBadge freshness={activeFreshness} refreshing={activeRefreshing} onRefresh={handleRefresh} />
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'leads', label: 'Leads', content: <LeadsTableContent onOpenFilters={() => setFilterPanelOpen(true)} emptyState={leadDatasetConfig.emptyState} /> },
          { id: 'calls', label: 'All Calls', content: tableContent },
        ]}
        defaultTab="leads"
        onChange={(id) => setActiveTab(id as 'leads' | 'calls')}
        mountStrategy="active-only"
        fillHeight
      />

      {/* Filter panel */}
      {filterPanelOpen && (
        <CallFilterPanel activeTab={activeTab} onClose={() => setFilterPanelOpen(false)} />
      )}
    </div>
  );
}

/* ── Filter Pill ─────────────────────────────────────────── */

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--interactive-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--border-default)] transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
