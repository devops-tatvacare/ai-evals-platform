import { create } from 'zustand';
import type { EvaluatorDefinition } from '@/types';
import { evaluatorsRepository } from '@/services/storage';

interface EvaluatorsStore {
  evaluators: EvaluatorDefinition[];
  isLoaded: boolean;
  currentListingId: string | null;
  
  // Registry state (for picker overlay)
  registry: EvaluatorDefinition[];
  isRegistryLoaded: boolean;
  
  loadEvaluators: (appId: string, listingId: string) => Promise<void>;
  loadRegistry: (appId: string) => Promise<void>;
  addEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  updateEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  deleteEvaluator: (id: string) => Promise<void>;
  setGlobal: (id: string, isGlobal: boolean) => Promise<void>;
  forkEvaluator: (sourceId: string, targetListingId: string) => Promise<EvaluatorDefinition>;
}

export const useEvaluatorsStore = create<EvaluatorsStore>((set, get) => ({
  evaluators: [],
  isLoaded: false,
  currentListingId: null,
  registry: [],
  isRegistryLoaded: false,
  
  loadEvaluators: async (appId: string, listingId: string) => {
    // Reload if listing changed
    const { currentListingId } = get();
    if (currentListingId !== listingId) {
      set({ isLoaded: false });
    }
    
    const evaluators = await evaluatorsRepository.getForListing(appId, listingId);
    set({ evaluators, isLoaded: true, currentListingId: listingId });
  },
  
  loadRegistry: async (appId: string) => {
    const registry = await evaluatorsRepository.getRegistry(appId);
    set({ registry, isRegistryLoaded: true });
  },
  
  addEvaluator: async (evaluator: EvaluatorDefinition) => {
    await evaluatorsRepository.save(evaluator);
    set(state => ({ evaluators: [...state.evaluators, evaluator] }));
  },
  
  updateEvaluator: async (evaluator: EvaluatorDefinition) => {
    await evaluatorsRepository.save(evaluator);
    set(state => ({
      evaluators: state.evaluators.map(e => e.id === evaluator.id ? evaluator : e)
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
