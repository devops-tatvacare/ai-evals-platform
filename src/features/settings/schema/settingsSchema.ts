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
  // Transcription preferences for multilingual support
  {
    key: 'transcription.scriptPreference',
    type: 'select',
    category: 'transcription',
    label: 'Script Preference',
    description: 'Preferred script for AI transcription (Call 1) and normalization target. Controls which script the AI outputs when transcribing audio.',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: 'Auto (detect from audio)' },
      { value: 'devanagari', label: 'Devanagari (देवनागरी)' },
      { value: 'romanized', label: 'Romanized (Latin script)' },
      { value: 'original', label: 'Match original transcript' },
    ],
  },
  {
    key: 'transcription.languageHint',
    type: 'text',
    category: 'transcription',
    label: 'Language Hint',
    description: 'Optional language hint (e.g., Hindi, English, Hinglish, Tamil)',
    defaultValue: '',
  },
  {
    key: 'transcription.preserveCodeSwitching',
    type: 'toggle',
    category: 'transcription',
    label: 'Preserve Code-Switching',
    description: 'Keep English words like "BP", "CPR" in Hindi transcripts',
    defaultValue: true,
  },
  // LLM Timeout Settings
  {
    key: 'llm.timeouts.textOnly',
    type: 'number',
    category: 'llm',
    label: 'Text-Only Timeout (seconds)',
    description: 'Timeout for simple text prompts without audio or schema',
    defaultValue: 60,
    validation: {
      min: 10,
      max: 600,
    },
  },
  {
    key: 'llm.timeouts.withSchema',
    type: 'number',
    category: 'llm',
    label: 'Schema Output Timeout (seconds)',
    description: 'Timeout for structured JSON output with schema',
    defaultValue: 90,
    validation: {
      min: 10,
      max: 600,
    },
  },
  {
    key: 'llm.timeouts.withAudio',
    type: 'number',
    category: 'llm',
    label: 'Audio Processing Timeout (seconds)',
    description: 'Timeout for audio transcription and analysis',
    defaultValue: 180,
    validation: {
      min: 30,
      max: 900,
    },
  },
  {
    key: 'llm.timeouts.withAudioAndSchema',
    type: 'number',
    category: 'llm',
    label: 'Audio + Schema Timeout (seconds)',
    description: 'Timeout for audio processing with structured output',
    defaultValue: 240,
    validation: {
      min: 30,
      max: 900,
    },
  },
];

export function getSettingsByCategory(category: string): SettingDefinition[] {
  return settingsSchema.filter((s) => s.category === category);
}
