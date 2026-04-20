/**
 * LLM Settings Store
 * Backend-persisted settings for LLM configuration.
 *
 * Saved to key: "llm-settings" with app_id="" (global).
 *
 * Models are NOT stored here. Each callsite (batch eval, custom eval, voice-rx,
 * report) independently selects its own provider + model via LLMConfigSection.
 */

import { create } from 'zustand';
import type { LLMSettings, LLMProvider, GeminiAuthMethod } from '@/types';
import { settingsRepository } from '@/services/api';
import { apiRequest } from '@/services/api/client';

const defaultLLMSettings: LLMSettings = {
  provider: 'gemini',
  apiKey: '',
  geminiApiKey: '',
  openaiApiKey: '',
  azureOpenaiApiKey: '',
  azureOpenaiEndpoint: '',
  azureOpenaiApiVersion: '2025-03-01-preview',
  azureOpenaiDeployments: '',
  anthropicApiKey: '',
  geminiAuthMethod: 'api_key',
};

interface LLMSettingsState extends LLMSettings {
  _hasHydrated: boolean;
  /** Runtime-only: whether a service account is configured on the server */
  _serviceAccountConfigured: boolean;

  // Setters — update in-memory only (call save() to persist)
  setApiKey: (key: string) => void;
  updateLLMSettings: (updates: Partial<LLMSettings>) => void;
  /** Switch active provider, recompute apiKey */
  setProvider: (provider: LLMProvider) => void;
  /** Set API key for a specific provider */
  setProviderApiKey: (provider: LLMProvider, key: string) => void;

  // Persistence
  save: () => Promise<void>;
  loadSettings: () => Promise<void>;
  reset: () => void;
}

/**
 * Selector: returns true when backend eval jobs have valid credentials —
 * either an API key is set, or Gemini service-account auth is available on the server.
 *
 * Usage in components: `useLLMSettingsStore(hasLLMCredentials)`
 * Usage in callbacks:  `hasLLMCredentials(useLLMSettingsStore.getState())`
 */
export const hasLLMCredentials = (state: Pick<LLMSettingsState, 'provider' | '_serviceAccountConfigured' | 'geminiApiKey' | 'openaiApiKey' | 'azureOpenaiApiKey' | 'azureOpenaiEndpoint' | 'anthropicApiKey'>): boolean => {
  if (state.provider === 'gemini' && state._serviceAccountConfigured) return true;
  const key = getProviderApiKey(state.provider, state);
  if (!key) return false;
  // Azure OpenAI requires both API key AND endpoint
  if (state.provider === 'azure_openai') return Boolean(state.azureOpenaiEndpoint);
  return true;
};

/** Resolve the API key for a given provider from store state. */
export const getProviderApiKey = (
  provider: LLMProvider,
  state: Pick<LLMSettingsState, 'geminiApiKey' | 'openaiApiKey' | 'azureOpenaiApiKey' | 'anthropicApiKey'>,
): string => {
  if (provider === 'anthropic') return state.anthropicApiKey;
  if (provider === 'openai') return state.openaiApiKey;
  if (provider === 'azure_openai') return state.azureOpenaiApiKey;
  return state.geminiApiKey; // 'gemini'
};

/** Check if a given provider has valid credentials (API key or Gemini SA). */
export const hasProviderCredentials = (
  provider: LLMProvider,
  state: Pick<LLMSettingsState, 'geminiApiKey' | 'openaiApiKey' | 'azureOpenaiApiKey' | 'azureOpenaiEndpoint' | 'anthropicApiKey' | '_serviceAccountConfigured'>,
): boolean => {
  if (provider === 'gemini' && state._serviceAccountConfigured) return true;
  const key = getProviderApiKey(provider, state);
  if (!key) return false;
  if (provider === 'azure_openai') return Boolean(state.azureOpenaiEndpoint);
  return true;
};

