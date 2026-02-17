import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLLMSettingsStore, useGlobalSettingsStore } from '@/stores';
import { useToast } from '@/hooks';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';

/** Base form values shared across all settings pages. */
export interface BaseFormValues {
  theme: ThemeMode;
  apiKey: string;
  selectedModel: string;
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
  const setSelectedModel = useLLMSettingsStore((s) => s.setSelectedModel);
  const setProvider = useLLMSettingsStore((s) => s.setProvider);
  const setProviderApiKey = useLLMSettingsStore((s) => s.setProviderApiKey);
  const saveLLMSettings = useLLMSettingsStore((s) => s.save);

  // Global settings actions
  const globalSettings = useGlobalSettingsStore();

  const userHasEdited = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storeValues = useMemo<T>(buildStoreValues, deps);

  const [formValues, setFormValues] = useState<T>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Dirty detection via JSON comparison
  const isDirty = useMemo(
    () => JSON.stringify(formValues) !== JSON.stringify(storeValues),
    [formValues, storeValues],
  );

  // Sync form from store when values change externally and user hasn't edited
  useEffect(() => {
    if (!userHasEdited.current) {
      setFormValues(storeValues);
    }
  }, [storeValues]);

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

  // Generic change handler — supports flat keys and `namespace.field` keys
  const handleChange = useCallback((key: string, value: unknown) => {
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
        globalSettings.setTheme(formValues.theme);
      }
      // LLM provider, API keys, model — backend-persisted
      let llmDirty = false;
      const fv = formValues as Record<string, unknown>;
      const sv = storeValues as Record<string, unknown>;

      if (fv.provider !== sv.provider) {
        setProvider(fv.provider as 'gemini' | 'openai');
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
      if (formValues.apiKey !== storeValues.apiKey) {
        setApiKey(formValues.apiKey);
        llmDirty = true;
      }
      if (formValues.selectedModel !== storeValues.selectedModel) {
        setSelectedModel(formValues.selectedModel);
        llmDirty = true;
      }
      if (llmDirty) {
        await saveLLMSettings();
      }
      // Timeouts — localStorage only
      if (JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts)) {
        globalSettings.setTimeouts(formValues.timeouts);
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
  }, [formValues, storeValues, globalSettings, setApiKey, setSelectedModel, setProvider, setProviderApiKey, saveLLMSettings, onSaveApp, toast]);

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
