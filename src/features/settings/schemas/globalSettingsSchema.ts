/**
 * Global Settings Schema
 * Settings shared across all apps (Theme, API Key, Models, Timeouts)
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
  // LLM Timeout Settings (Global)
  {
    key: 'timeouts.textOnly',
    type: 'number',
    category: 'ai',
    label: 'Text-Only Timeout (seconds)',
    description: 'Timeout for simple text prompts without audio or schema',
    defaultValue: 60,
    validation: {
      min: 10,
      max: 600,
    },
  },
  {
    key: 'timeouts.withSchema',
    type: 'number',
    category: 'ai',
    label: 'Schema Output Timeout (seconds)',
    description: 'Timeout for structured JSON output with schema',
    defaultValue: 90,
    validation: {
      min: 10,
      max: 600,
    },
  },
  {
    key: 'timeouts.withAudio',
    type: 'number',
    category: 'ai',
    label: 'Audio Processing Timeout (seconds)',
    description: 'Timeout for audio transcription and analysis',
    defaultValue: 180,
    validation: {
      min: 30,
      max: 900,
    },
  },
  {
    key: 'timeouts.withAudioAndSchema',
    type: 'number',
    category: 'ai',
    label: 'Audio + Schema Timeout (seconds)',
    description: 'Timeout for audio processing with structured output',
    defaultValue: 240,
    validation: {
      min: 30,
      max: 900,
    },
  },
];

export function getGlobalSettingsByCategory(category: string): SettingDefinition[] {
  return globalSettingsSchema.filter((s) => s.category === category);
}
