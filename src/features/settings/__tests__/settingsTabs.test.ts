import { describe, expect, it } from 'vitest';
import { resolveSettingsTabs, type SettingsTabSpec } from '../settingsTabs';
import { APP_CONFIG_FALLBACKS } from '@/types';

const specs: SettingsTabSpec[] = [
  { id: 'appearance', label: 'Appearance', content: null },
  { id: 'notifications', label: 'Notifications', content: null, feature: 'hasNotifications' },
  { id: 'ai', label: 'AI', content: null, requires: 'configuration:edit' },
];

const insideSales = APP_CONFIG_FALLBACKS['inside-sales'].features;
const voiceRx = APP_CONFIG_FALLBACKS['voice-rx'].features;

describe('resolveSettingsTabs', () => {
  it('keeps open tabs for a user with no permissions', () => {
    const tabs = resolveSettingsTabs(specs, { features: insideSales, can: () => false });
    expect(tabs.map((t) => t.id)).toEqual(['appearance', 'notifications']);
  });

  it('adds permission-gated tabs only when the user holds the action', () => {
    const tabs = resolveSettingsTabs(specs, {
      features: insideSales,
      can: (a) => a === 'configuration:edit',
    });
    expect(tabs.map((t) => t.id)).toEqual(['appearance', 'notifications', 'ai']);
  });

  it('drops a feature-gated tab when the app config flag is off', () => {
    const tabs = resolveSettingsTabs(specs, { features: voiceRx, can: () => true });
    expect(tabs.map((t) => t.id)).toEqual(['appearance', 'ai']);
  });
});
