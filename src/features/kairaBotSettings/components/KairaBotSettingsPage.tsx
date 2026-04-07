import { useCallback, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLLMSettingsStore, useGlobalSettingsStore, useKairaBotSettings, useAppSettingsStore } from '@/stores';
import { Card, Tabs } from '@/components/ui';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { ProviderConfigCard } from '../../settings/components/ProviderConfigCard';
import { TemplatesTab } from '../../settings/components/TemplatesTab';
import { EvaluationContractsTab } from './AdversarialCatalogTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getKairaBotSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
import type { LLMTimeoutSettings, LLMProvider } from '@/types';
import type { BaseFormValues } from '../../settings/hooks/useSettingsForm';

interface KairaBotFormValues extends BaseFormValues {
  provider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  kairaBot: {
    contextWindowSize: number;
    maxResponseLength: number;
    historyRetentionDays: number;
    streamResponses: boolean;
  };
  kairaApiUrl: string;
  kairaAuthToken: string;
  kairaChatUserId: string;
}

export function KairaBotSettingsPage() {
  const llmApiKey = useLLMSettingsStore((s) => s.apiKey);
  const llmProvider = useLLMSettingsStore((s) => s.provider);
  const llmGeminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const llmOpenaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const llmAzureOpenaiApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const llmAzureOpenaiEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const llmAzureOpenaiApiVersion = useLLMSettingsStore((s) => s.azureOpenaiApiVersion);
  const llmAnthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const { settings: kairaBotSettings, updateSettings: updateKairaBotSettings } = useKairaBotSettings();

  // Load credentials from backend on mount
  useEffect(() => {
    useAppSettingsStore.getState().loadCredentialsFromBackend('kaira-bot');
  }, []);

  const onSaveApp = useCallback(async (form: KairaBotFormValues, store: KairaBotFormValues) => {
    if (JSON.stringify(form.kairaBot) !== JSON.stringify(store.kairaBot)) {
      updateKairaBotSettings(form.kairaBot);
    }
    if (form.kairaApiUrl !== store.kairaApiUrl ||
      form.kairaAuthToken !== store.kairaAuthToken ||
      form.kairaChatUserId !== store.kairaChatUserId) {
      updateKairaBotSettings({
        kairaApiUrl: form.kairaApiUrl,
        kairaAuthToken: form.kairaAuthToken,
        kairaChatUserId: form.kairaChatUserId,
      });
    }
    await useAppSettingsStore.getState().saveCredentialsToBackend('kaira-bot');
  }, [updateKairaBotSettings]);

  const {
    formValues, isDirty, isSaving, handleChange, handleSave, handleDiscard,
  } = useSettingsForm<KairaBotFormValues>({
    buildStoreValues: () => {
      const { kairaApiUrl, kairaAuthToken, kairaChatUserId, ...kairaBotPrefs } = kairaBotSettings;
      return {
        theme,
        apiKey: llmApiKey,
        provider: llmProvider,
        geminiApiKey: llmGeminiApiKey,
        openaiApiKey: llmOpenaiApiKey,
        azureOpenaiApiKey: llmAzureOpenaiApiKey,
        azureOpenaiEndpoint: llmAzureOpenaiEndpoint,
        azureOpenaiApiVersion: llmAzureOpenaiApiVersion,
        anthropicApiKey: llmAnthropicApiKey,
        timeouts: { ...timeouts } as LLMTimeoutSettings,
        kairaBot: kairaBotPrefs as KairaBotFormValues['kairaBot'],
        kairaApiUrl,
        kairaAuthToken,
        kairaChatUserId,
      };
    },
    deps: [theme, llmApiKey, llmProvider, llmGeminiApiKey, llmOpenaiApiKey, llmAzureOpenaiApiKey, llmAzureOpenaiEndpoint, llmAzureOpenaiApiVersion, llmAnthropicApiKey, timeouts, kairaBotSettings],
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
              anthropicApiKey={(formValues.anthropicApiKey as string) || ''}
              onChange={handleChange}
            />
          </Card>
          <CollapsibleSection title="Kaira Bot API" subtitle="AI Orchestrator endpoint, auth token, and default user">
            <SettingsPanel settings={getKairaBotSettingsByCategory('api')} values={formValues} onChange={handleChange} />
          </CollapsibleSection>
          <CollapsibleSection title="Timeouts" subtitle="LLM request timeout durations (in seconds)">
            <SettingsPanel settings={getGlobalSettingsByCategory('timeouts')} values={formValues} onChange={handleChange} />
          </CollapsibleSection>
        </div>
      ),
    },
    {
      id: 'templates',
      label: 'Templates',
      content: <Card><TemplatesTab /></Card>,
    },
    {
      id: 'adversarial',
      label: 'Evaluation Contracts',
      content: <EvaluationContractsTab />,
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
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  );
}
