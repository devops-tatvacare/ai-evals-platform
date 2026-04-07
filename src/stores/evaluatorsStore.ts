import { create } from 'zustand';
import type { AppId, AssetVisibility, EvaluatorDefinition, EvaluatorVisibilityFilter } from '@/types';
import { evaluatorsRepository } from '@/services/storage';
import { filterEvaluatorsByVisibility } from '@/services/api/evaluatorsApi';

interface EvaluatorsStore {
  evaluators: EvaluatorDefinition[];
  isLoaded: boolean;
  currentListingId: string | null;
  currentAppId: string | null;

  loadEvaluators: (appId: string, listingId: string) => Promise<void>;
  loadAppEvaluators: (appId: string) => Promise<void>;
  getEvaluatorsByVisibility: (visibility: AssetVisibility) => EvaluatorDefinition[];
  getEvaluatorsByFilter: (filter: EvaluatorVisibilityFilter) => EvaluatorDefinition[];
  addEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  updateEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  deleteEvaluator: (id: string) => Promise<void>;
  setVisibility: (id: string, visibility: AssetVisibility) => Promise<void>;
  forkEvaluator: (sourceId: string, targetListingId?: string) => Promise<EvaluatorDefinition>;
  seedDefaults: (listingId: string) => Promise<EvaluatorDefinition[]>;
  seedAppDefaults: (appId: string) => Promise<EvaluatorDefinition[]>;
  reset: () => void;
}

// Track in-flight fetch to deduplicate parallel calls
let _loadingListingId: string | null = null;

function replaceById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    return [...items, item];
  }
  return items.map((entry) => (entry.id === item.id ? item : entry));
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

function upsertEvaluatorState(
  state: Pick<EvaluatorsStore, 'evaluators'>,
  evaluator: EvaluatorDefinition,
) {
  return {
    evaluators: replaceById(state.evaluators, evaluator),
  };
}

export const useEvaluatorsStore = create<EvaluatorsStore>((set, get) => ({
  evaluators: [],
  isLoaded: false,
  currentListingId: null,
  currentAppId: null,

  loadEvaluators: async (appId: string, listingId: string) => {
    const { currentListingId, isLoaded } = get();

    // Skip if already loaded for this listing or a fetch is in-flight for it
    if ((isLoaded && currentListingId === listingId) || _loadingListingId === listingId) {
      return;
    }

    _loadingListingId = listingId;
    set({ isLoaded: false });

    try {
      const evaluators = await evaluatorsRepository.getForListing(appId, listingId);
      set({ evaluators, isLoaded: true, currentListingId: listingId, currentAppId: appId });
    } catch {
      // Mark as loaded even on error to prevent infinite retry loops
      set({ isLoaded: true, currentListingId: listingId, currentAppId: appId });
    } finally {
      if (_loadingListingId === listingId) {
        _loadingListingId = null;
      }
    }
  },

  loadAppEvaluators: async (appId: string) => {
    const { currentAppId, currentListingId } = get();
    if (currentAppId !== appId || currentListingId !== null) {
      set({ isLoaded: false });
    }

    try {
      const evaluators = await evaluatorsRepository.getByAppId(appId);
      set({ evaluators, isLoaded: true, currentListingId: null, currentAppId: appId });
    } catch {
      set({ isLoaded: true, currentListingId: null, currentAppId: appId });
    }
  },

  getEvaluatorsByVisibility: (visibility: AssetVisibility) => {
    return get().evaluators.filter((evaluator) => (evaluator.visibility ?? 'private') === visibility);
  },

  getEvaluatorsByFilter: (filter: EvaluatorVisibilityFilter) => {
    return filterEvaluatorsByVisibility(get().evaluators, filter);
  },
  
  addEvaluator: async (evaluator: EvaluatorDefinition) => {
    const saved = await evaluatorsRepository.save(evaluator);
    set((state) => upsertEvaluatorState(state, saved));
  },

  updateEvaluator: async (evaluator: EvaluatorDefinition) => {
    const saved = await evaluatorsRepository.save(evaluator);
    set((state) => upsertEvaluatorState(state, saved));
  },
  
  deleteEvaluator: async (id: string) => {
    const { currentAppId } = get();
    if (!currentAppId) {
      throw new Error('No current app selected');
    }
    await evaluatorsRepository.delete(currentAppId, id);
    set((state) => ({
      evaluators: removeById(state.evaluators, id),
    }));
  },

  setVisibility: async (id: string, visibility: AssetVisibility) => {
    const { currentAppId } = get();
    if (!currentAppId) {
      throw new Error('No current app selected');
    }
    const updated = await evaluatorsRepository.setVisibility(currentAppId, id, visibility);
    set((state) => ({
      evaluators: replaceById(state.evaluators, updated),
    }));
  },
  
  forkEvaluator: async (sourceId: string, targetListingId?: string) => {
    const { currentAppId } = get();
    if (!currentAppId) {
      throw new Error('No current app selected');
    }
    const forked = await evaluatorsRepository.fork(currentAppId, sourceId, targetListingId);
    set((state) => upsertEvaluatorState(state, forked));
    return forked;
  },

  seedDefaults: async (listingId: string) => {
    const { currentAppId } = get();
    if (!currentAppId) {
      throw new Error('No current app selected');
    }
    const seeded = await evaluatorsRepository.seedDefaults(currentAppId as AppId, listingId);
    // Reload from list endpoint to get properly annotated data (owner names)
    if (currentAppId) {
      const evaluators = await evaluatorsRepository.getForListing(currentAppId, listingId);
      set({ evaluators, isLoaded: true, currentListingId: listingId, currentAppId });
    }
    return seeded;
  },

  seedAppDefaults: async (appId: string) => {
    const seeded = await evaluatorsRepository.seedAppDefaults(appId);
    // Reload from list endpoint to get properly annotated data (owner names)
    const evaluators = await evaluatorsRepository.getByAppId(appId);
    set({ evaluators, isLoaded: true, currentListingId: null, currentAppId: appId });
    return seeded;
  },

  reset: () => {
    _loadingListingId = null;
    set({
      evaluators: [],
      isLoaded: false,
      currentListingId: null,
      currentAppId: null,
    });
  },
}));
