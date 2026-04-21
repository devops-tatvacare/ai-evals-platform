import { create } from 'zustand';
import { jobsApi } from '@/services/api/jobsApi';
import { isTerminalJobStatus } from '@/services/api/jobPolling';
import {
  fetchCalls as apiFetchCalls,
  fetchLeads as apiFetchLeads,
  refreshInsideSalesCollection,
} from '@/services/api/insideSales';
import type {
  CallFilters,
  CallListResponse,
  CallRecord,
  CollectionFreshness,
  LeadFilters,
  LeadListRecord,
  LeadListResponse,
} from '@/services/api/insideSales';

type CallsCacheEntry = Pick<CallListResponse, 'calls' | 'total' | 'page' | 'pageSize' | 'freshness'>;
type LeadsCacheEntry = Pick<LeadListResponse, 'leads' | 'total' | 'page' | 'pageSize' | 'freshness'>;

function buildCallsFilterHash(filters: CallFilters, pageSize: number): string {
  return [
    filters.dateFrom,
    filters.dateTo,
    filters.agents.join(','),
    filters.prospectId,
    filters.direction,
    filters.status,
    filters.hasRecording ? 'recording' : '',
    filters.eventCodes,
    filters.durationMin,
    filters.durationMax,
    pageSize,
  ].join('|');
}

function buildLeadsFilterHash(filters: LeadFilters, pageSize: number): string {
  return [
    filters.dateFrom,
    filters.dateTo,
    filters.agents,
    filters.stage.join(','),
    filters.condition.join(','),
    filters.mqlMin,
    filters.city,
    filters.prospectId,
    pageSize,
  ].join('|');
}

function markFreshnessSyncing(current: CollectionFreshness | null): CollectionFreshness {
  return {
    lastSyncedAt: current?.lastSyncedAt ?? null,
    syncInProgress: true,
    stale: current?.stale ?? true,
  };
}

interface InsideSalesState {
  calls: CallRecord[];
  total: number;
  page: number;
  pageSize: number;
  freshness: CollectionFreshness | null;
  isLoading: boolean;
  error: string | null;
  isRefreshing: boolean;
  refreshError: string | null;
  refreshJobId: string | null;
  filters: CallFilters;
  selectedCallIds: Set<string>;
  _lastFetchKey: string;
  _pendingFetchKey: string | null;
  /** Page cache: filterHash → { pageNum: records[] }. Cleared on filter change. */
  _callsCache: Record<string, Record<number, CallsCacheEntry>>;
  activeCall: CallRecord | null;
  setActiveCall: (call: CallRecord | null) => void;

  setFilters: (filters: Partial<CallFilters>) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  toggleCallSelection: (activityId: string) => void;
  replaceCallSelection: (activityIds: string[]) => void;
  selectAllOnPage: () => void;
  deselectAll: () => void;
  loadCalls: (force?: boolean) => Promise<void>;
  refreshCalls: () => Promise<string | null>;
  pollCallsRefresh: () => Promise<boolean>;
  reset: () => void;
}

// Browser-local `YYYY-MM-DD`; avoids the UTC `toISOString()` shift that flips
// "today" at 5:30 AM IST for tenants operating in India.
function formatLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocalDateString(): string {
  return formatLocalDateString(new Date());
}

function daysAgoLocalDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatLocalDateString(d);
}

const DEFAULT_FILTERS: CallFilters = {
  dateFrom: daysAgoLocalDateString(7) + ' 00:00:00',
  dateTo: todayLocalDateString() + ' 23:59:59',
  agents: [],
  prospectId: '',
  direction: '',
  status: '',
  hasRecording: false,
  eventCodes: '',
  durationMin: '',
  durationMax: '',
};

