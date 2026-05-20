import { useCallback } from 'react';
import { Link } from 'react-router-dom';

import { useGlobalSettingsStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { Alert, Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import { userHasPermission } from '@/utils/permissions';
import { useCurrentAppConfig } from '@/hooks';
import { SettingsPanel } from '@/features/settings/components/SettingsPanel';
import { CollapsibleSection } from '@/features/settings/components/CollapsibleSection';
import { SettingsSaveBar } from '@/features/settings/components/SettingsSaveBar';
import { TemplatesTab } from '@/features/settings/components/TemplatesTab';
import { getGlobalSettingsByCategory } from '@/features/settings/schemas/globalSettingsSchema';
import { useSettingsForm } from '@/features/settings/hooks/useSettingsForm';
import { resolveSettingsTabs, type SettingsTabSpec } from '@/features/settings/settingsTabs';
import { useNotificationsSettings } from '@/features/accountSettings/email/useNotificationsSettings';
import { notificationsSettingsTab } from '@/features/accountSettings/email/notificationsTab';
import type { NotificationsFormValue } from '@/features/accountSettings/email/notificationsForm';
import type { LLMTimeoutSettings } from '@/types';
import type { BaseFormValues } from '@/features/settings/hooks/useSettingsForm';

interface InsideSalesFormValues extends BaseFormValues {
  notifications: NotificationsFormValue;
}

export function InsideSalesSettings() {
  const { icon, title } = usePageMetadata('settings');
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const features = useCurrentAppConfig().features;
  const user = useAuthStore((s) => s.user);
  const can = useCallback((action: string) => userHasPermission(user, action), [user]);
  const notifications = useNotificationsSettings(features.hasNotifications);

  const onSaveApp = useCallback(
    async (form: InsideSalesFormValues, store: InsideSalesFormValues) => {
      if (notifications.enabled) {
        await notifications.save(form.notifications, store.notifications);
      }
    },
    [notifications],
  );

  const { formValues, isDirty, isSaving, handleChange, handleSave, handleDiscard } =
    useSettingsForm<InsideSalesFormValues>({
      buildStoreValues: () => ({
        theme,
        timeouts: { ...timeouts } as LLMTimeoutSettings,
        notifications: notifications.storeValue,
      }),
      deps: [theme, timeouts, notifications.storeValue],
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
            <Link
              to={routes.adminLlmProviders}
              className="font-medium text-[var(--text-brand)] hover:underline"
            >
              AI Settings
            </Link>
            . Per-user API keys are no longer required.
          </Alert>
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
  ];

  const tabs = resolveSettingsTabs(specs, { features, can });

  return (
    <PageSurface icon={icon} title={title}>
      <Tabs tabs={tabs} fillHeight />
      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </PageSurface>
  );
}
