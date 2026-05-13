import { type ReactNode, useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCcw,
  X,
  Play,
  Square,
} from 'lucide-react';
import {
  Button,
  DataTable,
  type ColumnDef,
  EmptyState,
  FilterButton,
  PageHeaderSearch,
  PageSurface,
  Tabs,
} from '@/components/ui';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { useAppConfig } from '@/hooks';
import { useInsideSalesStore } from '@/stores';
import { useLeadsStore } from '@/stores/insideSalesStore';
import type { CallRecord } from '@/stores/insideSalesStore';
import type { CollectionFreshness, CollectionSyncStatus, LeadListRecord } from '@/services/api/insideSales';
import { fetchCollectionStatus } from '@/services/api/insideSales';
import { cn } from '@/utils';
import { formatDuration, formatFrt } from '@/utils/formatters';
import { scoreColor } from '@/utils/scoreUtils';
import { routes } from '@/config/routes';
import { usePageMetadata } from '@/config/pageMetadata';
import { CallFilterPanel } from '../components/CallFilterPanel';
import { NewInsideSalesEvalOverlay } from '@/features/insideSalesEval';
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

function describeSuccessTimestamp(iso: string | null): string {
  if (!iso) return 'not synced yet';
  const syncedAt = new Date(iso);
  const elapsedMs = Date.now() - syncedAt.getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
  if (elapsedMinutes < 1) return 'last success just now';
  if (elapsedMinutes < 60) return `last success ${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `last success ${elapsedHours}h ago`;
  return `last success ${syncedAt.toLocaleString('en-IN')}`;
}

function truncateError(msg: string | null, max = 90): string {
  if (!msg) return 'Retry recommended';
  return msg.length <= max ? msg : `${msg.slice(0, max - 1)}…`;
}

/** Header card describing the synced data the user is looking at.
 *
 * The scheduled inside-sales sync job owns LSQ ingestion; this card
 * reports its outcome and lets the user re-read the synced mirror.
 *
 * Three mutually-exclusive states, in priority order:
 *   1. `failed`   — the most recent scheduled sync failed. Shows the
 *      truncated error so ops can see something is wrong.
 *   2. `idle-ok`  — last sync succeeded; shows how long ago.
 *   3. `idle-empty` — nothing synced yet.
 *
 * Durable status (`status` prop) is sourced from
 * `/api/inside-sales/collections/{family}/status` so the card renders
 * correctly after a page reload. `freshness` is the fallback for the
 * first paint before status lands.
 */
function FreshnessBadge({
  freshness,
  status,
  reloading,
  onReload,
}: {
  freshness: CollectionFreshness | null;
  status: CollectionSyncStatus | null;
  reloading: boolean;
  onReload: () => void;
}) {
  const lastStatus = status?.lastStatus ?? null;
  const lastSuccessAt = status?.lastSuccessAt ?? freshness?.lastSyncedAt ?? null;
  const failed = lastStatus === 'failed';

  let primary: string;
  let secondary: string;
  let tone: 'default' | 'warning' | 'error' = 'default';

  if (failed) {
    primary = 'Last sync failed';
    secondary = truncateError(status?.lastError ?? null);
    tone = 'error';
  } else if (lastSuccessAt) {
    primary = 'Data synced';
    secondary = describeSuccessTimestamp(lastSuccessAt);
    if (freshness?.stale) tone = 'warning';
  } else {
    primary = 'Not synced yet';
    secondary = 'Waiting for the first scheduled sync';
    tone = 'warning';
  }

  const toneClass =
    tone === 'error'
      ? 'text-[var(--color-error)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--text-secondary)]';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-1.5',
        tone === 'error'
          ? 'border-[var(--color-error)]/50 bg-[var(--color-error)]/5'
          : 'border-[var(--border-default)] bg-[var(--bg-secondary)]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className={cn('font-medium whitespace-nowrap', toneClass)}>{primary}</span>
        <span
          className="truncate text-[11px] text-[var(--text-muted)]"
          title={failed ? status?.lastError ?? undefined : undefined}
        >
          {secondary}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onReload}
        disabled={reloading}
        icon={RefreshCcw}
        iconOnly
        aria-label={reloading ? 'Reloading from synced data' : 'Reload from synced data'}
        title="Reload synced data"
        className="shrink-0"
      >
        {reloading ? 'Reloading' : 'Reload'}
      </Button>
    </div>
  );
}

function CollectionToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  filterCount,
  onOpenFilters,
  filterPills,
  trailingContent,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  filterCount: number;
  onOpenFilters: () => void;
  filterPills?: ReactNode;
  trailingContent?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PageHeaderSearch
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          label={searchLabel}
        />
        <FilterButton activeCount={filterCount} onClick={onOpenFilters} iconOnly />
        {filterPills}
      </div>
      {trailingContent ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {trailingContent}
        </div>
      ) : null}
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
  const setLeadsPageSize = useLeadsStore((s) => s.setLeadsPageSize);
  const leadsLoading = useLeadsStore((s) => s.leadsLoading);
  const leadsError = useLeadsStore((s) => s.leadsError);
  const leadFilters = useLeadsStore((s) => s.leadFilters);
  // Local input state so typing stays snappy; debounced write to store.q triggers the backend query.
  const [searchInput, setSearchInput] = useState(leadFilters.q);

  useEffect(() => {
    if (searchInput === leadFilters.q) return;
    const id = setTimeout(() => {
      useLeadsStore.getState().setLeadFilters({ q: searchInput });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, leadFilters.q]);

  const filterKey = `${(leadFilters.agents ?? []).join(',')}|${(leadFilters.stage ?? []).join(',')}|${(leadFilters.condition ?? []).join(',')}|${leadFilters.mqlMin ?? ''}|${(leadFilters.city ?? []).join(',')}|${(leadFilters.leadId ?? []).join(',')}|${(leadFilters.phone ?? []).join(',')}|${(leadFilters.planName ?? []).join(',')}|${(leadFilters.q ?? '').trim()}|${leadsPageSize}|${leadsPage}`;

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
  const filterButtonCount = Math.max(0, activeFilterCount - ((leadFilters.q ?? '').trim().length > 0 ? 1 : 0));

  useEffect(() => {
    useLeadsStore.getState().loadLeads();
  }, [filterKey]);

  const totalPages = Math.max(1, Math.ceil(Math.max(leadsTotal, 1) / leadsPageSize));

  const handleRowClick = useCallback((lead: LeadListRecord) => {
    navigate(routes.insideSales.leadDetail(lead.leadId));
  }, [navigate]);

  const columns = useMemo((): ColumnDef<LeadListRecord>[] => [
    {
      key: 'lead',
      header: 'Lead',
      headerTooltip: 'Name and phone from synced lead records.',
      width: 'min-w-[220px]',
      render: (lead) => (
        <div>
          <div className="font-medium">
            {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
          </div>
          <div className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]">{lead.phone}</div>
        </div>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      headerTooltip: 'Current CRM stage for the lead.',
      width: 'w-[140px]',
      render: (lead) => <StageBadge stage={lead.prospectStage} />,
    },
    {
      key: 'plan',
      header: 'Plan',
      headerTooltip: 'Care plan purchased by this lead. Populated for converted / payment-received leads.',
      width: 'min-w-[180px]',
      render: (lead) => (
        <span
          className="truncate text-[var(--text-secondary)]"
          title={lead.planName ?? undefined}
        >
          {lead.planName ?? '—'}
        </span>
      ),
    },
    {
      key: 'mql',
      header: 'MQL',
      headerTooltip: 'Marketing Qualified Lead score (0–5). One point per signal: age in range, target city, qualifying condition, HbA1c, intent to pay.',
      width: 'w-[120px]',
      render: (lead) => <MqlScoreBadge score={lead.mqlScore} signals={lead.mqlSignals} />,
    },
    {
      key: 'owner',
      header: 'Owner',
      headerTooltip: 'Assigned lead owner in the CRM. May differ from the agent shown in call timeline, who is the person who made each call.',
      width: 'min-w-[150px]',
      render: (lead) => <span className="text-[var(--text-secondary)]">{lead.repName || '—'}</span>,
    },
    {
      key: 'dials',
      header: 'Dials',
      headerTooltip: 'Total call attempts = RNR (no answer) + Answered, computed from synced call activity fields.',
      width: 'w-[90px]',
      render: (lead) => <span className="tabular-nums text-[var(--text-secondary)]">{lead.totalDials > 0 ? lead.totalDials : '—'}</span>,
    },
    {
      key: 'connectRate',
      header: 'Connect %',
      headerTooltip: 'Answered ÷ Total Dials × 100. Blank when no dials recorded.',
      width: 'w-[110px]',
      render: (lead) => <span className="tabular-nums text-[var(--text-secondary)]">{lead.connectRate !== null ? `${Math.round(lead.connectRate)}%` : '—'}</span>,
    },
    {
      key: 'frt',
      header: 'FRT',
      headerTooltip: 'First Response Time: lead creation → first call. Green ≤ 1h, amber ≤ 3h, red > 3h.',
      width: 'w-[100px]',
      render: (lead) => {
        const frt = formatFrt(lead.frtSeconds);
        return <span className={cn('tabular-nums', frt.color || 'text-[var(--text-secondary)]')}>{frt.text}</span>;
      },
    },
    {
      key: 'lastContact',
      header: 'Last Contact',
      headerTooltip: 'Days since most recent call activity. Red if > 7 days (stale) for active leads.',
      width: 'w-[120px]',
      render: (lead) => {
        const lastContact = formatLastContact(lead.daysSinceLastContact);
        const isTerminal = TERMINAL_STAGES.has(lead.prospectStage.toLowerCase());
        return (
          <span
            className={cn(
              'tabular-nums',
              lastContact.isStale && !isTerminal ? 'text-red-400' : 'text-[var(--text-secondary)]',
            )}
          >
            {lastContact.text}
          </span>
        );
      },
    },
  ], []);

  const leadsFilterPillsContent = activeFilterPills.length > 0 ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeFilterPills.map((pill) => (
        <FilterPill
          key={pill.key}
          label={pill.label}
          onRemove={() => useLeadsStore.getState().setLeadFilters(pill.clearPatch)}
        />
      ))}
    </div>
  ) : null;

  const toolbar = useMemo(
    () => (
      <CollectionToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search leads…"
        searchLabel="Search leads"
        filterCount={filterButtonCount}
        onOpenFilters={onOpenFilters}
        filterPills={leadsFilterPillsContent}
      />
    ),
    [
      filterButtonCount,
      onOpenFilters,
      searchInput,
      leadsFilterPillsContent,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      {toolbar}

      {leadsError ? (
        <EmptyState
          icon={Phone}
          title="Failed to load leads"
          description={leadsError}
          action={{ label: 'Retry', onClick: () => useLeadsStore.getState().loadLeads() }}
          fill
        />
      ) : (
        <DataTable
          columns={columns}
          data={leads}
          keyExtractor={(lead) => lead.leadId}
          onRowClick={handleRowClick}
          loading={leadsLoading}
          emptyIcon={Phone}
          emptyTitle={emptyState?.title ?? 'No leads found'}
          emptyDescription={emptyState?.description ?? 'No leads for the selected date range and filters.'}
          pagination={{
            page: leadsPage,
            totalPages,
            onPageChange: (nextPage) => useLeadsStore.getState().setLeadsPage(nextPage),
            onPageSizeChange: setLeadsPageSize,
            showCount: true,
            totalItems: leadsTotal,
            pageSize: leadsPageSize,
          }}
        />
      )}
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
  const { icon, title } = usePageMetadata('listing');
  const leadDatasetConfig = appConfig.collections.datasets.leads;
  const callDatasetConfig = appConfig.collections.datasets.calls;
  const navigate = useNavigate();
  const calls = useInsideSalesStore((s) => s.calls);
  const total = useInsideSalesStore((s) => s.total);
  const page = useInsideSalesStore((s) => s.page);
  const pageSize = useInsideSalesStore((s) => s.pageSize);
  const setPageSize = useInsideSalesStore((s) => s.setPageSize);
  const callsFreshness = useInsideSalesStore((s) => s.freshness);
  const isLoading = useInsideSalesStore((s) => s.isLoading);
  const error = useInsideSalesStore((s) => s.error);
  const filters = useInsideSalesStore((s) => s.filters);
  const selectedCallIds = useInsideSalesStore((s) => s.selectedCallIds);
  const leadsFreshness = useLeadsStore((s) => s.leadsFreshness);
  const leadsLoading = useLeadsStore((s) => s.leadsLoading);

  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [evalOverlayOpen, setEvalOverlayOpen] = useState(false);
  // Active tab is URL-driven via `?tab=leads|calls` so deep links (and the
  // back-arrow from detail pages) can land on the right tab without
  // hardcoded assumptions about a default.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: 'leads' | 'calls' = tabParam === 'calls' ? 'calls' : 'leads';
  const setActiveTab = (next: 'leads' | 'calls') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'leads') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [callSearch, setCallSearch] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(typeof Audio !== 'undefined' ? new Audio() : null);

  // Stable key from filter values + page — only re-fetch when these actually change
  const filterKey = [
    (filters.agents ?? []).join(','),
    (filters.leadId ?? []).join(','),
    filters.direction ?? '',
    filters.status ?? '',
    filters.hasRecording ? 'recording' : '',
    filters.durationMin,
    filters.durationMax,
    filters.eventCodes,
    pageSize,
    page,
  ].join('|');

  useEffect(() => {
    if (activeTab !== 'calls') return;
    useInsideSalesStore.getState().loadCalls();
  }, [activeTab, filterKey]);

  // Cleanup audio on unmount
  useEffect(() => {
    const audioEl = audioElRef.current;
    return () => {
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
      }
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Client-side search only; server-side filters own dataset counts and pagination.
  const filteredCalls = useMemo(() => {
    const q = callSearch.toLowerCase().trim();
    if (q) {
      return calls.filter(
        (c) =>
          c.repName.toLowerCase().includes(q) ||
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
      const audioEl = audioElRef.current;
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
    [playingId]
  );

  const handleRefresh = useCallback(async () => {
    // Local data is kept current by the scheduled inside-sales sync job;
    // this button just re-reads the synced mirror so the view picks up
    // any rows the scheduler has landed since the page first loaded.
    if (activeTab === 'calls') {
      await useInsideSalesStore.getState().loadCalls(true);
      return;
    }
    await useLeadsStore.getState().loadLeads(true);
  }, [activeTab]);

  const [callsStatus, setCallsStatus] = useState<CollectionSyncStatus | null>(null);
  const [leadsStatus, setLeadsStatus] = useState<CollectionSyncStatus | null>(null);
  const activeStatus = activeTab === 'calls' ? callsStatus : leadsStatus;

  // Pull durable status when the tab becomes active. The scheduler owns
  // sync runs, so the badge no longer has a job-id signal to react to —
  // the periodic re-fetch below keeps it eventually-consistent.
  useEffect(() => {
    let cancelled = false;
    const family: 'calls' | 'leads' = activeTab === 'calls' ? 'calls' : 'leads';
    fetchCollectionStatus(family)
      .then((data) => {
        if (cancelled) return;
        if (family === 'calls') setCallsStatus(data);
        else setLeadsStatus(data);
      })
      .catch(() => {
        // Status is advisory — if it fails we fall back to ephemeral freshness.
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const callsFilterPillsContent = activeFilterPills.length > 0 ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeFilterPills.map((pill) => (
        <FilterPill
          key={pill.key}
          label={pill.label}
          onRemove={() => useInsideSalesStore.getState().setFilters(pill.clearPatch)}
        />
      ))}
    </div>
  ) : null;

  const callsToolbar = useMemo(() => {
    const trailingContent =
      selectedCallIds.size > 0 ? (
        <>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{selectedCallIds.size} selected</span>
          <Button
            variant="secondary"
            size="sm"
            icon={X}
            iconOnly
            onClick={() => useInsideSalesStore.getState().deselectAll()}
            aria-label="Clear call selection"
            title="Clear call selection"
          >
            Clear selection
          </Button>
          <PermissionGate action="evaluation:run">
            <Button size="sm" onClick={() => setEvalOverlayOpen(true)}>
              Evaluate Selected
            </Button>
          </PermissionGate>
        </>
      ) : undefined;

    return (
      <CollectionToolbar
        searchValue={callSearch}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search calls…"
        searchLabel="Search calls"
        filterCount={activeFilterCount}
        onOpenFilters={() => setFilterPanelOpen(true)}
        filterPills={callsFilterPillsContent}
        trailingContent={trailingContent}
      />
    );
  }, [
    activeFilterCount,
    callSearch,
    callsFilterPillsContent,
    handleSearchChange,
    selectedCallIds.size,
  ]);

  const callColumns = useMemo((): ColumnDef<CallRecord>[] => [
    {
      key: 'selected',
      header: (
        <input
          type="checkbox"
          checked={filteredCalls.length > 0 && filteredCalls.every((call) => selectedCallIds.has(call.activityId))}
          onChange={handleSelectAll}
          className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
          aria-label="Select all visible calls"
        />
      ),
      width: 'w-8',
      headerClassName: 'px-2',
      cellClassName: 'w-8 px-2',
      render: (call) => (
        <input
          type="checkbox"
          checked={selectedCallIds.has(call.activityId)}
          onClick={(event) => handleToggleSelect(call.activityId, event)}
          onChange={() => {}}
          className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
          aria-label={`Select call ${call.activityId}`}
        />
      ),
    },
    {
      key: 'callStartTime',
      header: 'Date / Time',
      headerTooltip: 'Start time of the synced call activity.',
      width: 'min-w-[150px]',
      render: (call) => <span className="whitespace-nowrap text-[var(--text-primary)]">{formatCallTime(call.callStartTime)}</span>,
    },
    {
      key: 'repName',
      header: 'Rep Name',
      headerTooltip: 'Sales rep who handled this call.',
      width: 'min-w-[150px]',
      render: (call) => <span className="text-[var(--text-primary)]">{call.repName || '—'}</span>,
    },
    {
      key: 'leadId',
      header: 'Lead ID',
      headerTooltip: 'CRM lead identifier linked to the call.',
      width: 'min-w-[130px]',
      render: (call) => <span className="font-mono text-[var(--text-secondary)]">{call.leadId || '—'}</span>,
    },
    {
      key: 'durationSeconds',
      header: 'Duration',
      headerTooltip: 'Connected call duration in seconds.',
      width: 'w-[100px]',
      render: (call) => (
        <span className="whitespace-nowrap text-[var(--text-secondary)]">
          {call.durationSeconds > 0 ? formatDuration(call.durationSeconds) : '—'}
        </span>
      ),
    },
    {
      key: 'lastEvalScore',
      header: 'Score',
      headerTooltip: 'Latest evaluation score for the call when available.',
      width: 'w-[80px]',
      render: (call) =>
        call.evalCount && call.evalCount > 0 ? (
          <span style={{ color: scoreColor(call.lastEvalScore ?? null) }} className="font-mono font-semibold">
            {call.lastEvalScore !== null && call.lastEvalScore !== undefined ? Math.round(call.lastEvalScore) : '—'}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'direction',
      header: 'Direction',
      headerTooltip: 'Inbound or outbound call direction.',
      width: 'w-[110px]',
      render: (call) => <DirectionBadge direction={call.direction} />,
    },
    {
      key: 'status',
      header: 'Status',
      headerTooltip: 'Answered calls connected successfully; missed calls did not connect.',
      width: 'w-[110px]',
      render: (call) => <StatusBadge status={call.status} />,
    },
    {
      key: 'recording',
      header: '',
      width: 'w-[56px]',
      cellClassName: 'w-[56px]',
      render: (call) =>
        call.recordingUrl ? (
          <button
            onClick={(event) => handlePlayToggle(call, event)}
            className={cn(
              'rounded-full p-1.5 transition-colors',
              playingId === call.activityId
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)] hover:bg-[var(--color-brand-accent)]/25'
            )}
            title={playingId === call.activityId ? 'Stop' : 'Play'}
            aria-label={playingId === call.activityId ? 'Stop call recording' : 'Play call recording'}
          >
            {playingId === call.activityId ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
  ], [
    filteredCalls,
    handlePlayToggle,
    handleSelectAll,
    handleToggleSelect,
    playingId,
    selectedCallIds,
  ]);

  const tableContent = (
    <div className="flex h-full flex-col">
      {callsToolbar}

      {error ? (
        <EmptyState
          icon={Phone}
          title="Failed to load calls"
          description={error}
          action={{ label: 'Retry', onClick: () => useInsideSalesStore.getState().loadCalls() }}
          fill
        />
      ) : (
        <DataTable
          columns={callColumns}
          data={filteredCalls}
          keyExtractor={(call) => call.activityId}
          onRowClick={handleRowClick}
          loading={isLoading}
          emptyIcon={Phone}
          emptyTitle={callSearch ? 'No matching calls' : (callDatasetConfig.emptyState?.title ?? 'No calls found')}
          emptyDescription={
            callSearch
              ? 'Try adjusting your search terms.'
              : (callDatasetConfig.emptyState?.description ?? 'No call activities for the selected date range.')
          }
          pagination={{
            page,
            totalPages,
            onPageChange: handlePageChange,
            onPageSizeChange: setPageSize,
            showCount: true,
            totalItems: total,
            pageSize,
          }}
        />
      )}
    </div>
  );

  return (
    <PageSurface
      icon={icon}
      title={title}
      actions={
        <FreshnessBadge
          freshness={activeTab === 'calls' ? callsFreshness : leadsFreshness}
          status={activeStatus}
          reloading={activeTab === 'calls' ? isLoading : leadsLoading}
          onReload={handleRefresh}
        />
      }
    >
      <Tabs
        tabs={[
          {
            id: 'leads',
            label: 'Leads',
            content: (
              <LeadsTableContent
                onOpenFilters={() => setFilterPanelOpen(true)}
                emptyState={leadDatasetConfig.emptyState}
              />
            ),
          },
          { id: 'calls', label: 'All Calls', content: tableContent },
        ]}
        defaultTab={activeTab}
        onChange={(id) => setActiveTab(id as 'leads' | 'calls')}
        mountStrategy="active-only"
        fillHeight
        className="flex-1 min-h-0"
      />

      <CallFilterPanel
        isOpen={filterPanelOpen}
        activeTab={activeTab}
        onClose={() => setFilterPanelOpen(false)}
      />

      {evalOverlayOpen && (
        <NewInsideSalesEvalOverlay
          onClose={() => setEvalOverlayOpen(false)}
          preSelectedCallIds={[...selectedCallIds]}
          preSelectedFilters={filters}
          prefillContext={{ kind: 'listing' }}
        />
      )}
    </PageSurface>
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
