import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useGlobalSettingsStore, useKairaBotSettings, useAppSettingsStore } from '@/stores';
import { Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import { usePermission } from '@/utils/permissions';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { TemplatesTab } from '../../settings/components/TemplatesTab';
import { EvaluationContractsTab } from './AdversarialCatalogTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getKairaBotSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
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

export function KairaBotSettingsPage() {
  const { icon, title } = usePageMetadata('settings');
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const { settings: kairaBotSettings, updateSettings: updateKairaBotSettings } = useKairaBotSettings();
  const canEditAISettings = usePermission('configuration:edit');

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
        timeouts: { ...timeouts } as LLMTimeoutSettings,
        kairaBot: kairaBotPrefs as KairaBotFormValues['kairaBot'],
        kairaApiUrl,
        kairaAuthToken,
        kairaChatUserId,
      };
    },
    deps: [theme, timeouts, kairaBotSettings],
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
            <p className="text-[13px] text-[var(--text-secondary)]">
              LLM providers are configured by an admin in{' '}
              {canEditAISettings ? (
                <Link
                  to={routes.adminAiSettings}
                  className="font-medium text-[var(--text-brand)] hover:underline"
                >
                  AI Settings
                </Link>
              ) : (
                <span className="font-medium text-[var(--text-primary)]">AI Settings</span>
              )}
              . Per-user API keys are no longer required.
            </p>
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
    <PageSurface icon={icon} title={title}>
      <Tabs tabs={tabs} fillHeight />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </PageSurface>
  );
}
