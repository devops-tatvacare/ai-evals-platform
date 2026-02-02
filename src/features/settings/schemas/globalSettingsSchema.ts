/**
 * Global Settings Schema
 * Settings shared across all apps (Theme, API Key, Models)
 */

import type { SettingDefinition } from '@/types';

export const globalSettingsSchema: SettingDefinition[] = [
  {
    key: 'theme',
    type: 'select',
    category: 'appearance',
    label: 'Theme',
    description: 'Choose your preferred color scheme',
    defaultValue: 'system',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ],
  },
  {
    key: 'apiKey',
    type: 'password',
    category: 'ai',
    label: 'API Key',
    description: 'Your Gemini API key for AI features. This key is shared across all apps.',
    defaultValue: '',
    validation: {
      required: true,
    },
  },
];

export function getGlobalSettingsByCategory(category: string): SettingDefinition[] {
  return globalSettingsSchema.filter((s) => s.category === category);
}
