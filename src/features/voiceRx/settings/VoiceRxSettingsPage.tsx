import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Save, X, Mic, ChevronDown, ChevronRight } from 'lucide-react';
import { useSettingsStore, useGlobalSettingsStore, useVoiceRxSettings, useAppSettingsStore } from '@/stores';
import { Card, Tabs, Button } from '@/components/ui';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { ModelSelector } from '../../settings/components/ModelSelector';
import { SchemasTab } from '../../settings/components/SchemasTab';
import { PromptsTab } from '../../settings/components/PromptsTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getVoiceRxSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useToast } from '@/hooks';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';

function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center gap-2.5 bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)]/80 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        )}
        <div className="text-left">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)]">
          {children}
        </div>
      )}
    </div>
  );
}

interface VoiceRxFormSettings {
  languageHint: string;
  scriptType: 'auto' | 'devanagari' | 'romanized' | 'original';
  preserveCodeSwitching: boolean;
}

interface SettingsFormValues {
  theme: ThemeMode;
  apiKey: string;
  selectedModel: string;
  timeouts: LLMTimeoutSettings;
  voiceRx: VoiceRxFormSettings;
  voiceRxApiUrl: string;
  voiceRxApiKey: string;
  [key: string]: unknown;
}

export function VoiceRxSettingsPage() {
  const toast = useToast();

  // LLM settings — backend-persisted via settingsStore
  const llmApiKey = useSettingsStore((s) => s.llm.apiKey);
  const llmSelectedModel = useSettingsStore((s) => s.llm.selectedModel);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);

  // Theme & timeouts — localStorage only (frontend-only concerns)
  const globalSettings = useGlobalSettingsStore();

  // Voice Rx specific settings
  const { settings: voiceRxSettings, updateSettings: updateVoiceRxSettings } = useVoiceRxSettings();

  // Track whether user has manually edited the form
  const userHasEdited = useRef(false);

  // Load credentials from backend on mount
  useEffect(() => {
    useAppSettingsStore.getState().loadCredentialsFromBackend('voice-rx');
  }, []);

  // Build form values from stores
  // Strip API credential fields from nested voiceRx to avoid duplicate tracking —
  // credentials are compared as top-level fields only.
  const storeValues = useMemo<SettingsFormValues>(() => {
    const { voiceRxApiUrl, voiceRxApiKey, ...voiceRxPrefs } = voiceRxSettings;
    return {
      theme: globalSettings.theme,
      apiKey: llmApiKey,
      selectedModel: llmSelectedModel,
      timeouts: { ...globalSettings.timeouts },
      voiceRx: voiceRxPrefs as VoiceRxFormSettings,
      voiceRxApiUrl,
      voiceRxApiKey,
    };
  }, [globalSettings.theme, llmApiKey, llmSelectedModel, globalSettings.timeouts, voiceRxSettings]);

  const [formValues, setFormValues] = useState<SettingsFormValues>(storeValues);
  const [isSaving, setIsSaving] = useState(false);

  // Check if form is dirty (has unsaved changes)
  const isDirty = useMemo(() => {
    return (
      formValues.theme !== storeValues.theme ||
      formValues.apiKey !== storeValues.apiKey ||
      formValues.selectedModel !== storeValues.selectedModel ||
      JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts) ||
      JSON.stringify(formValues.voiceRx) !== JSON.stringify(storeValues.voiceRx) ||
      formValues.voiceRxApiUrl !== storeValues.voiceRxApiUrl ||
      formValues.voiceRxApiKey !== storeValues.voiceRxApiKey
    );
  }, [formValues, storeValues]);

  // Sync form from store whenever store values change externally
  // (e.g., credentials loaded from backend) and user hasn't made edits
  useEffect(() => {
    if (!userHasEdited.current) {
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
    userHasEdited.current = true;
    setFormValues(prev => {
      if (key === 'theme') {
        return { ...prev, theme: value as ThemeMode };
      }
      if (key === 'authType') {
        return { ...prev, authType: value as 'api-key' | 'service-account' };
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
      if (key.startsWith('voiceRx.')) {
        const settingKey = key.replace('voiceRx.', '') as keyof VoiceRxFormSettings;
        return { ...prev, voiceRx: { ...prev.voiceRx, [settingKey]: value } };
      }
      if (key === 'voiceRxApiUrl' || key === 'voiceRxApiKey') {
        return { ...prev, [key]: value as string };
      }
      return prev;
    });
  }, []);

  // Save all changes
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Theme — localStorage only
      if (formValues.theme !== storeValues.theme) {
        globalSettings.setTheme(formValues.theme);
      }
      // API key — backend-persisted via settingsStore
      if (formValues.apiKey !== storeValues.apiKey) {
        setApiKey(formValues.apiKey);
      }
      // Model — backend-persisted via settingsStore
      if (formValues.selectedModel !== storeValues.selectedModel) {
        setSelectedModel(formValues.selectedModel);
      }
      // Timeouts — localStorage only
      if (JSON.stringify(formValues.timeouts) !== JSON.stringify(storeValues.timeouts)) {
        globalSettings.setTimeouts(formValues.timeouts);
      }
      // Voice Rx preferences — localStorage
      if (JSON.stringify(formValues.voiceRx) !== JSON.stringify(storeValues.voiceRx)) {
        updateVoiceRxSettings(formValues.voiceRx);
      }
      // Voice Rx API credentials — backend-persisted
      if (formValues.voiceRxApiUrl !== storeValues.voiceRxApiUrl ||
          formValues.voiceRxApiKey !== storeValues.voiceRxApiKey) {
        updateVoiceRxSettings({
          voiceRxApiUrl: formValues.voiceRxApiUrl,
          voiceRxApiKey: formValues.voiceRxApiKey,
        });
      }
      // Persist credentials to backend database
      await useAppSettingsStore.getState().saveCredentialsToBackend('voice-rx');
      userHasEdited.current = false;
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save credentials');
    } finally {
      setIsSaving(false);
    }
  }, [formValues, storeValues, globalSettings, setApiKey, setSelectedModel, updateVoiceRxSettings, toast]);

  // Discard changes
  const handleDiscard = useCallback(() => {
    userHasEdited.current = false;
    setFormValues(storeValues);
    toast.success('Changes discarded');
  }, [storeValues, toast]);

  // Default Voice Rx settings for reset
  const defaultVoiceRxSettings: VoiceRxFormSettings = {
    languageHint: '',
    scriptType: 'auto',
    preserveCodeSwitching: true,
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
        <div className="space-y-4">
          {/* Global — API Key + Model (always visible) */}
          <Card>
            <div className="mb-6">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Authentication</h3>
              <SettingsPanel
                settings={getGlobalSettingsByCategory('ai')}
                values={formValues}
                onChange={handleChange}
              />
            </div>
            <div className="pt-6 border-t border-[var(--border-subtle)]">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Model Selection</h3>
              <ModelSelector
                apiKey={formValues.apiKey}
                selectedModel={formValues.selectedModel}
                onChange={(model) => handleChange('selectedModel', model)}
              />
            </div>
          </Card>

          {/* Voice RX API */}
          <CollapsibleSection
            title="Voice RX API"
            subtitle="Transcription service endpoint and credentials"
          >
            <SettingsPanel
              settings={getVoiceRxSettingsByCategory('api')}
              values={formValues}
              onChange={handleChange}
            />
          </CollapsibleSection>

          {/* Timeouts */}
          <CollapsibleSection
            title="Timeouts"
            subtitle="LLM request timeout durations (in seconds)"
          >
            <SettingsPanel
              settings={getGlobalSettingsByCategory('timeouts')}
              values={formValues}
              onChange={handleChange}
            />
          </CollapsibleSection>
        </div>
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
            settings={getVoiceRxSettingsByCategory('transcription').map(s => ({
              ...s,
              key: `voiceRx.${s.key}`,
            }))}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => {
                setFormValues(prev => ({ ...prev, voiceRx: defaultVoiceRxSettings }));
                toast.success('Language & Script preferences reset to defaults (save to apply)');
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
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
          <Mic className="h-5 w-5 text-[var(--text-brand)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Voice Rx Settings</h1>
          <p className="text-[13px] text-[var(--text-muted)]">Configure audio evaluation settings</p>
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
