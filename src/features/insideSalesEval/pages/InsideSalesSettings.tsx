import { useCallback } from 'react';
import { Link } from 'react-router-dom';

import { useGlobalSettingsStore } from '@/stores';
import { Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import { usePermission } from '@/utils/permissions';
import { SettingsPanel } from '@/features/settings/components/SettingsPanel';
import { CollapsibleSection } from '@/features/settings/components/CollapsibleSection';
import { SettingsSaveBar } from '@/features/settings/components/SettingsSaveBar';
import { TemplatesTab } from '@/features/settings/components/TemplatesTab';
import { getGlobalSettingsByCategory } from '@/features/settings/schemas/globalSettingsSchema';
import { useSettingsForm } from '@/features/settings/hooks/useSettingsForm';
import type { LLMTimeoutSettings } from '@/types';
import type { BaseFormValues } from '@/features/settings/hooks/useSettingsForm';

type InsideSalesFormValues = BaseFormValues;

export function InsideSalesSettings() {
  const { icon, title } = usePageMetadata('settings');
  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const canEditAISettings = usePermission('configuration:edit');

  const onSaveApp = useCallback(async () => {
    // No app-specific settings to save yet
  }, []);

  const {
    formValues, isDirty, isSaving, handleChange, handleSave, handleDiscard,
  } = useSettingsForm<InsideSalesFormValues>({
    buildStoreValues: () => ({
      theme,
      timeouts: { ...timeouts } as LLMTimeoutSettings,
    }),
    deps: [theme, timeouts],
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
                  to={routes.adminLlmProviders}
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
