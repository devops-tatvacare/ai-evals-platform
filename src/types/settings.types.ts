export type ThemeMode = 'light' | 'dark' | 'system';
export type LLMProvider = 'gemini';
export type SettingCategory = 'appearance' | 'llm' | 'storage' | 'advanced' | 'prompts' | 'transcription';
export type SettingType = 'text' | 'password' | 'select' | 'toggle' | 'number' | 'textarea';

// Script/Language types for multilingual support
export type ScriptPreference = 'auto' | 'devanagari' | 'romanized' | 'original';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingValidation {
  required?: boolean;
  pattern?: RegExp;
  min?: number;
  max?: number;
}

export interface SettingDependency {
  key: string;
  value: unknown;
}

export interface SettingDefinition {
  key: string;
  type: SettingType;
  category: SettingCategory;
  label: string;
  description?: string;
  defaultValue: unknown;
  validation?: SettingValidation;
  options?: SettingOption[];
  dependsOn?: SettingDependency;
}

export interface LLMSettings {
  provider: LLMProvider;
  apiKey: string;
  selectedModel: string;
  transcriptionPrompt: string;  // Legacy: kept for backwards compatibility
  evaluationPrompt: string;     // Legacy: kept for backwards compatibility
  extractionPrompt: string;     // Legacy: kept for backwards compatibility
  defaultSchemas: {
    transcription: string | null;  // Schema ID
    evaluation: string | null;
    extraction: string | null;
  };
  defaultPrompts?: {             // New: default prompt IDs
    transcription: string | null;
    evaluation: string | null;
    extraction: string | null;
  };
}

// Transcription preferences for multilingual support
export interface TranscriptionPreferences {
  scriptPreference: ScriptPreference;
  languageHint: string;
  preserveCodeSwitching: boolean;
}

export interface AppSettings {
  theme: ThemeMode;
  llm: LLMSettings;
  transcription: TranscriptionPreferences;
}
