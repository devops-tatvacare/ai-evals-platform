import { useState, useCallback, useEffect } from 'react';

interface UseUnsavedChangesOptions<T> {
  initialValues: T;
  onSave: (values: T) => Promise<void> | void;
}

export function useUnsavedChanges<T extends Record<string, unknown>>({
  initialValues,
  onSave,
}: UseUnsavedChangesOptions<T>) {
  const [currentValues, setCurrentValues] = useState<T>(initialValues);
  const [savedValues, setSavedValues] = useState<T>(initialValues);
  const [isSaving, setIsSaving] = useState(false);

  // Update when initial values change (e.g., from store)
  useEffect(() => {
    setCurrentValues(initialValues);
    setSavedValues(initialValues);
  }, [initialValues]);

  const isDirty = JSON.stringify(currentValues) !== JSON.stringify(savedValues);

  const updateValue = useCallback((key: string, value: unknown) => {
    setCurrentValues(prev => {
      const keys = key.split('.');
      const newValues = { ...prev };
      let obj: Record<string, unknown> = newValues;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        obj[k] = { ...(obj[k] as Record<string, unknown> || {}) };
        obj = obj[k] as Record<string, unknown>;
      }
      
      obj[keys[keys.length - 1]] = value;
      return newValues;
    });
  }, []);

  const save = useCallback(async () => {
    if (!isDirty) return;
    
    setIsSaving(true);
    try {
      await onSave(currentValues);
      setSavedValues(currentValues);
    } finally {
      setIsSaving(false);
    }
  }, [currentValues, isDirty, onSave]);

  const discard = useCallback(() => {
    setCurrentValues(savedValues);
  }, [savedValues]);

  const getValue = useCallback((key: string): unknown => {
    const keys = key.split('.');
    let value: unknown = currentValues;
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }, [currentValues]);

  return {
    currentValues,
    isDirty,
    isSaving,
    updateValue,
    getValue,
    save,
    discard,
  };
}
