import { useCallback } from 'react';
import { useLLMSettingsStore, useGlobalSettingsStore } from '@/stores';
import { Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { SettingsPanel } from '@/features/settings/components/SettingsPanel';
import { CollapsibleSection } from '@/features/settings/components/CollapsibleSection';
import { SettingsSaveBar } from '@/features/settings/components/SettingsSaveBar';
import { ProviderConfigCard } from '@/features/settings/components/ProviderConfigCard';
import { TemplatesTab } from '@/features/settings/components/TemplatesTab';
import { getGlobalSettingsByCategory } from '@/features/settings/schemas/globalSettingsSchema';
import { useSettingsForm } from '@/features/settings/hooks/useSettingsForm';
import type { LLMTimeoutSettings, LLMProvider } from '@/types';
import type { BaseFormValues } from '@/features/settings/hooks/useSettingsForm';

interface InsideSalesFormValues extends BaseFormValues {
  provider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  azureOpenaiApiKey: string;
  azureOpenaiEndpoint: string;
  azureOpenaiApiVersion: string;
  azureOpenaiDeployments: string;
  anthropicApiKey: string;
}

export function InsideSalesSettings() {
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

  const onSaveApp = useCallback(async () => {
    // No app-specific settings to save yet
  }, []);

  const {
    formValues, isDirty, isSaving, handleChange, handleSave, handleDiscard,
  } = useSettingsForm<InsideSalesFormValues>({
    buildStoreValues: () => ({
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
    }),
    deps: [theme, llmApiKey, llmProvider, llmGeminiApiKey, llmOpenaiApiKey, llmAzureOpenaiApiKey, llmAzureOpenaiEndpoint, llmAzureOpenaiApiVersion, llmAzureOpenaiDeployments, llmAnthropicApiKey, timeouts],
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
              azureOpenaiApiKey={formValues.azureOpenaiApiKey}
              azureOpenaiEndpoint={formValues.azureOpenaiEndpoint}
              azureOpenaiApiVersion={formValues.azureOpenaiApiVersion}
              azureOpenaiDeployments={formValues.azureOpenaiDeployments}
              anthropicApiKey={formValues.anthropicApiKey}
              onChange={handleChange}
            />
          </Card>
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
  ];

  return (
    <PageSurface icon={icon} title={title}>
      <Tabs tabs={tabs} fillHeight />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </PageSurface>
  );
}