export const useInsideSalesStore = create<InsideSalesState>((set, get) => ({
  calls: [],
  total: 0,
  page: 1,
  pageSize: 50,
  freshness: null,
  isLoading: false,
  error: null,
  isRefreshing: false,
  refreshError: null,
  refreshJobId: null,
  filters: { ...DEFAULT_FILTERS },
  selectedCallIds: new Set(),
  _lastFetchKey: '',
  _pendingFetchKey: null,
  _callsCache: {},
  activeCall: null,

  setActiveCall: (call) => set({ activeCall: call }),

  setFilters: (updates) =>
    set((s) => ({
      filters: { ...s.filters, ...updates },
      page: 1,
      _callsCache: {},
      _lastFetchKey: '',
      _pendingFetchKey: null,
    })),

  clearFilters: () => set({
    filters: { ...DEFAULT_FILTERS },
    page: 1,
    _callsCache: {},
    _lastFetchKey: '',
    _pendingFetchKey: null,
  }),

  setPage: (page) => set({ page }),

  toggleCallSelection: (activityId) =>
    set((s) => {
      const next = new Set(s.selectedCallIds);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return { selectedCallIds: next };
    }),

  replaceCallSelection: (activityIds) =>
    set({ selectedCallIds: new Set(activityIds) }),

  selectAllOnPage: () =>
    set((s) => ({
      selectedCallIds: new Set(s.calls.map((c) => c.activityId)),
    })),

  deselectAll: () => set({ selectedCallIds: new Set() }),

  loadCalls: async (force?: boolean) => {
    const { filters, page, pageSize, _lastFetchKey, _pendingFetchKey, _callsCache } = get();
    const filterHash = buildCallsFilterHash(filters, pageSize);
    const fetchKey = `${filterHash}|${page}`;

    if (!force && fetchKey === _lastFetchKey) return;
    if (!force && fetchKey === _pendingFetchKey) return;

    // Serve from cache (e.g. navigating back to a previously loaded page)
    const cached = _callsCache[filterHash]?.[page];
    if (!force && cached) {
      set({
        calls: cached.calls,
        total: cached.total,
        pageSize: cached.pageSize,
        freshness: cached.freshness,
        _lastFetchKey: fetchKey,
      });
      return;
    }

    set({ isLoading: true, error: null, _pendingFetchKey: fetchKey });
    try {
      const data = await apiFetchCalls(filters, page, pageSize);

      set((s) => ({
        calls: data.calls,
        total: data.total,
        pageSize: data.pageSize,
        freshness: data.freshness,
        isLoading: false,
        _lastFetchKey: fetchKey,
        _pendingFetchKey: null,
        _callsCache: {
          ...s._callsCache,
          [filterHash]: {
            ...s._callsCache[filterHash],
            [page]: {
              calls: data.calls,
              total: data.total,
              page: data.page,
              pageSize: data.pageSize,
              freshness: data.freshness,
            },
          },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Failed to load calls';
      set({ error: msg, isLoading: false, _pendingFetchKey: null });
    }
  },

  refreshCalls: async () => {
    const { filters } = get();
    set((s) => ({
      isRefreshing: true,
      refreshError: null,
      refreshJobId: null,
      _callsCache: {},
      _lastFetchKey: '',
      _pendingFetchKey: null,
      freshness: markFreshnessSyncing(s.freshness),
    }));
    try {
      const response = await refreshInsideSalesCollection('calls', {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        eventCodes: filters.eventCodes,
      });
      set((s) => ({
        refreshJobId: response.jobId,
        freshness: markFreshnessSyncing(s.freshness),
      }));
      return response.jobId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to queue calls refresh';
      set({ isRefreshing: false, refreshError: msg });
      return null;
    }
  },

  pollCallsRefresh: async () => {
    const { refreshJobId } = get();
    if (!refreshJobId) return false;
    const job = await jobsApi.get(refreshJobId);
    if (!isTerminalJobStatus(job.status)) {
      return true;
    }

    set((s) => ({
      isRefreshing: false,
      refreshJobId: null,
      refreshError: job.status === 'completed' ? null : (job.errorMessage ?? 'Calls refresh failed'),
      freshness: s.freshness ? { ...s.freshness, syncInProgress: false } : s.freshness,
    }));
    await get().loadCalls(true);
    return false;
  },

  reset: () =>
    set({
      calls: [],
      total: 0,
      page: 1,
      freshness: null,
      isLoading: false,
      error: null,
      isRefreshing: false,
      refreshError: null,
      refreshJobId: null,
      filters: { ...DEFAULT_FILTERS },
      selectedCallIds: new Set(),
      _lastFetchKey: '',
      _pendingFetchKey: null,
      _callsCache: {},
      activeCall: null,
    }),
}));

// Re-export types so pages can import from one place
export type { CallRecord, CallFilters, LeadListRecord, LeadFilters };

const DEFAULT_LEAD_FILTERS: LeadFilters = {
  dateFrom: daysAgoLocalDateString(30) + ' 00:00:00',
  dateTo: todayLocalDateString() + ' 23:59:59',
  agents: '',
  stage: [],
  mqlMin: '',
  condition: [],
  city: '',
  prospectId: '',
};

interface LeadsState {
  leads: LeadListRecord[];
  leadsTotal: number;
  leadsPage: number;
  leadsPageSize: number;
  leadsFreshness: CollectionFreshness | null;
  leadsLoading: boolean;
  leadsError: string | null;
  leadsRefreshing: boolean;
  leadsRefreshError: string | null;
  leadsRefreshJobId: string | null;
  leadFilters: LeadFilters;

  _lastLeadsFetchKey: string;
  _pendingLeadsFetchKey: string | null;
  /** Page cache: filterHash → { pageNum: records[] }. Cleared on filter change. */
  _leadsCache: Record<string, Record<number, LeadsCacheEntry>>;

  setLeadFilters: (updates: Partial<LeadFilters>) => void;
  clearLeadFilters: () => void;
  setLeadsPage: (page: number) => void;
  loadLeads: (force?: boolean) => Promise<void>;
  refreshLeads: () => Promise<string | null>;
  pollLeadsRefresh: () => Promise<boolean>;
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  leadsTotal: 0,
  leadsPage: 1,
  leadsPageSize: 50,
  leadsFreshness: null,
  leadsLoading: false,
  leadsError: null,
  leadsRefreshing: false,
  leadsRefreshError: null,
  leadsRefreshJobId: null,
  leadFilters: { ...DEFAULT_LEAD_FILTERS },
  _lastLeadsFetchKey: '',
  _pendingLeadsFetchKey: null,
  _leadsCache: {},

  setLeadFilters: (updates) =>
    set((s) => ({
      leadFilters: { ...s.leadFilters, ...updates },
      leadsPage: 1,
      _leadsCache: {},
      _lastLeadsFetchKey: '',
      _pendingLeadsFetchKey: null,
    })),

  clearLeadFilters: () =>
    set({
      leadFilters: { ...DEFAULT_LEAD_FILTERS },
      leadsPage: 1,
      _lastLeadsFetchKey: '',
      _pendingLeadsFetchKey: null,
      _leadsCache: {},
    }),

  setLeadsPage: (page) => set({ leadsPage: page }),

  loadLeads: async (force?: boolean) => {
    const { leadFilters, leadsPage, leadsPageSize, _lastLeadsFetchKey, _pendingLeadsFetchKey, _leadsCache } = get();
    const filterHash = buildLeadsFilterHash(leadFilters, leadsPageSize);
    const fetchKey = `${filterHash}|${leadsPage}`;

    if (!force && fetchKey === _lastLeadsFetchKey) return;
    if (!force && fetchKey === _pendingLeadsFetchKey) return;

    const cached = _leadsCache[filterHash]?.[leadsPage];
    if (!force && cached) {
      set({
        leads: cached.leads,
        leadsTotal: cached.total,
        leadsPageSize: cached.pageSize,
        leadsFreshness: cached.freshness,
        _lastLeadsFetchKey: fetchKey,
      });
      return;
    }

    set({ leadsLoading: true, leadsError: null, _pendingLeadsFetchKey: fetchKey });
    try {
      const data = await apiFetchLeads(leadFilters, leadsPage, leadsPageSize);
      set((s) => ({
        leads: data.leads,
        leadsTotal: data.total,
        leadsPageSize: data.pageSize,
        leadsFreshness: data.freshness,
        leadsLoading: false,
        _lastLeadsFetchKey: fetchKey,
        _pendingLeadsFetchKey: null,
        _leadsCache: {
          ...s._leadsCache,
          [filterHash]: {
            ...s._leadsCache[filterHash],
            [leadsPage]: {
              leads: data.leads,
              total: data.total,
              page: data.page,
              pageSize: data.pageSize,
              freshness: data.freshness,
            },
          },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load leads';
      set({ leadsError: msg, leadsLoading: false, _pendingLeadsFetchKey: null });
    }
  },

  refreshLeads: async () => {
    const { leadFilters } = get();
    set((s) => ({
      leadsRefreshing: true,
      leadsRefreshError: null,
      leadsRefreshJobId: null,
      _leadsCache: {},
      _lastLeadsFetchKey: '',
      _pendingLeadsFetchKey: null,
      leadsFreshness: markFreshnessSyncing(s.leadsFreshness),
    }));
    try {
      const response = await refreshInsideSalesCollection('leads', {
        dateFrom: leadFilters.dateFrom,
        dateTo: leadFilters.dateTo,
      });
      set((s) => ({
        leadsRefreshJobId: response.jobId,
        leadsFreshness: markFreshnessSyncing(s.leadsFreshness),
      }));
      return response.jobId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to queue leads refresh';
      set({ leadsRefreshing: false, leadsRefreshError: msg });
      return null;
    }
  },

  pollLeadsRefresh: async () => {
    const { leadsRefreshJobId } = get();
    if (!leadsRefreshJobId) return false;
    const job = await jobsApi.get(leadsRefreshJobId);
    if (!isTerminalJobStatus(job.status)) {
      return true;
    }

    set((s) => ({
      leadsRefreshing: false,
      leadsRefreshJobId: null,
      leadsRefreshError: job.status === 'completed' ? null : (job.errorMessage ?? 'Leads refresh failed'),
      leadsFreshness: s.leadsFreshness ? { ...s.leadsFreshness, syncInProgress: false } : s.leadsFreshness,
    }));
    await get().loadLeads(true);
    return false;
  },
}));
