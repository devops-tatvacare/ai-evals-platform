import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Save, X, MessageSquare } from 'lucide-react';
import { useSettingsStore, useGlobalSettingsStore, useKairaBotSettings } from '@/stores';
import { Card, Tabs, Button } from '@/components/ui';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { ModelSelector } from '../../settings/components/ModelSelector';
import { SchemasTab } from '../../settings/components/SchemasTab';
import { PromptsTab } from '../../settings/components/PromptsTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getKairaBotSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useToast } from '@/hooks';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';

interface KairaBotFormSettings {
  contextWindowSize: number;
  maxResponseLength: number;
  historyRetentionDays: number;
  streamResponses: boolean;
}

interface SettingsFormValues {
  theme: ThemeMode;
  apiKey: string;
  selectedModel: string;
  timeouts: LLMTimeoutSettings;
  kairaBot: KairaBotFormSettings;
  [key: string]: unknown;
}

export function KairaBotSettingsPage() {
  const toast = useToast();
  
  // Global settings (shared across apps)
  const globalSettings = useGlobalSettingsStore();
  
  // Kaira Bot specific settings
  const { settings: kairaBotSettings, updateSettings: updateKairaBotSettings } = useKairaBotSettings();
  
  // Legacy settings store (for compatibility during migration)
  const legacySettings = useSettingsStore();

  // Track if this is initial mount
  const isInitialMount = useRef(true);

  // Build form values from both stores
  const storeValues = useMemo<SettingsFormValues>(() => ({
    theme: globalSettings.theme,
    apiKey: globalSettings.apiKey,
    selectedModel: globalSettings.selectedModels.transcription,
    timeouts: { ...globalSettings.timeouts },
    kairaBot: { ...kairaBotSettings },
  }), [globalSettings.theme, globalSettings.apiKey, globalSettings.selectedModels.transcription, globalSettings.timeouts, kairaBotSettings]);

  const [formValues, setFormValues] = useState<SettingsFormValues>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Check if form is dirty (has unsaved changes)
  const isDirty = useMemo(() => {
    return (
      formValues.theme !== storeValues.theme ||
      formValues.apiKey !== storeValues.apiKey ||
      formValues.selectedModel !== storeValues.selectedModel ||
      JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts) ||
      JSON.stringify(formValues.kairaBot) !== JSON.stringify(storeValues.kairaBot)
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
      if (key === 'apiKey') {
        return { ...prev, apiKey: value as string };
      }
      if (key === 'selectedModel') {
        return { ...prev, selectedModel: value as string };
      }
      if (key.startsWith('timeouts.')) {
        const timeoutKey = key.replace('timeouts.', '') as keyof LLMTimeoutSettings;
        return { ...prev, timeouts: { ...prev.timeouts, [timeoutKey]: value as number } };
      }
      if (key.startsWith('kairaBot.')) {
        const settingKey = key.replace('kairaBot.', '') as keyof KairaBotFormSettings;
        return { ...prev, kairaBot: { ...prev.kairaBot, [settingKey]: value } };
      }
      return prev;
    });
  }, []);

  // Save all changes to store
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save theme
      if (formValues.theme !== storeValues.theme) {
        globalSettings.setTheme(formValues.theme);
        legacySettings.setTheme(formValues.theme);
      }
      // Save API key
      if (formValues.apiKey !== storeValues.apiKey) {
        globalSettings.setApiKey(formValues.apiKey);
        legacySettings.setApiKey(formValues.apiKey);
      }
      // Save model
      if (formValues.selectedModel !== storeValues.selectedModel) {
        globalSettings.setAllModels(formValues.selectedModel);
        legacySettings.setSelectedModel(formValues.selectedModel);
      }
      // Save timeouts
      if (JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts)) {
        globalSettings.setTimeouts(formValues.timeouts);
      }
      // Save Kaira Bot settings
      if (JSON.stringify(formValues.kairaBot) !== JSON.stringify(storeValues.kairaBot)) {
        updateKairaBotSettings(formValues.kairaBot);
      }
      toast.success('Settings saved');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, globalSettings, legacySettings, updateKairaBotSettings, toast]);

  // Discard changes
  const handleDiscard = useCallback(() => {
    setFormValues(storeValues);
    toast.success('Changes discarded');
  }, [storeValues, toast]);

  // Default Kaira Bot settings for reset
  const defaultKairaBotSettings: KairaBotFormSettings = {
    contextWindowSize: 10,
    maxResponseLength: 2048,
    historyRetentionDays: 30,
    streamResponses: true,
  };

  const tabs = [
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <Card>
          <SettingsPanel
            settings={getGlobalSettingsByCategory('appearance')}
            values={formValues}
            onChange={handleChange}
          />
        </Card>
      ),
    },
    {
      id: 'ai',
      label: 'AI Configuration',
      content: (
        <Card>
          <SettingsPanel
            settings={getGlobalSettingsByCategory('ai')}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
            <ModelSelector
              apiKey={formValues.apiKey}
              selectedModel={formValues.selectedModel}
              onChange={(model) => handleChange('selectedModel', model)}
            />
          </div>
          <p className="mt-4 text-[12px] text-[var(--text-muted)] italic">
            ℹ️ API key and model selection are shared across all apps.
          </p>
        </Card>
      ),
    },
    {
      id: 'chat',
      label: 'Chat Configuration',
      content: (
        <Card>
          <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
            Configure chat behavior, context window, and response preferences for Kaira Bot evaluations.
          </p>
          <SettingsPanel
            settings={getKairaBotSettingsByCategory('chat').map(s => ({
              ...s,
              key: `kairaBot.${s.key}`,
            }))}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => {
                setFormValues(prev => ({ ...prev, kairaBot: defaultKairaBotSettings }));
                toast.success('Chat configuration reset to defaults (save to apply)');
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
          <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
            Configure prompts for chat evaluation and analysis.
          </p>
          <PromptsTab />
        </Card>
      ),
    },
    {
      id: 'schemas',
      label: 'Output Schemas',
      content: (
        <Card>
          <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
            Define JSON schemas for structured chat evaluation outputs.
          </p>
          <SchemasTab />
        </Card>
      ),
    },
  ];

  return (
    <div className="pb-20">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
          <MessageSquare className="h-5 w-5 text-[var(--text-brand)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Kaira Bot Settings</h1>
          <p className="text-[13px] text-[var(--text-muted)]">Configure chat evaluation settings</p>
        </div>
      </div>
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
