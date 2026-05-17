export type ThemeMode = 'light' | 'dark' | 'system';
export type AssetVisibility = 'private' | 'shared';
export type LegacyAssetVisibility = AssetVisibility | 'app';
export type SettingCategory = 'appearance' | 'llm' | 'storage' | 'advanced' | 'prompts' | 'ai' | 'chat' | 'timeouts' | 'api';
export type SettingType = 'text' | 'password' | 'select' | 'toggle' | 'number' | 'textarea' | 'file';

export interface SettingRecord<TValue = unknown> {
  id: number;
  appId: string | null;
  key: string;
  value: TValue;
  visibility: AssetVisibility;
  forkedFrom?: number | null;
  updatedAt: Date;
  userId: string;
  sharedBy?: string | null;
  sharedAt?: Date | null;
}

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

export function normalizeAssetVisibility(visibility: LegacyAssetVisibility | null | undefined): AssetVisibility {
  return visibility === 'app' || visibility === 'shared' ? 'shared' : 'private';
}
