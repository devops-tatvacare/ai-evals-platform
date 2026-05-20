import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useGlobalSettingsStore, useKairaBotSettings, useAppSettingsStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { Alert, Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import { userHasPermission } from '@/utils/permissions';
import { useCurrentAppConfig } from '@/hooks';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { TemplatesTab } from '../../settings/components/TemplatesTab';
import { EvaluationContractsTab } from './AdversarialCatalogTab';
import { getGlobalSettingsByCategory } from '../../settings/schemas/globalSettingsSchema';
import { getKairaBotSettingsByCategory } from '../../settings/schemas/appSettingsSchema';
import { useSettingsForm } from '../../settings/hooks/useSettingsForm';
import { resolveSettingsTabs, type SettingsTabSpec } from '@/features/settings/settingsTabs';
import { useNotificationsSettings } from '@/features/accountSettings/email/useNotificationsSettings';
import { notificationsSettingsTab } from '@/features/accountSettings/email/notificationsTab';
import type { NotificationsFormValue } from '@/features/accountSettings/email/notificationsForm';
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
  notifications: NotificationsFormValue;
}

export function KairaBotSettingsPage() {
  const { icon, title } = usePageMetadata('settings');
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const { settings: kairaBotSettings, updateSettings: updateKairaBotSettings } = useKairaBotSettings();
  const features = useCurrentAppConfig().features;
  const user = useAuthStore((s) => s.user);
  const can = useCallback((action: string) => userHasPermission(user, action), [user]);
  const canEditConfiguration = can('configuration:edit');
  const notifications = useNotificationsSettings(features.hasNotifications);

  useEffect(() => {
    if (canEditConfiguration) {
      useAppSettingsStore.getState().loadCredentialsFromBackend('kaira-bot');
    }
  }, [canEditConfiguration]);

  const onSaveApp = useCallback(async (form: KairaBotFormValues, store: KairaBotFormValues) => {
    if (canEditConfiguration) {
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
    }
    if (notifications.enabled) {
      await notifications.save(form.notifications, store.notifications);
    }
  }, [updateKairaBotSettings, canEditConfiguration, notifications]);

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
        notifications: notifications.storeValue,
      };
    },
    deps: [theme, timeouts, kairaBotSettings, notifications.storeValue],
    onSaveApp,
  });

  const notificationsValue = formValues.notifications;

  const specs: SettingsTabSpec[] = [
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <Card>
          <SettingsPanel settings={getGlobalSettingsByCategory('appearance')} values={formValues} onChange={handleChange} layout="inline" />
        </Card>
      ),
    },
    notificationsSettingsTab(notifications, notificationsValue, (next) => handleChange('notifications', next)),
    {
      id: 'ai',
      label: 'API Configuration',
      requires: 'configuration:edit',
      content: (
        <div className="space-y-4">
          <Alert variant="info">
            LLM providers are configured by an admin in{' '}
            <Link to={routes.adminLlmProviders} className="font-medium text-[var(--text-brand)] hover:underline">
              AI Settings
            </Link>
            . Per-user API keys are no longer required.
          </Alert>
          <CollapsibleSection title="Kaira Bot API" subtitle="AI Orchestrator endpoint, auth token, and default user">
            <SettingsPanel settings={getKairaBotSettingsByCategory('api')} values={formValues} onChange={handleChange} layout="inline" />
          </CollapsibleSection>
          <CollapsibleSection title="Timeouts" subtitle="LLM request timeout durations (in seconds)">
            <SettingsPanel settings={getGlobalSettingsByCategory('timeouts')} values={formValues} onChange={handleChange} layout="inline" />
          </CollapsibleSection>
        </div>
      ),
    },
    {
      id: 'templates',
      label: 'Templates',
      requires: 'configuration:edit',
      content: <Card><TemplatesTab /></Card>,
    },
    {
      id: 'adversarial',
      label: 'Evaluation Contracts',
      requires: 'configuration:edit',
      content: <EvaluationContractsTab />,
    },
  ];

  const tabs = resolveSettingsTabs(specs, { features, can });

  return (
    <PageSurface icon={icon} title={title}>
      <Tabs tabs={tabs} fillHeight />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </PageSurface>
  );
}
