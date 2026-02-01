import { useState, useCallback, useEffect, useMemo } from 'react';
import { Save } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { Card, Tabs, Button } from '@/components/ui';
import { SettingsPanel } from './SettingsPanel';
import { ModelSelector } from './ModelSelector';
import { SchemasTab } from './SchemasTab';
import { PromptsTab } from './PromptsTab';
import { getSettingsByCategory } from '../schema/settingsSchema';
import { useToast } from '@/hooks';
import type { ThemeMode, TranscriptionPreferences } from '@/types';

interface SettingsFormValues {
  theme: ThemeMode;
  llm: {
    apiKey: string;
    selectedModel: string;
    transcriptionPrompt: string;
    evaluationPrompt: string;
    extractionPrompt: string;
  };
  transcription: TranscriptionPreferences;
  [key: string]: unknown;
}

export function SettingsPage() {
  const toast = useToast();
  
  const {
    theme,
    llm,
    transcription,
    setTheme,
    setApiKey,
    setSelectedModel,
    setTranscriptionPrompt,
    setEvaluationPrompt,
    setExtractionPrompt,
    updateTranscriptionPreferences,
    resetTranscriptionPreferences,
  } = useSettingsStore();

  // Original values from store
  const storeValues = useMemo<SettingsFormValues>(() => ({
    theme,
    llm: {
      apiKey: llm.apiKey,
      selectedModel: llm.selectedModel,
      transcriptionPrompt: llm.transcriptionPrompt,
      evaluationPrompt: llm.evaluationPrompt,
      extractionPrompt: llm.extractionPrompt,
    },
    transcription: { ...transcription },
  }), [theme, llm.apiKey, llm.selectedModel, llm.transcriptionPrompt, llm.evaluationPrompt, llm.extractionPrompt, transcription]);

  // Local form state
  const [formValues, setFormValues] = useState<SettingsFormValues>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Check if form is dirty (has unsaved changes in API key or prompts)
  const isDirty = useMemo(() => {
    return (
      formValues.llm.apiKey !== storeValues.llm.apiKey ||
      formValues.llm.transcriptionPrompt !== storeValues.llm.transcriptionPrompt ||
      formValues.llm.evaluationPrompt !== storeValues.llm.evaluationPrompt ||
      formValues.llm.extractionPrompt !== storeValues.llm.extractionPrompt
    );
  }, [formValues, storeValues]);

  // Sync form values when store changes (e.g., after reset)
  useEffect(() => {
    setFormValues(storeValues);
  }, [storeValues]);

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleChange = useCallback((key: string, value: unknown) => {
    // Theme changes apply immediately (no save needed)
    if (key === 'theme') {
      setTheme(value as ThemeMode);
      setFormValues(prev => ({ ...prev, theme: value as ThemeMode }));
      toast.success('Theme updated');
      return;
    }

    // Model changes apply immediately
    if (key === 'llm.selectedModel') {
      setSelectedModel(value as string);
      setFormValues(prev => ({
        ...prev,
        llm: { ...prev.llm, selectedModel: value as string },
      }));
      toast.success('Model updated');
      return;
    }

    // Transcription preferences apply immediately
    if (key.startsWith('transcription.')) {
      const prefKey = key.replace('transcription.', '') as keyof TranscriptionPreferences;
      updateTranscriptionPreferences({ [prefKey]: value });
      setFormValues(prev => ({
        ...prev,
        transcription: { ...prev.transcription, [prefKey]: value },
      }));
      toast.success('Transcription setting updated');
      return;
    }

    // API key and prompts require save
    setFormValues(prev => {
      if (key === 'llm.apiKey') {
        return { ...prev, llm: { ...prev.llm, apiKey: value as string } };
      }
      if (key === 'llm.transcriptionPrompt') {
        return { ...prev, llm: { ...prev.llm, transcriptionPrompt: value as string } };
      }
      if (key === 'llm.evaluationPrompt') {
        return { ...prev, llm: { ...prev.llm, evaluationPrompt: value as string } };
      }
      if (key === 'llm.extractionPrompt') {
        return { ...prev, llm: { ...prev.llm, extractionPrompt: value as string } };
      }
      return prev;
    });
  }, [setTheme, setSelectedModel, updateTranscriptionPreferences, toast]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save API key and prompts to store
      if (formValues.llm.apiKey !== storeValues.llm.apiKey) {
        setApiKey(formValues.llm.apiKey);
      }
      if (formValues.llm.transcriptionPrompt !== storeValues.llm.transcriptionPrompt) {
        setTranscriptionPrompt(formValues.llm.transcriptionPrompt);
      }
      if (formValues.llm.evaluationPrompt !== storeValues.llm.evaluationPrompt) {
        setEvaluationPrompt(formValues.llm.evaluationPrompt);
      }
      if (formValues.llm.extractionPrompt !== storeValues.llm.extractionPrompt) {
        setExtractionPrompt(formValues.llm.extractionPrompt);
      }
      toast.success('Settings saved');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, setApiKey, setTranscriptionPrompt, setEvaluationPrompt, setExtractionPrompt, toast]);

  const tabs = [
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <Card>
          <SettingsPanel
            settings={getSettingsByCategory('appearance')}
            values={formValues}
            onChange={handleChange}
          />
        </Card>
      ),
    },
    {
      id: 'llm',
      label: 'AI Configuration',
      content: (
        <Card>
          <SettingsPanel
            settings={getSettingsByCategory('llm')}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
            <ModelSelector
              apiKey={formValues.llm.apiKey}
              selectedModel={formValues.llm.selectedModel}
              onChange={(model) => handleChange('llm.selectedModel', model)}
            />
          </div>
        </Card>
      ),
    },
    {
      id: 'transcription',
      label: 'Language & Script',
      content: (
        <Card>
          <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
            Configure language preferences for multilingual transcription and script-aware comparison.
          </p>
          <SettingsPanel
            settings={getSettingsByCategory('transcription')}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => {
                resetTranscriptionPreferences();
                toast.success('Transcription preferences reset to defaults');
              }}
              className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
            >
              Reset to Defaults
            </button>
          </div>
        </Card>
      ),
    },
    {
      id: 'prompts',
      label: 'Prompts',
      content: (
        <Card>
          <PromptsTab />
        </Card>
      ),
    },
    {
      id: 'schemas',
      label: 'Output Schemas',
      content: (
        <Card>
          <SchemasTab />
        </Card>
      ),
    },
  ];

  return (
    <div className="pb-20">
      <h1 className="mb-6 text-xl font-semibold text-[var(--text-primary)]">Settings</h1>
      <Tabs tabs={tabs} />
      
      {/* Sticky Save Button */}
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-30">
          <Button
            onClick={handleSave}
            isLoading={isSaving}
            className="shadow-lg gap-2"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}
