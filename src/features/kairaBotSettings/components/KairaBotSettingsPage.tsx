import { useCallback, useEffect } from 'react';
import { MessageSquare, Tag as TagIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLLMSettingsStore, useGlobalSettingsStore, useKairaBotSettings, useAppSettingsStore } from '@/stores';
import { Card, Tabs } from '@/components/ui';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { ModelSelector } from '../../settings/components/ModelSelector';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { SchemasTab } from '../../settings/components/SchemasTab';
import { PromptsTab } from '../../settings/components/PromptsTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getKairaBotSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
import { useToast } from '@/hooks';
import type { LLMTimeoutSettings } from '@/types';
import type { BaseFormValues } from '../../settings/hooks/useSettingsForm';

interface KairaBotFormValues extends BaseFormValues {
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

const defaultKairaBotPrefs = {
  contextWindowSize: 4096,
  maxResponseLength: 2048,
  historyRetentionDays: 30,
  streamResponses: true,
};

export function KairaBotSettingsPage() {
  const toast = useToast();
  const navigate = useNavigate();

  const llmApiKey = useLLMSettingsStore((s) => s.apiKey);
  const llmSelectedModel = useLLMSettingsStore((s) => s.selectedModel);
  const globalSettings = useGlobalSettingsStore();
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
    formValues, setFormValues, isDirty, isSaving, handleChange, handleSave, handleDiscard,
  } = useSettingsForm<KairaBotFormValues>({
    buildStoreValues: () => {
      const { kairaApiUrl, kairaAuthToken, kairaChatUserId, ...kairaBotPrefs } = kairaBotSettings;
      return {
        theme: globalSettings.theme,
        apiKey: llmApiKey,
        selectedModel: llmSelectedModel,
        timeouts: { ...globalSettings.timeouts } as LLMTimeoutSettings,
        kairaBot: kairaBotPrefs as KairaBotFormValues['kairaBot'],
        kairaApiUrl,
        kairaAuthToken,
        kairaChatUserId,
      };
    },
    deps: [globalSettings.theme, llmApiKey, llmSelectedModel, globalSettings.timeouts, kairaBotSettings],
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
      id: 'chat',
      label: 'Chat Configuration',
      content: (
        <Card>
          <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
            Configure chat behavior, context window, and response preferences for Kaira Bot evaluations.
          </p>
          <SettingsPanel
            settings={getKairaBotSettingsByCategory('chat').map(s => ({ ...s, key: `kairaBot.${s.key}` }))}
            values={formValues}
            onChange={handleChange}
          />
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <button
              onClick={() => {
                setFormValues(prev => ({ ...prev, kairaBot: defaultKairaBotPrefs }));
                toast.success('Chat configuration reset to defaults (save to apply)');
              }}
              className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
            >
              Reset to Defaults
            </button>
            <button
              onClick={() => navigate('/kaira/settings/tags')}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-[13px] text-[var(--text-brand)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <TagIcon className="h-4 w-4" />
              Manage Tags
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
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  );
}
