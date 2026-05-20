/**
 * Cost & usage dashboard store. Lazy load with skip-if-ready, explicit refresh,
 * per-slice `filtersKey` tracking so stale slices re-fetch on next visit.
 * Zero TTL, zero background revalidation — slice idle + tab active is the only trigger.
 */
import { create } from 'zustand';
import { costApi } from '@/services/api/costApi';
import { ApiError } from '@/services/api/client';
import { notificationService } from '@/services/notifications';
import type {
  CallDetail,
  CallsPage,
  CostFilters,
  CostOverview,
  EfficiencyBundle,
  EntityCostBreakdown,
  EntityListPage,
  OwnerType,
  PricingBundle,
  PricingCreatePayload,
  PricingPatchPayload,
  RefreshDiff,
  SpendBundle,
  UnpricedBackfillResponse,
} from '@/features/cost/types';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface Slice<T> {
  status: Status;
  data?: T;
  error?: string;
  filtersKey?: string;
}

type SliceName = 'overview' | 'spend' | 'entities' | 'calls' | 'efficiency' | 'pricing';

const DEFAULT_FILTERS: CostFilters = { range: '7d' };

function hashFilters(filters: CostFilters): string {
  return [
    filters.range ?? '7d',
    filters.appId ?? '',
    filters.provider ?? '',
    filters.model ?? '',
  ].join('|');
}

function initialSlice<T>(): Slice<T> {
  return { status: 'idle' };
}

/** Compose a slice-level cache key from the global filtersKey plus an
 * extra scope like ``searchQuery``. Keeps slice-specific state (e.g. the
 * Calls text search) from clobbering other tabs' caches. */
function makeSliceKey(filtersKey: string, extra: string): string {
  return extra ? `${filtersKey}|q=${extra}` : filtersKey;
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error) return e.message;
  return fallback;
}

interface CostState {
  filters: CostFilters;
  filtersKey: string;

  overview: Slice<CostOverview>;
  spend: Slice<SpendBundle>;
  entities: Slice<EntityListPage> & { page: number; searchQuery: string };
  calls: Slice<CallsPage> & { page: number; searchQuery: string };
  efficiency: Slice<EfficiencyBundle>;
  pricing: Slice<PricingBundle>;

  entityCache: Record<string, EntityCostBreakdown>;
  callDetailCache: Record<string, CallDetail>;

  setFilters: (patch: Partial<CostFilters>) => void;

  loadOverview: () => Promise<void>;
  loadSpend: () => Promise<void>;
  loadEfficiency: () => Promise<void>;
  loadEntities: (page?: number) => Promise<void>;
  loadCalls: (page?: number) => Promise<void>;
  setEntitiesSearch: (query: string) => void;
  setCallsSearch: (query: string) => void;
  loadPricing: () => Promise<void>;

  refreshActive: (slice: SliceName) => Promise<void>;

  loadEntity: (ownerType: OwnerType, ownerId: string) => Promise<EntityCostBreakdown | null>;
  loadCallDetail: (callId: string) => Promise<CallDetail | null>;

  createPricing: (payload: PricingCreatePayload) => Promise<void>;
  patchPricing: (pricingId: string, payload: PricingPatchPayload) => Promise<void>;
  refreshFromModelsDev: () => Promise<RefreshDiff>;
  backfillUnpricedUsage: (opts?: { allTenants?: boolean }) => Promise<UnpricedBackfillResponse>;

  reset: () => void;
}

