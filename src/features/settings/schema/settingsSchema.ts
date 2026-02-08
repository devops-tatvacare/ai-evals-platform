import type { SettingDefinition } from '@/types';
import { DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_EXTRACTION_PROMPT, DEFAULT_EVALUATION_PROMPT } from '@/constants';

export const settingsSchema: SettingDefinition[] = [
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
    key: 'llm.apiKey',
    type: 'password',
    category: 'llm',
    label: 'API Key',
    description: 'Your Gemini API key for AI features',
    defaultValue: '',
    validation: {
      required: true,
    },
  },
  // Note: Model selector is now rendered as a custom component in SettingsPage
  {
    key: 'llm.transcriptionPrompt',
    type: 'textarea',
    category: 'prompts',
    label: 'Transcription Prompt',
    description: 'System prompt used when generating AI transcripts from audio. Available variables: {{audio}}, {{script_preference}}, {{language_hint}}, {{preserve_code_switching}}',
    defaultValue: DEFAULT_TRANSCRIPTION_PROMPT,
  },
  {
    key: 'llm.evaluationPrompt',
    type: 'textarea',
    category: 'prompts',
    label: 'Evaluation Prompt',
    description: 'Prompt for AI critique of transcriptions. Available variables: {{audio}}, {{transcript}}, {{llm_transcript}}, {{original_script}}, {{segment_count}}, {{speaker_list}}',
    defaultValue: DEFAULT_EVALUATION_PROMPT,
  },
  {
    key: 'llm.extractionPrompt',
    type: 'textarea',
    category: 'prompts',
    label: 'Extraction Prompt',
    description: 'Default prompt prefix for structured data extraction. Available variables: {{transcript}}',
    defaultValue: DEFAULT_EXTRACTION_PROMPT,
  },
];

export function getSettingsByCategory(category: string): SettingDefinition[] {
  return settingsSchema.filter((s) => s.category === category);
}
