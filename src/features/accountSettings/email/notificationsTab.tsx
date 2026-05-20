import type { SettingsTabSpec } from '@/features/settings/settingsTabs';
import { emailSettingsCopy } from './emailSettings.copy';
import { NotificationsSettingsTab } from './components/NotificationsSettingsTab';
import type { NotificationsFormValue } from './notificationsForm';
import type { NotificationsSettings } from './useNotificationsSettings';

// Shared spec for the config-gated Notifications tab so the app settings pages don't duplicate it.
export function notificationsSettingsTab(
  notifications: NotificationsSettings,
  value: NotificationsFormValue,
  onChange: (next: NotificationsFormValue) => void,
): SettingsTabSpec {
  return {
    id: 'notifications',
    label: emailSettingsCopy.tabLabel,
    feature: 'hasNotifications',
    content: (
      <NotificationsSettingsTab
        value={value}
        onChange={onChange}
        loading={notifications.loading}
        isError={notifications.isError}
        recentSends={notifications.recentSends}
        recentLoading={notifications.recentLoading}
        recentError={notifications.recentError}
      />
    ),
  };
}
