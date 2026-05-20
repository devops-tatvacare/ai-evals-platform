import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import { useGlobalSettingsStore } from '@/stores';
import { useToast } from '@/hooks';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';

/**
 * Base form values shared across all settings pages.
 *
 * BYOK: LLM credentials live in /admin/ai-settings — this hook never
 * carries per-user provider keys. App pages save theme + timeouts plus
 * whatever app-specific fields they declare on top of this base.
 */
export interface BaseFormValues {
  theme: ThemeMode;
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

  // Global settings actions (slice selectors — avoid full-store subscription)
  const setTheme = useGlobalSettingsStore((s) => s.setTheme);
  const setGlobalTimeouts = useGlobalSettingsStore((s) => s.setTimeouts);

  const userHasEdited = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storeValues = useMemo<T>(buildStoreValues, deps);

  const [formValues, setFormValues] = useState<T>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

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

  // Auto-reset edit flag when user reverts all manual changes.
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

  // Save orchestration — theme + timeouts + app-specific. LLM credentials
  // are admin-managed and never touched here.
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (formValues.theme !== storeValues.theme) {
        setTheme(formValues.theme);
      }
      if (JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts)) {
        setGlobalTimeouts(formValues.timeouts);
      }
      await onSaveApp(formValues, storeValues);

      userHasEdited.current = false;
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, setTheme, setGlobalTimeouts, onSaveApp, toast]);

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
