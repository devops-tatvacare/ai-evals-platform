import { apiRequest } from './client';
import type { AdversarialResult } from '@/types';

export type SavedCaseDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'CRACK' | 'MORIARTY';
export type SavedCaseSourceKind = 'manual' | 'generated' | 'saved' | 'retry';

export interface AdversarialSavedCase {
  id: string;
  appId: string;
  name?: string | null;
  description?: string | null;
  syntheticInput: string;
  difficulty: SavedCaseDifficulty;
  goalFlow: string[];
  activeTraits: string[];
  expectedChallenges: string[];
  isPinned: boolean;
  personaTactic?: string | null;
  sourceKind: SavedCaseSourceKind;
  createdFromRunId?: string | null;
  createdFromEvalId?: number | null;
  lastUsedAt?: string | null;
  useCount: number;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AdversarialSavedCaseCreate {
  name?: string;
  description?: string;
  syntheticInput: string;
  difficulty: SavedCaseDifficulty;
  goalFlow: string[];
  activeTraits?: string[];
  expectedChallenges?: string[];
  isPinned?: boolean;
  personaTactic?: string | null;
  sourceKind?: SavedCaseSourceKind;
  createdFromRunId?: string;
  createdFromEvalId?: number;
}

export interface AdversarialSavedCaseUpdate {
  name?: string;
  description?: string;
  syntheticInput?: string;
  difficulty?: SavedCaseDifficulty;
  goalFlow?: string[];
  activeTraits?: string[];
  expectedChallenges?: string[];
  isPinned?: boolean;
  personaTactic?: string | null;
}

interface BuildSavedCasePayloadOptions {
  name?: string;
  description?: string;
  isPinned?: boolean;
  sourceKind?: SavedCaseSourceKind;
  createdFromRunId?: string;
  createdFromEvalId?: number;
}

export function buildSavedCasePayloadFromResult(
  result: AdversarialResult,
  options: BuildSavedCasePayloadOptions = {},
): AdversarialSavedCaseCreate {
  const testCase = result.test_case;
  return {
    name: options.name,
    description: options.description,
    syntheticInput: testCase.synthetic_input,
    difficulty: testCase.difficulty,
    goalFlow: testCase.goal_flow,
    activeTraits: testCase.active_traits,
    expectedChallenges: testCase.expected_challenges,
    isPinned: options.isPinned,
    sourceKind: options.sourceKind ?? 'saved',
    createdFromRunId: options.createdFromRunId,
    createdFromEvalId: options.createdFromEvalId,
  };
}

export const adversarialTestCasesApi = {
  async list(params?: { pinnedOnly?: boolean }): Promise<AdversarialSavedCase[]> {
    const q = new URLSearchParams();
    if (params?.pinnedOnly) q.set('pinnedOnly', 'true');
    const qs = q.toString();
    return apiRequest<AdversarialSavedCase[]>(`/api/adversarial-test-cases${qs ? `?${qs}` : ''}`);
  },

  async create(payload: AdversarialSavedCaseCreate): Promise<AdversarialSavedCase> {
    return apiRequest<AdversarialSavedCase>('/api/adversarial-test-cases', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async update(caseId: string, payload: AdversarialSavedCaseUpdate): Promise<AdversarialSavedCase> {
    return apiRequest<AdversarialSavedCase>(`/api/adversarial-test-cases/${caseId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async delete(caseId: string): Promise<{ deleted: boolean; id: string }> {
    return apiRequest(`/api/adversarial-test-cases/${caseId}`, {
      method: 'DELETE',
    });
  },
};
