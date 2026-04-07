import { useCallback } from 'react';
import { Phone } from 'lucide-react';
import { useLLMSettingsStore, useGlobalSettingsStore } from '@/stores';
import { Card, Tabs } from '@/components/ui';
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
  anthropicApiKey: string;
}

export function InsideSalesSettings() {
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
      anthropicApiKey: llmAnthropicApiKey,
      timeouts: { ...timeouts } as LLMTimeoutSettings,
    }),
    deps: [theme, llmApiKey, llmProvider, llmGeminiApiKey, llmOpenaiApiKey, llmAzureOpenaiApiKey, llmAzureOpenaiEndpoint, llmAzureOpenaiApiVersion, llmAnthropicApiKey, timeouts],
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
    <div className="pb-20">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
          <Phone className="h-5 w-5 text-[var(--text-brand)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inside Sales Settings</h1>
          <p className="text-[13px] text-[var(--text-muted)]">Configure evaluation and display settings</p>
        </div>
      </div>
      <Tabs tabs={tabs} />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  );
}
