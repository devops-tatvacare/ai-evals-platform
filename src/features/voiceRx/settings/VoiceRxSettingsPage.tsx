import { useCallback, useEffect } from 'react';
import { Mic } from 'lucide-react';
import { useLLMSettingsStore, useGlobalSettingsStore, useVoiceRxSettings, useAppSettingsStore } from '@/stores';
import { Card, Tabs } from '@/components/ui';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { ModelSelector } from '../../settings/components/ModelSelector';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { SchemasTab } from '../../settings/components/SchemasTab';
import { PromptsTab } from '../../settings/components/PromptsTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getVoiceRxSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
import { useToast } from '@/hooks';
import type { LLMTimeoutSettings } from '@/types';
import type { BaseFormValues } from '../../settings/hooks/useSettingsForm';

interface VoiceRxFormValues extends BaseFormValues {
  voiceRx: {
    languageHint: string;
    scriptType: 'auto' | 'devanagari' | 'romanized' | 'original';
    preserveCodeSwitching: boolean;
  };
  voiceRxApiUrl: string;
  voiceRxApiKey: string;
}

const defaultVoiceRxPrefs = {
  languageHint: '',
  scriptType: 'auto' as const,
  preserveCodeSwitching: true,
};

export function VoiceRxSettingsPage() {
  const toast = useToast();

  const llmApiKey = useLLMSettingsStore((s) => s.apiKey);
  const llmSelectedModel = useLLMSettingsStore((s) => s.selectedModel);
  const globalSettings = useGlobalSettingsStore();
  const { settings: voiceRxSettings, updateSettings: updateVoiceRxSettings } = useVoiceRxSettings();

  // Load credentials from backend on mount
  useEffect(() => {
    useAppSettingsStore.getState().loadCredentialsFromBackend('voice-rx');
  }, []);

  const onSaveApp = useCallback(async (form: VoiceRxFormValues, store: VoiceRxFormValues) => {
    if (JSON.stringify(form.voiceRx) !== JSON.stringify(store.voiceRx)) {
      updateVoiceRxSettings(form.voiceRx);
    }
    if (form.voiceRxApiUrl !== store.voiceRxApiUrl || form.voiceRxApiKey !== store.voiceRxApiKey) {
      updateVoiceRxSettings({ voiceRxApiUrl: form.voiceRxApiUrl, voiceRxApiKey: form.voiceRxApiKey });
    }
    await useAppSettingsStore.getState().saveCredentialsToBackend('voice-rx');
  }, [updateVoiceRxSettings]);

  const {
    formValues, setFormValues, isDirty, isSaving, handleChange, handleSave, handleDiscard,
  } = useSettingsForm<VoiceRxFormValues>({
    buildStoreValues: () => {
      const { voiceRxApiUrl, voiceRxApiKey, ...voiceRxPrefs } = voiceRxSettings;
      return {
        theme: globalSettings.theme,
        apiKey: llmApiKey,
        selectedModel: llmSelectedModel,
        timeouts: { ...globalSettings.timeouts } as LLMTimeoutSettings,
        voiceRx: voiceRxPrefs as VoiceRxFormValues['voiceRx'],
        voiceRxApiUrl,
        voiceRxApiKey,
      };
    },
    deps: [globalSettings.theme, llmApiKey, llmSelectedModel, globalSettings.timeouts, voiceRxSettings],
    onSaveApp,
  });

  const tabs = [
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <Card>
          <SettingsPanel settings={getGlobalSettingsByCategory('appearance')} values={formValues} onChange={handleChange} />
        </Card>
      ),
    },
    {
      id: 'ai',
      label: 'AI Configuration',
      content: (
        <div className="space-y-4">
          <Card>
            <div className="mb-6">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Authentication</h3>
              <SettingsPanel settings={getGlobalSettingsByCategory('ai')} values={formValues} onChange={handleChange} />
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
          <CollapsibleSection title="Voice RX API" subtitle="Transcription service endpoint and credentials">
            <SettingsPanel settings={getVoiceRxSettingsByCategory('api')} values={formValues} onChange={handleChange} />
          </CollapsibleSection>
          <CollapsibleSection title="Timeouts" subtitle="LLM request timeout durations (in seconds)">
            <SettingsPanel settings={getGlobalSettingsByCategory('timeouts')} values={formValues} onChange={handleChange} />
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
            settings={getVoiceRxSettingsByCategory('transcription').map(s => ({ ...s, key: `voiceRx.${s.key}` }))}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => {
                setFormValues(prev => ({ ...prev, voiceRx: defaultVoiceRxPrefs }));
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
      content: <Card><PromptsTab /></Card>,
    },
    {
      id: 'schemas',
      label: 'Output Schemas',
      content: <Card><SchemasTab /></Card>,
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
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  );
}
