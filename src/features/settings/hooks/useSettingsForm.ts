import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLLMSettingsStore, useGlobalSettingsStore } from '@/stores';
import { useToast } from '@/hooks';
import type { ThemeMode, LLMTimeoutSettings, LLMProvider } from '@/types';

/** Base form values shared across all settings pages. */
export interface BaseFormValues {
  theme: ThemeMode;
  apiKey: string;
  timeouts: LLMTimeoutSettings;
  [key: string]: unknown;
}

interface UseSettingsFormOptions<T extends BaseFormValues> {
  /** Compute merged store values (re-evaluated when deps change). */
  buildStoreValues: () => T;
  /** Dependency array for buildStoreValues memo. */
  deps: unknown[];
  /** App-specific save logic — called after common saves. */
  onSaveApp: (formValues: T, storeValues: T) => Promise<void>;
}

export function useSettingsForm<T extends BaseFormValues>({
  buildStoreValues,
  deps,
  onSaveApp,
}: UseSettingsFormOptions<T>) {
  const toast = useToast();

  // LLM store actions
  const setApiKey = useLLMSettingsStore((s) => s.setApiKey);
  const setProvider = useLLMSettingsStore((s) => s.setProvider);
  const setProviderApiKey = useLLMSettingsStore((s) => s.setProviderApiKey);
  const saveLLMSettings = useLLMSettingsStore((s) => s.save);

  // Global settings actions (slice selectors — avoid full-store subscription)
  const setTheme = useGlobalSettingsStore((s) => s.setTheme);
  const setGlobalTimeouts = useGlobalSettingsStore((s) => s.setTimeouts);

  const userHasEdited = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storeValues = useMemo<T>(buildStoreValues, deps);

  const [formValues, setFormValues] = useState<T>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Dirty detection via JSON comparison.
  // Exclude `provider` (tab navigation, not a real edit) and `apiKey` (derived from
  // per-provider keys) so that merely switching the provider tab doesn't trigger dirty.
  const isDirty = useMemo(() => {
    const omit = new Set(['provider', 'apiKey']);
    const strip = (obj: Record<string, unknown>) =>
      JSON.stringify(Object.fromEntries(Object.entries(obj).filter(([k]) => !omit.has(k))));
    return strip(formValues as Record<string, unknown>) !== strip(storeValues as Record<string, unknown>);
  }, [formValues, storeValues]);

  // Sync form from store when values change externally and user hasn't edited
  useEffect(() => {
    if (!userHasEdited.current) {
      setFormValues(storeValues);
    }
  }, [storeValues]);

  // Auto-reset edit flag when user reverts all manual changes.
  // This unblocks store→form syncing (e.g. credential loads that finish
  // after the user briefly touched a field and then undid the change).
  useEffect(() => {
    if (!isDirty) {
      userHasEdited.current = false;
    }
  }, [isDirty]);

  // Warn on page unload with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Generic change handler — supports flat keys and `namespace.field` keys.
  // Special case: when 'provider' changes, atomically clear selectedModel and
  // recompute apiKey so dirty detection isn't falsely triggered (provider and
  // apiKey are excluded from isDirty; selectedModel clearing is only a
  // side-effect of the switch, not a user edit).
  const handleChange = useCallback((key: string, value: unknown) => {
    if (key === 'provider') {
      // Provider switch is not a "user edit" for dirty-detection purposes
      // (provider & apiKey are excluded from isDirty). Recompute apiKey
      // in a single state update.
      const newProvider = value as LLMProvider;
      setFormValues(prev => {
        const keyMap: Record<LLMProvider, string> = {
          gemini: (prev as Record<string, unknown>).geminiApiKey as string ?? '',
          openai: (prev as Record<string, unknown>).openaiApiKey as string ?? '',
          azure_openai: (prev as Record<string, unknown>).azureOpenaiApiKey as string ?? '',
          anthropic: (prev as Record<string, unknown>).anthropicApiKey as string ?? '',
        };
        return {
          ...prev,
          provider: newProvider,
          apiKey: keyMap[newProvider] ?? '',
        };
      });
      // Also sync to the store so storeValues (reactive memo) reflects the
      // new provider. Without this, isDirty can detect spurious mismatches.
      setProvider(newProvider);
      return;
    }

    userHasEdited.current = true;
    setFormValues(prev => {
      if (key.includes('.')) {
        const [namespace, field] = key.split('.', 2);
        const current = prev[namespace];
        if (current && typeof current === 'object') {
          return { ...prev, [namespace]: { ...(current as Record<string, unknown>), [field]: value } };
        }
      }
      return { ...prev, [key]: value };
    });
  }, []);

  // Save orchestration — common settings + app-specific
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Theme — localStorage only
      if (formValues.theme !== storeValues.theme) {
        setTheme(formValues.theme);
      }
      // LLM provider, API keys, model — backend-persisted
      let llmDirty = false;
      const fv = formValues as Record<string, unknown>;
      const sv = storeValues as Record<string, unknown>;

      if (fv.provider !== sv.provider) {
        setProvider(fv.provider as LLMProvider);
        llmDirty = true;
      }
      if (fv.geminiApiKey !== sv.geminiApiKey) {
        setProviderApiKey('gemini', fv.geminiApiKey as string);
        llmDirty = true;
      }
      if (fv.openaiApiKey !== sv.openaiApiKey) {
        setProviderApiKey('openai', fv.openaiApiKey as string);
        llmDirty = true;
      }
      if (fv.azureOpenaiApiKey !== sv.azureOpenaiApiKey) {
        setProviderApiKey('azure_openai', fv.azureOpenaiApiKey as string);
        llmDirty = true;
      }
      if (fv.anthropicApiKey !== sv.anthropicApiKey) {
        setProviderApiKey('anthropic', fv.anthropicApiKey as string);
        llmDirty = true;
      }
      // Azure-specific fields — update store directly, persisted via saveLLMSettings
      if (fv.azureOpenaiEndpoint !== sv.azureOpenaiEndpoint || fv.azureOpenaiApiVersion !== sv.azureOpenaiApiVersion) {
        useLLMSettingsStore.getState().updateLLMSettings({
          azureOpenaiEndpoint: (fv.azureOpenaiEndpoint as string) || '',
          azureOpenaiApiVersion: (fv.azureOpenaiApiVersion as string) || '2025-03-01-preview',
        });
        llmDirty = true;
      }
      if (formValues.apiKey !== storeValues.apiKey) {
        setApiKey(formValues.apiKey);
        llmDirty = true;
      }
      if (llmDirty) {
        await saveLLMSettings();
      }
      // Timeouts — localStorage only
      if (JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts)) {
        setGlobalTimeouts(formValues.timeouts);
      }
      // App-specific save
      await onSaveApp(formValues, storeValues);

      userHasEdited.current = false;
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, setTheme, setGlobalTimeouts, setApiKey, setProvider, setProviderApiKey, saveLLMSettings, onSaveApp, toast]);

  // Discard changes
  const handleDiscard = useCallback(() => {
    userHasEdited.current = false;
    setFormValues(storeValues);
    toast.success('Changes discarded');
  }, [storeValues, toast]);

  return {
    formValues,
    setFormValues,
    isDirty,
    isSaving,
    handleChange,
    handleSave,
    handleDiscard,
  };
}
