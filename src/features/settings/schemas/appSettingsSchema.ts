/**
 * App-Specific Settings Schema
 * Settings unique to each app
 */

import type { SettingDefinition } from '@/types';
import { SCRIPTS } from '@/constants/scripts';

// Build script options from registry: "auto" + all named scripts + "original"
const scriptSettingOptions = [
  { value: 'auto', label: 'Auto (detect from audio)' },
  ...SCRIPTS.filter((s) => s.id !== 'auto').map((s) => ({
    value: s.id,
    label: s.name,
  })),
  { value: 'original', label: 'Match original transcript' },
];

// Voice Rx specific settings
export const voiceRxSettingsSchema: SettingDefinition[] = [
  {
    key: 'scriptType',
    type: 'select',
    category: 'ai',
    label: 'Script Preference',
    description: 'Controls which script the AI judge uses for transcription',
    defaultValue: 'auto',
    options: scriptSettingOptions,
  },
  {
    key: 'languageHint',
    type: 'text',
    category: 'ai',
    label: 'Language Hint',
    description: 'Optional language hint (e.g., Hindi, English, Arabic, Tamil)',
    defaultValue: '',
  },
  {
    key: 'preserveCodeSwitching',
    type: 'toggle',
    category: 'ai',
    label: 'Preserve Code-Switching',
    description: 'Keep foreign-language terms in multilingual transcripts',
    defaultValue: true,
  },
  // API settings
  {
    key: 'voiceRxApiUrl',
    type: 'text',
    category: 'api',
    label: 'Transcription API URL',
    description: 'Endpoint for the Voice RX transcription service',
    defaultValue: 'https://pm-voice-rx-openai-prod.tatvacare.in/gemini-transcribe',
  },
  {
    key: 'voiceRxApiKey',
    type: 'password',
    category: 'api',
    label: 'Transcription API Key',
    description: 'Authentication key for the transcription API',
    defaultValue: '',
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
  // API settings
  {
    key: 'kairaApiUrl',
    type: 'text',
    category: 'api',
    label: 'Kaira API URL',
    description: 'Base URL for the Kaira AI Orchestrator',
    defaultValue: 'https://mytatva-ai-orchestrator-prod.goodflip.in',
  },
  {
    key: 'kairaAuthToken',
    type: 'password',
    category: 'api',
    label: 'Auth Token',
    description: 'Authentication token for the Kaira API',
    defaultValue: '',
  },
  {
    key: 'kairaChatUserId',
    type: 'text',
    category: 'api',
    label: 'Default User ID',
    description: 'Default user ID for Kaira chat sessions',
    defaultValue: 'c22a5505-f514-11f0-9722-000d3a3e18d5',
  },
];

export function getVoiceRxSettingsByCategory(category: string): SettingDefinition[] {
  return voiceRxSettingsSchema.filter((s) => s.category === category);
}

export function getKairaBotSettingsByCategory(category: string): SettingDefinition[] {
  return kairaBotSettingsSchema.filter((s) => s.category === category);
}
