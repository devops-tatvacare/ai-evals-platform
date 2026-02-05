export type ThemeMode = 'light' | 'dark' | 'system';
export type LLMProvider = 'gemini';
export type SettingCategory = 'appearance' | 'llm' | 'storage' | 'advanced' | 'prompts' | 'transcription' | 'ai' | 'chat';
export type SettingType = 'text' | 'password' | 'select' | 'toggle' | 'number' | 'textarea';

// Script/Language types for multilingual support
export type ScriptPreference = 'auto' | 'devanagari' | 'romanized' | 'original';

export interface SettingOption {
  value: string | number;
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

// Timeout configuration for LLM invocations (in seconds for UI, converted to ms internally)
export interface LLMTimeoutSettings {
  textOnly: number;          // Default: 60s - text-only prompts
  withSchema: number;        // Default: 90s - structured output with schema
  withAudio: number;         // Default: 180s - audio processing
  withAudioAndSchema: number; // Default: 240s - audio + structured output
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
    apiResponse?: string | null;   // For API flow: schema matching GeminiApiRx structure
  };
  defaultPrompts?: {             // New: default prompt IDs
    transcription: string | null;
    evaluation: string | null;
    extraction: string | null;
    apiTranscription?: string | null;  // For API flow Call 1
    apiCritique?: string | null;       // For API flow Call 2
  };
  // Note: timeouts are now in GlobalSettings, not here
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