export const useCostStore = create<CostState>((set, get) => ({
  filters: DEFAULT_FILTERS,
  filtersKey: hashFilters(DEFAULT_FILTERS),

  overview: initialSlice<CostOverview>(),
  spend: initialSlice<SpendBundle>(),
  entities: { ...initialSlice<EntityListPage>(), page: 1, searchQuery: '' },
  calls: { ...initialSlice<CallsPage>(), page: 1, searchQuery: '' },
  efficiency: initialSlice<EfficiencyBundle>(),
  pricing: initialSlice<PricingBundle>(),

  entityCache: {},
  callDetailCache: {},

  setFilters: (patch) => {
    const next = { ...get().filters, ...patch };
    const nextKey = hashFilters(next);
    if (nextKey === get().filtersKey) return;
    set({
      filters: next,
      filtersKey: nextKey,
      overview: initialSlice(),
      spend: initialSlice(),
      entities: { ...initialSlice<EntityListPage>(), page: 1, searchQuery: '' },
      calls: { ...initialSlice<CallsPage>(), page: 1, searchQuery: '' },
      efficiency: initialSlice(),
      entityCache: {},
      callDetailCache: {},
    });
  },

  loadOverview: async () => {
    const { overview, filters, filtersKey } = get();
    if (overview.status === 'loading') return;
    if (overview.status === 'ready' && overview.filtersKey === filtersKey) return;

    set({ overview: { ...overview, status: 'loading', error: undefined } });
    try {
      const data = await costApi.fetchOverview(filters);
      set({ overview: { status: 'ready', data, filtersKey } });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load overview');
      set({ overview: { status: 'error', error: msg, filtersKey } });
      notificationService.error(msg);
    }
  },

  loadSpend: async () => {
    const { spend, filters, filtersKey } = get();
    if (spend.status === 'loading') return;
    if (spend.status === 'ready' && spend.filtersKey === filtersKey) return;

    set({ spend: { ...spend, status: 'loading', error: undefined } });
    try {
      const data = await costApi.fetchSpend(filters);
      set({ spend: { status: 'ready', data, filtersKey } });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load spend');
      set({ spend: { status: 'error', error: msg, filtersKey } });
      notificationService.error(msg);
    }
  },

  loadEfficiency: async () => {
    const { efficiency, filters, filtersKey } = get();
    if (efficiency.status === 'loading') return;
    if (efficiency.status === 'ready' && efficiency.filtersKey === filtersKey) return;

    set({ efficiency: { ...efficiency, status: 'loading', error: undefined } });
    try {
      const data = await costApi.fetchEfficiency(filters);
      set({ efficiency: { status: 'ready', data, filtersKey } });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load efficiency');
      set({ efficiency: { status: 'error', error: msg, filtersKey } });
      notificationService.error(msg);
    }
  },

  loadEntities: async (page) => {
    const { entities, filters, filtersKey } = get();
    const targetPage = page ?? entities.page ?? 1;
    const searchQuery = entities.searchQuery;
    const alreadyLoaded =
      entities.status === 'ready' &&
      entities.filtersKey === makeSliceKey(filtersKey, searchQuery) &&
      entities.page === targetPage;
    if (entities.status === 'loading' || alreadyLoaded) return;

    const keyed = makeSliceKey(filtersKey, searchQuery);
    set({
      entities: {
        ...entities,
        status: 'loading',
        error: undefined,
        page: targetPage,
        searchQuery,
      },
    });
    try {
      const data = await costApi.fetchEntities(
        filters,
        targetPage,
        undefined,
        undefined,
        undefined,
        searchQuery || undefined,
      );
      set({
        entities: {
          status: 'ready',
          data,
          filtersKey: keyed,
          page: targetPage,
          searchQuery,
        },
      });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load entities');
      set({
        entities: {
          status: 'error',
          error: msg,
          filtersKey: keyed,
          page: targetPage,
          searchQuery,
        },
      });
      notificationService.error(msg);
    }
  },

  loadCalls: async (page) => {
    const { calls, filters, filtersKey } = get();
    const targetPage = page ?? calls.page ?? 1;
    const searchQuery = calls.searchQuery;
    const alreadyLoaded =
      calls.status === 'ready' &&
      calls.filtersKey === makeSliceKey(filtersKey, searchQuery) &&
      calls.page === targetPage;
    if (calls.status === 'loading' || alreadyLoaded) return;

    const keyed = makeSliceKey(filtersKey, searchQuery);
    set({
      calls: {
        ...calls,
        status: 'loading',
        error: undefined,
        page: targetPage,
        searchQuery,
      },
    });
    try {
      const data = await costApi.fetchCalls(filters, targetPage, undefined, {
        q: searchQuery || undefined,
      });
      set({
        calls: {
          status: 'ready',
          data,
          filtersKey: keyed,
          page: targetPage,
          searchQuery,
        },
      });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load calls');
      set({
        calls: {
          status: 'error',
          error: msg,
          filtersKey: keyed,
          page: targetPage,
          searchQuery,
        },
      });
      notificationService.error(msg);
    }
  },

  setEntitiesSearch: (query) => {
    const current = get().entities.searchQuery;
    if (current === query) return;
    const { entities, filtersKey } = get();
    set({
      entities: {
        ...initialSlice<EntityListPage>(),
        page: 1,
        searchQuery: query,
        filtersKey: makeSliceKey(filtersKey, query),
      },
      entityCache: {},
    });
    void get().loadEntities(1);
    // suppress unused var
    void entities;
  },

  setCallsSearch: (query) => {
    const current = get().calls.searchQuery;
    if (current === query) return;
    const { calls, filtersKey } = get();
    set({
      calls: {
        ...initialSlice<CallsPage>(),
        page: 1,
        searchQuery: query,
        filtersKey: makeSliceKey(filtersKey, query),
      },
    });
    void get().loadCalls(1);
    void calls;
  },

  loadPricing: async () => {
    const { pricing } = get();
    if (pricing.status === 'loading') return;
    if (pricing.status === 'ready') return;

    set({ pricing: { ...pricing, status: 'loading', error: undefined } });
    try {
      const data = await costApi.fetchPricingBundle(false);
      set({ pricing: { status: 'ready', data } });
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Failed to load pricing');
      set({ pricing: { status: 'error', error: msg } });
      notificationService.error(msg);
    }
  },

  refreshActive: async (slice) => {
    const state = get();
    switch (slice) {
      case 'overview':
        set({ overview: initialSlice<CostOverview>() });
        await state.loadOverview();
        return;
      case 'spend':
        set({ spend: initialSlice<SpendBundle>() });
        await state.loadSpend();
        return;
      case 'efficiency':
        set({ efficiency: initialSlice<EfficiencyBundle>() });
        await state.loadEfficiency();
        return;
      case 'entities':
        set({
          entities: {
            ...initialSlice<EntityListPage>(),
            page: state.entities.page,
            searchQuery: state.entities.searchQuery,
          },
          entityCache: {},
        });
        await state.loadEntities(state.entities.page);
        return;
      case 'calls':
        set({
          calls: {
            ...initialSlice<CallsPage>(),
            page: state.calls.page,
            searchQuery: state.calls.searchQuery,
          },
        });
        await state.loadCalls(state.calls.page);
        return;
      case 'pricing':
        set({ pricing: initialSlice<PricingBundle>() });
        await state.loadPricing();
        return;
    }
  },

  loadEntity: async (ownerType, ownerId) => {
    const { filtersKey, filters, entityCache } = get();
    const key = `${filtersKey}:${ownerType}:${ownerId}`;
    const cached = entityCache[key];
    if (cached) return cached;
    try {
      const data = await costApi.fetchEntity(ownerType, ownerId, filters);
      set((s) => ({ entityCache: { ...s.entityCache, [key]: data } }));
      return data;
    } catch (e: unknown) {
      if (!(e instanceof ApiError) || e.status !== 404) {
        notificationService.error(errorMessage(e, 'Failed to load entity'));
      }
      return null;
    }
  },

  loadCallDetail: async (callId) => {
    const cached = get().callDetailCache[callId];
    if (cached) return cached;
    try {
      const data = await costApi.fetchCall(callId);
      set((s) => ({ callDetailCache: { ...s.callDetailCache, [callId]: data } }));
      return data;
    } catch (e: unknown) {
      notificationService.error(errorMessage(e, 'Failed to load call'));
      return null;
    }
  },

  createPricing: async (payload) => {
    const row = await costApi.createPricing(payload);
    const current = get().pricing.data;
    if (current) {
      const pruned = current.pricing.map((p) =>
        p.provider === row.provider && p.model === row.model && p.effectiveTo === null
          ? { ...p, effectiveTo: row.effectiveFrom }
          : p,
      );
      set({
        pricing: {
          status: 'ready',
          data: { ...current, pricing: [row, ...pruned] },
        },
      });
    }
    notificationService.success('Pricing saved');
  },

  patchPricing: async (pricingId, payload) => {
    const row = await costApi.patchPricing(pricingId, payload);
    const current = get().pricing.data;
    if (current) {
      const pruned = current.pricing.map((p) =>
        p.id === pricingId ? { ...p, effectiveTo: row.effectiveFrom } : p,
      );
      set({
        pricing: {
          status: 'ready',
          data: { ...current, pricing: [row, ...pruned] },
        },
      });
    }
    notificationService.success('Pricing updated');
  },

  refreshFromModelsDev: async () => {
    const diff = await costApi.refreshPricing();
    // Invalidate pricing slice so next visit refetches.
    set({ pricing: initialSlice<PricingBundle>() });
    if (diff.deduped) {
      notificationService.info('No pricing changes — source payload unchanged');
    } else {
      notificationService.success(
        `Pricing refreshed · +${diff.addedCount} / ~${diff.updatedCount} / -${diff.removedCount}`,
      );
    }
    return diff;
  },

  backfillUnpricedUsage: async (opts) => {
    const result = await costApi.backfillUnpriced({ allTenants: opts?.allTenants ?? false });
    const { scanned, repriced, stillUnpriced } = result;
    if (scanned === 0) {
      notificationService.info('No unpriced usage rows found');
    } else {
      notificationService.success(
        `Backfill · scanned ${scanned} · repriced ${repriced} · still unpriced ${stillUnpriced}`,
      );
    }
    // Invalidate caches so downstream tabs pick up new costs.
    set({
      overview: initialSlice<CostOverview>(),
      spend: initialSlice<SpendBundle>(),
      efficiency: initialSlice<EfficiencyBundle>(),
      entities: { ...initialSlice<EntityListPage>(), page: 1, searchQuery: '' },
      calls: { ...initialSlice<CallsPage>(), page: 1, searchQuery: '' },
      entityCache: {},
      callDetailCache: {},
    });
    return result;
  },

  reset: () => {
    set({
      filters: DEFAULT_FILTERS,
      filtersKey: hashFilters(DEFAULT_FILTERS),
      overview: initialSlice(),
      spend: initialSlice(),
      entities: { ...initialSlice<EntityListPage>(), page: 1, searchQuery: '' },
      calls: { ...initialSlice<CallsPage>(), page: 1, searchQuery: '' },
      efficiency: initialSlice(),
      pricing: initialSlice(),
      entityCache: {},
      callDetailCache: {},
    });
  },
}));
