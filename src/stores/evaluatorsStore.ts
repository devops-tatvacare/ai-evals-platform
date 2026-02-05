import { create } from 'zustand';
import type { EvaluatorDefinition } from '@/types';
import { evaluatorsRepository } from '@/services/storage';

interface EvaluatorsStore {
  evaluators: EvaluatorDefinition[];
  isLoaded: boolean;
  
  loadEvaluators: (appId: string) => Promise<void>;
  addEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  updateEvaluator: (evaluator: EvaluatorDefinition) => Promise<void>;
  deleteEvaluator: (id: string) => Promise<void>;
}

export const useEvaluatorsStore = create<EvaluatorsStore>((set) => ({
  evaluators: [],
  isLoaded: false,
  
  loadEvaluators: async (appId: string) => {
    const evaluators = await evaluatorsRepository.getByAppId(appId);
    set({ evaluators, isLoaded: true });
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
      evaluators: state.evaluators.filter(e => e.id !== id)
    }));
  },
}));
