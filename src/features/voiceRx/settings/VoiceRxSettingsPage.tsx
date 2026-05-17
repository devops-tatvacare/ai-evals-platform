import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { useGlobalSettingsStore, useVoiceRxSettings, useAppSettingsStore } from '@/stores';
import { Card, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import { usePermission } from '@/utils/permissions';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CollapsibleSection } from '../../settings/components/CollapsibleSection';
import { SettingsSaveBar } from '../../settings/components/SettingsSaveBar';
import { TemplatesTab } from '../../settings/components/TemplatesTab';
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
  const { icon, title } = usePageMetadata('settings');

  const theme = useGlobalSettingsStore((s) => s.theme);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const { settings: voiceRxSettings, updateSettings: updateVoiceRxSettings } = useVoiceRxSettings();
  const canEditAISettings = usePermission('configuration:edit');

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
        timeouts: { ...timeouts } as LLMTimeoutSettings,
        voiceRx: voiceRxPrefs as VoiceRxFormValues['voiceRx'],
        voiceRxApiUrl,
        voiceRxApiKey,
      };
    },
    deps: [theme, timeouts, voiceRxSettings],
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
