import { create } from 'zustand';
import { fetchCalls as apiFetchCalls, fetchLeads as apiFetchLeads } from '@/services/api/insideSales';
import type { CallRecord, CallFilters, LeadListRecord, LeadFilters } from '@/services/api/insideSales';

interface InsideSalesState {
  calls: CallRecord[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  filters: CallFilters;
  selectedCallIds: Set<string>;
  _lastFetchKey: string;
  /** Page cache: filterHash → { pageNum: records[] }. Cleared on filter change. */
  _callsCache: Record<string, Record<number, CallRecord[]>>;
  activeCall: CallRecord | null;
  setActiveCall: (call: CallRecord | null) => void;

  setFilters: (filters: Partial<CallFilters>) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  toggleCallSelection: (activityId: string) => void;
  selectAllOnPage: () => void;
  deselectAll: () => void;
  loadCalls: (force?: boolean) => Promise<void>;
  reset: () => void;
}

function todayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

const DEFAULT_FILTERS: CallFilters = {
  dateFrom: daysAgoDateString(7) + ' 00:00:00',
  dateTo: todayDateString() + ' 23:59:59',
  agents: [],
  prospectId: '',
  direction: '',
  status: '',
  hasRecording: false,
  eventCodes: '',
  evalStatus: '',
  durationMin: '',
  durationMax: '',
  scoreMin: '',
  scoreMax: '',
  search: '',
};

export const useInsideSalesStore = create<InsideSalesState>((set, get) => ({
  calls: [],
  total: 0,
  page: 1,
  pageSize: 50,
  isLoading: false,
  error: null,
  filters: { ...DEFAULT_FILTERS },
  selectedCallIds: new Set(),
  _lastFetchKey: '',
  _callsCache: {},
  activeCall: null,

  setActiveCall: (call) => set({ activeCall: call }),

  setFilters: (updates) =>
    set((s) => ({ filters: { ...s.filters, ...updates }, page: 1, _callsCache: {} })),

  clearFilters: () => set({ filters: { ...DEFAULT_FILTERS }, page: 1, _callsCache: {} }),

  setPage: (page) => set({ page }),

  toggleCallSelection: (activityId) =>
    set((s) => {
      const next = new Set(s.selectedCallIds);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return { selectedCallIds: next };
    }),

  selectAllOnPage: () =>
    set((s) => ({
      selectedCallIds: new Set(s.calls.map((c) => c.activityId)),
    })),

  deselectAll: () => set({ selectedCallIds: new Set() }),

  loadCalls: async (force?: boolean) => {
    const { filters, page, pageSize, _lastFetchKey, _callsCache } = get();
    const filterHash = [
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
    const fetchKey = `${filterHash}|${page}`;

    if (!force && fetchKey === _lastFetchKey) return;

    // Serve from cache (e.g. navigating back to a previously loaded page)
    const cached = _callsCache[filterHash]?.[page];
    if (!force && cached) {
      set({ calls: cached, _lastFetchKey: fetchKey });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const data = await apiFetchCalls(filters, page, pageSize);

      set((s) => ({
        calls: data.calls,
        total: data.total,
        isLoading: false,
        _lastFetchKey: fetchKey,
        _callsCache: {
          ...s._callsCache,
          [filterHash]: { ...s._callsCache[filterHash], [page]: data.calls },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Failed to load calls';
      set({ error: msg, isLoading: false });
    }
  },

  reset: () =>
    set({
      calls: [],
      total: 0,
      page: 1,
      isLoading: false,
      error: null,
      filters: { ...DEFAULT_FILTERS },
      selectedCallIds: new Set(),
      _lastFetchKey: '',
      _callsCache: {},
      activeCall: null,
    }),
}));

// Re-export types so pages can import from one place
export type { LeadListRecord, LeadFilters };

const DEFAULT_LEAD_FILTERS: LeadFilters = {
  dateFrom: daysAgoDateString(7) + ' 00:00:00',
  dateTo: todayDateString() + ' 23:59:59',
  agents: [],
  stage: [],
  mqlMin: '',
  condition: [],
  city: [],
  prospectId: '',
};

interface LeadsState {
  leads: LeadListRecord[];
  leadsTotal: number;
  leadsPage: number;
  leadsPageSize: number;
  leadsLoading: boolean;
  leadsError: string | null;
  leadFilters: LeadFilters;

  _lastLeadsFetchKey: string;
  /** Page cache: filterHash → { pageNum: records[] }. Cleared on filter change. */
  _leadsCache: Record<string, Record<number, LeadListRecord[]>>;

  setLeadFilters: (updates: Partial<LeadFilters>) => void;
  clearLeadFilters: () => void;
  setLeadsPage: (page: number) => void;
  loadLeads: (force?: boolean) => Promise<void>;
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  leadsTotal: 0,
  leadsPage: 1,
  leadsPageSize: 50,
  leadsLoading: false,
  leadsError: null,
  leadFilters: { ...DEFAULT_LEAD_FILTERS },
  _lastLeadsFetchKey: '',
  _leadsCache: {},

  setLeadFilters: (updates) =>
    set((s) => ({ leadFilters: { ...s.leadFilters, ...updates }, leadsPage: 1, _leadsCache: {} })),

  clearLeadFilters: () =>
    set({ leadFilters: { ...DEFAULT_LEAD_FILTERS }, leadsPage: 1, _lastLeadsFetchKey: '', _leadsCache: {} }),

  setLeadsPage: (page) => set({ leadsPage: page }),

  loadLeads: async (force?: boolean) => {
    const { leadFilters, leadsPage, leadsPageSize, _lastLeadsFetchKey, _leadsCache } = get();
    const filterHash = [
      leadFilters.dateFrom,
      leadFilters.dateTo,
      leadFilters.agents.join(','),
      leadFilters.stage.join(','),
      leadFilters.condition.join(','),
      leadFilters.mqlMin,
      leadFilters.city.join(','),
      leadFilters.prospectId,
      leadsPageSize,
    ].join('|');
    const fetchKey = `${filterHash}|${leadsPage}`;

    if (!force && fetchKey === _lastLeadsFetchKey) return;

    const cached = _leadsCache[filterHash]?.[leadsPage];
    if (!force && cached) {
      set({ leads: cached, _lastLeadsFetchKey: fetchKey });
      return;
    }

    set({ leadsLoading: true, leadsError: null });
    try {
      const data = await apiFetchLeads(leadFilters, leadsPage, leadsPageSize);
      set((s) => ({
        leads: data.leads,
        leadsTotal: data.total,
        leadsLoading: false,
        _lastLeadsFetchKey: fetchKey,
        _leadsCache: {
          ...s._leadsCache,
          [filterHash]: { ...s._leadsCache[filterHash], [leadsPage]: data.leads },
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load leads';
      set({ leadsError: msg, leadsLoading: false });
    }
  },
}));
