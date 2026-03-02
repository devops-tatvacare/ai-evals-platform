export type ThemeMode = 'light' | 'dark' | 'system';
export type LLMProvider = 'gemini' | 'openai' | 'azure_openai' | 'anthropic';
export type GeminiAuthMethod = 'api_key' | 'service_account';
export type SettingCategory = 'appearance' | 'llm' | 'storage' | 'advanced' | 'prompts' | 'ai' | 'chat' | 'timeouts' | 'api';
export type SettingType = 'text' | 'password' | 'select' | 'toggle' | 'number' | 'textarea' | 'file';

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
  /** Per-provider API keys */
  geminiApiKey: string;
  openaiApiKey: string;
  azureOpenaiApiKey: string;
  azureOpenaiEndpoint: string;
  azureOpenaiApiVersion: string;
  anthropicApiKey: string;
  activeSchemaIds: {
    transcription: string | null;
    evaluation: string | null;
    extraction: string | null;
  };
  activePromptIds: {
    transcription: string | null;
    evaluation: string | null;
    extraction: string | null;
  };
  /** Gemini auth method: API key or service account */
  geminiAuthMethod: GeminiAuthMethod;
}
