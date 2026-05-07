import { useCallback, useEffect } from 'react';
import { useLLMSettingsStore, useGlobalSettingsStore, useVoiceRxSettings, useAppSettingsStore } from '@/stores';
import { Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { ProviderConfigCard } from '../../settings/components/ProviderConfigCard';
import { TemplatesTab } from '../../settings/components/TemplatesTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getVoiceRxSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
import { useToast } from '@/hooks';
import type { LLMTimeoutSettings, LLMProvider } from '@/types';
import type { BaseFormValues } from '../../settings/hooks/useSettingsForm';

interface VoiceRxFormValues extends BaseFormValues {
  provider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
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
  const { icon, title } = usePageMetadata('settings');

  const llmApiKey = useLLMSettingsStore((s) => s.apiKey);
  const llmProvider = useLLMSettingsStore((s) => s.provider);
  const llmGeminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const llmOpenaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const llmAzureOpenaiApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const llmAzureOpenaiEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const llmAzureOpenaiApiVersion = useLLMSettingsStore((s) => s.azureOpenaiApiVersion);
  const llmAzureOpenaiDeployments = useLLMSettingsStore((s) => s.azureOpenaiDeployments);
  const llmAnthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
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
        theme,
        apiKey: llmApiKey,
        provider: llmProvider,
        geminiApiKey: llmGeminiApiKey,
        openaiApiKey: llmOpenaiApiKey,
        azureOpenaiApiKey: llmAzureOpenaiApiKey,
        azureOpenaiEndpoint: llmAzureOpenaiEndpoint,
        azureOpenaiApiVersion: llmAzureOpenaiApiVersion,
        azureOpenaiDeployments: llmAzureOpenaiDeployments,
        anthropicApiKey: llmAnthropicApiKey,
        timeouts: { ...timeouts } as LLMTimeoutSettings,
        voiceRx: voiceRxPrefs as VoiceRxFormValues['voiceRx'],
        voiceRxApiUrl,
        voiceRxApiKey,
      };
    },
    deps: [theme, llmApiKey, llmProvider, llmGeminiApiKey, llmOpenaiApiKey, llmAzureOpenaiApiKey, llmAzureOpenaiEndpoint, llmAzureOpenaiApiVersion, llmAzureOpenaiDeployments, llmAnthropicApiKey, timeouts, voiceRxSettings],
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
            <ProviderConfigCard
              provider={formValues.provider}
              geminiApiKey={formValues.geminiApiKey}
              openaiApiKey={formValues.openaiApiKey}
              azureOpenaiApiKey={(formValues.azureOpenaiApiKey as string) || ''}
              azureOpenaiEndpoint={(formValues.azureOpenaiEndpoint as string) || ''}
              azureOpenaiApiVersion={(formValues.azureOpenaiApiVersion as string) || '2025-03-01-preview'}
              azureOpenaiDeployments={(formValues.azureOpenaiDeployments as string) || ''}
              anthropicApiKey={(formValues.anthropicApiKey as string) || ''}
              onChange={handleChange}
            />
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
      id: 'templates',
      label: 'Templates',
      content: <Card><TemplatesTab /></Card>,
    },
  ];

  return (
    <PageSurface icon={icon} title={title}>
      <Tabs tabs={tabs} fillHeight />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </PageSurface>
  );
}