/** All provider options — shared across ProviderConfigCard, ReportTab, etc. */
export const LLM_PROVIDERS: { value: LLMProvider; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

export const useLLMSettingsStore = create<LLMSettingsState>((set, get) => ({
  ...defaultLLMSettings,
  _hasHydrated: false,
  _serviceAccountConfigured: false,

  loadSettings: async () => {
    try {
      // Load DB settings and SA status in parallel
      const [data, authStatus] = await Promise.all([
        settingsRepository.get('', 'llm-settings') as Promise<Partial<LLMSettings> | undefined>,
        apiRequest<{ serviceAccountConfigured: boolean }>('/api/llm/auth-status').catch(() => ({
          serviceAccountConfigured: false,
        })),
      ]);

      const saConfigured = authStatus.serviceAccountConfigured;

      if (data) {
        const provider = data.provider || 'gemini';
        const geminiApiKey = data.geminiApiKey || '';
        const openaiApiKey = data.openaiApiKey || '';
        const azureOpenaiApiKey = data.azureOpenaiApiKey || '';
        const azureOpenaiEndpoint = data.azureOpenaiEndpoint || '';
        const azureOpenaiApiVersion = data.azureOpenaiApiVersion || '2025-03-01-preview';
        const azureOpenaiDeployments = data.azureOpenaiDeployments || '';
        const anthropicApiKey = data.anthropicApiKey || '';
        const apiKey = provider === 'azure_openai' ? azureOpenaiApiKey
          : provider === 'anthropic' ? anthropicApiKey
          : provider === 'openai' ? openaiApiKey
          : geminiApiKey;

        // Auto-compute geminiAuthMethod from SA detection
        const geminiAuthMethod: GeminiAuthMethod = saConfigured ? 'service_account' : 'api_key';

        set({
          ...defaultLLMSettings,
          ...data,
          provider,
          geminiApiKey,
          openaiApiKey,
          azureOpenaiApiKey,
          azureOpenaiEndpoint,
          azureOpenaiApiVersion,
          azureOpenaiDeployments,
          anthropicApiKey,
          apiKey,
          geminiAuthMethod,
          _serviceAccountConfigured: saConfigured,
          _hasHydrated: true,
        });
      } else {
        const geminiAuthMethod: GeminiAuthMethod = saConfigured ? 'service_account' : 'api_key';
        set({
          _serviceAccountConfigured: saConfigured,
          geminiAuthMethod,
          _hasHydrated: true,
        });
      }
    } catch (err) {
      console.error('[LLMSettingsStore] Failed to load settings:', err);
      set({ _hasHydrated: true });
    }
  },

  save: async () => {
    const state = get();
    const settings: Record<string, string> = {
      provider: state.provider,
      geminiAuthMethod: state.geminiAuthMethod,
    };
    // Only include non-empty keys — empty strings cause cross-provider contamination
    if (state.geminiApiKey) settings.geminiApiKey = state.geminiApiKey;
    if (state.openaiApiKey) settings.openaiApiKey = state.openaiApiKey;
    if (state.azureOpenaiApiKey) settings.azureOpenaiApiKey = state.azureOpenaiApiKey;
    if (state.azureOpenaiEndpoint) settings.azureOpenaiEndpoint = state.azureOpenaiEndpoint;
    if (state.azureOpenaiApiVersion) settings.azureOpenaiApiVersion = state.azureOpenaiApiVersion;
    if (state.azureOpenaiDeployments) settings.azureOpenaiDeployments = state.azureOpenaiDeployments;
    if (state.anthropicApiKey) settings.anthropicApiKey = state.anthropicApiKey;
    await settingsRepository.set('', 'llm-settings', settings);
  },

  setApiKey: (apiKey) => {
    set({ apiKey });
  },

  setProvider: (provider) => {
    const state = get();
    const apiKey = provider === 'azure_openai' ? state.azureOpenaiApiKey
      : provider === 'anthropic' ? state.anthropicApiKey
      : provider === 'openai' ? state.openaiApiKey
      : state.geminiApiKey;
    set({ provider, apiKey });
  },

  setProviderApiKey: (provider, key) => {
    const updates: Partial<LLMSettingsState> = {};
    if (provider === 'gemini') {
      updates.geminiApiKey = key;
    } else if (provider === 'openai') {
      updates.openaiApiKey = key;
    } else if (provider === 'azure_openai') {
      updates.azureOpenaiApiKey = key;
    } else if (provider === 'anthropic') {
      updates.anthropicApiKey = key;
    }
    set(updates);
  },

  reset: () => set({ ...defaultLLMSettings, _hasHydrated: false, _serviceAccountConfigured: false }),

  updateLLMSettings: (updates) => {
    set((state) => ({
      ...state,
      ...updates,
    }));
  },
}));
