/**
 * App-Specific Settings Schema
 * Settings unique to each app
 */

import type { SettingDefinition } from '@/types';

// Voice Rx specific settings
export const voiceRxSettingsSchema: SettingDefinition[] = [
  {
    key: 'scriptType',
    type: 'select',
    category: 'transcription',
    label: 'Script Preference',
    description: 'Controls which script the AI judge uses for transcription',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: 'Auto (detect from audio)' },
      { value: 'devanagari', label: 'Devanagari (देवनागरी)' },
      { value: 'romanized', label: 'Romanized (Latin script)' },
      { value: 'original', label: 'Match original transcript' },
    ],
  },
  {
    key: 'languageHint',
    type: 'text',
    category: 'transcription',
    label: 'Language Hint',
    description: 'Optional language hint (e.g., Hindi, English, Hinglish, Tamil)',
    defaultValue: '',
  },
  {
    key: 'preserveCodeSwitching',
    type: 'toggle',
    category: 'transcription',
    label: 'Preserve Code-Switching',
    description: 'Keep English words like "BP", "CPR" in Hindi transcripts',
    defaultValue: true,
  },
];

// Kaira Bot specific settings
export const kairaBotSettingsSchema: SettingDefinition[] = [
  {
    key: 'contextWindowSize',
    type: 'select',
    category: 'chat',
    label: 'Context Window',
    description: 'Maximum tokens to include in chat context',
    defaultValue: 4096,
    options: [
      { value: 2048, label: '2K tokens (Fast)' },
      { value: 4096, label: '4K tokens (Recommended)' },
      { value: 8192, label: '8K tokens (Extended)' },
      { value: 16384, label: '16K tokens (Maximum)' },
    ],
  },
  {
    key: 'maxResponseLength',
    type: 'select',
    category: 'chat',
    label: 'Max Response Length',
    description: 'Maximum length of AI responses',
    defaultValue: 2048,
    options: [
      { value: 512, label: 'Short (512 tokens)' },
      { value: 1024, label: 'Medium (1K tokens)' },
      { value: 2048, label: 'Long (2K tokens)' },
      { value: 4096, label: 'Extended (4K tokens)' },
    ],
  },
  {
    key: 'historyRetentionDays',
    type: 'select',
    category: 'chat',
    label: 'History Retention',
    description: 'How long to keep chat history',
    defaultValue: 30,
    options: [
      { value: 7, label: '7 days' },
      { value: 14, label: '14 days' },
      { value: 30, label: '30 days' },
      { value: 90, label: '90 days' },
      { value: 365, label: '1 year' },
    ],
  },
  {
    key: 'streamResponses',
    type: 'toggle',
    category: 'chat',
    label: 'Stream Responses',
    description: 'Show AI responses as they are generated',
    defaultValue: true,
  },
];

export function getVoiceRxSettingsByCategory(category: string): SettingDefinition[] {
  return voiceRxSettingsSchema.filter((s) => s.category === category);
}

export function getKairaBotSettingsByCategory(category: string): SettingDefinition[] {
  return kairaBotSettingsSchema.filter((s) => s.category === category);
}
