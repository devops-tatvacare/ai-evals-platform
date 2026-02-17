import { create } from 'zustand';
import type { EvaluatorDefinition } from '@/types';
import { evaluatorsRepository } from '@/services/storage';

interface EvaluatorsStore {
  evaluators: EvaluatorDefinition[];
  isLoaded: boolean;
  currentListingId: string | null;
  currentAppId: string | null;

  // Registry state (for picker overlay)
  registry: EvaluatorDefinition[];
  isRegistryLoaded: boolean;

  loadEvaluators: (appId: string, listingId: string) => Promise<void>;
  loadAppEvaluators: (appId: string) => Promise<void>;
  loadRegistry: (appId: string) => Promise<void>;
  addEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  updateEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  deleteEvaluator: (id: string) => Promise<void>;
  setGlobal: (id: string, isGlobal: boolean) => Promise<void>;
  forkEvaluator: (sourceId: string, targetListingId: string) => Promise<EvaluatorDefinition>;
}

// Track in-flight fetch to deduplicate parallel calls
let _loadingListingId: string | null = null;

export const useEvaluatorsStore = create<EvaluatorsStore>((set, get) => ({
  evaluators: [],
  isLoaded: false,
  currentListingId: null,
  currentAppId: null,
  registry: [],
  isRegistryLoaded: false,

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
    } finally {
      if (_loadingListingId === listingId) {
        _loadingListingId = null;
      }
    }
  },

  loadAppEvaluators: async (appId: string) => {
    // Load app-level evaluators (no listing_id) — for kaira-bot
    const { currentAppId, currentListingId } = get();
    if (currentAppId !== appId || currentListingId !== null) {
      set({ isLoaded: false });
    }

    const evaluators = await evaluatorsRepository.getByAppId(appId);
    set({ evaluators, isLoaded: true, currentListingId: null, currentAppId: appId });
  },
  
  loadRegistry: async (appId: string) => {
    const registry = await evaluatorsRepository.getRegistry(appId);
    set({ registry, isRegistryLoaded: true });
  },
  
  addEvaluator: async (evaluator: EvaluatorDefinition) => {
    const saved = await evaluatorsRepository.save(evaluator);
    set(state => ({ evaluators: [...state.evaluators, saved] }));
  },

  updateEvaluator: async (evaluator: EvaluatorDefinition) => {
    const saved = await evaluatorsRepository.save(evaluator);
    set(state => ({
      evaluators: state.evaluators.map(e => e.id === evaluator.id ? saved : e)
    }));
  },
  
  deleteEvaluator: async (id: string) => {
    await evaluatorsRepository.delete(id);
    set(state => ({
      evaluators: state.evaluators.filter(e => e.id !== id),
      registry: state.registry.filter(e => e.id !== id),
    }));
  },
  
  setGlobal: async (id: string, isGlobal: boolean) => {
    await evaluatorsRepository.setGlobal(id, isGlobal);
    set(state => {
      const updatedEvaluator = state.evaluators.find(e => e.id === id);
      if (!updatedEvaluator) return state;
      
      const updated = { ...updatedEvaluator, isGlobal, updatedAt: new Date() };
      
      return {
        evaluators: state.evaluators.map(e => e.id === id ? updated : e),
        // Update registry: add if now global, remove if no longer global
        registry: isGlobal
          ? [...state.registry.filter(e => e.id !== id), updated]
          : state.registry.filter(e => e.id !== id),
      };
    });
  },
  
  forkEvaluator: async (sourceId: string, targetListingId: string) => {
    const forked = await evaluatorsRepository.fork(sourceId, targetListingId);
    set(state => ({ evaluators: [...state.evaluators, forked] }));
    return forked;
  },
}));
