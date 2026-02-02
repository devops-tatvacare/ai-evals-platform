import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Save, X } from 'lucide-react';
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
  } = useSettingsStore();

  // Track if this is initial mount to avoid resetting form
  const isInitialMount = useRef(true);

  // Original values from store (for dirty checking)
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

  // Local form state - all changes go here first
  const [formValues, setFormValues] = useState<SettingsFormValues>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Check if form is dirty (has unsaved changes)
  const isDirty = useMemo(() => {
    return (
      formValues.theme !== storeValues.theme ||
      formValues.llm.apiKey !== storeValues.llm.apiKey ||
      formValues.llm.selectedModel !== storeValues.llm.selectedModel ||
      formValues.llm.transcriptionPrompt !== storeValues.llm.transcriptionPrompt ||
      formValues.llm.evaluationPrompt !== storeValues.llm.evaluationPrompt ||
      formValues.llm.extractionPrompt !== storeValues.llm.extractionPrompt ||
      JSON.stringify(formValues.transcription) !== JSON.stringify(storeValues.transcription)
    );
  }, [formValues, storeValues]);

  // Only sync from store on initial mount
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      setFormValues(storeValues);
    }
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

  // All changes go to local form state only
  const handleChange = useCallback((key: string, value: unknown) => {
    setFormValues(prev => {
      if (key === 'theme') {
        return { ...prev, theme: value as ThemeMode };
      }
      if (key === 'llm.apiKey') {
        return { ...prev, llm: { ...prev.llm, apiKey: value as string } };
      }
      if (key === 'llm.selectedModel') {
        return { ...prev, llm: { ...prev.llm, selectedModel: value as string } };
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
      if (key.startsWith('transcription.')) {
        const prefKey = key.replace('transcription.', '') as keyof TranscriptionPreferences;
        return { ...prev, transcription: { ...prev.transcription, [prefKey]: value } };
      }
      return prev;
    });
  }, []);

  // Save all changes to store
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save all changed values to store
      if (formValues.theme !== storeValues.theme) {
        setTheme(formValues.theme);
      }
      if (formValues.llm.apiKey !== storeValues.llm.apiKey) {
        setApiKey(formValues.llm.apiKey);
      }
      if (formValues.llm.selectedModel !== storeValues.llm.selectedModel) {
        setSelectedModel(formValues.llm.selectedModel);
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
      if (JSON.stringify(formValues.transcription) !== JSON.stringify(storeValues.transcription)) {
        updateTranscriptionPreferences(formValues.transcription);
      }
      toast.success('Settings saved');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, setTheme, setApiKey, setSelectedModel, setTranscriptionPrompt, setEvaluationPrompt, setExtractionPrompt, updateTranscriptionPreferences, toast]);

  // Discard changes
  const handleDiscard = useCallback(() => {
    setFormValues(storeValues);
    toast.success('Changes discarded');
  }, [storeValues, toast]);

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
                // Reset to default values in local form state
                const defaults: TranscriptionPreferences = {
                  scriptPreference: 'auto',
                  languageHint: '',
                  preserveCodeSwitching: true,
                };
                setFormValues(prev => ({ ...prev, transcription: defaults }));
                toast.success('Transcription preferences reset to defaults (save to apply)');
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
      
      {/* Sticky Save/Discard Buttons */}
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-30 flex gap-3">
          <Button
            variant="secondary"
            onClick={handleDiscard}
            className="shadow-lg gap-2"
          >
            <X className="h-4 w-4" />
            Discard
          </Button>
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
