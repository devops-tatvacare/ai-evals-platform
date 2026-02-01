/**
 * Template Variable System Types
 * Supports dynamic variable substitution in prompts
 */

export type TemplateVariableType = 'text' | 'file' | 'computed';

export type PromptType = 'transcription' | 'evaluation' | 'extraction';

export interface TemplateVariable {
  key: string;           // e.g., '{{audio}}'
  type: TemplateVariableType;
  label: string;         // Human-readable label e.g., 'Audio File'
  description: string;
  availableIn: PromptType[];
  required?: boolean;
  requiredFor?: PromptType[]; // Which prompt types require this variable
}

export interface TemplateVariableStatus {
  key: string;
  available: boolean;
  reason?: string;       // Why unavailable
  value?: string | Blob; // Resolved value if available
}

export interface PromptValidationResult {
  isValid: boolean;
  variables: TemplateVariableStatus[];
  missingRequired: string[];
  unknownVariables: string[];
}

export interface ResolvedPrompt {
  prompt: string;
  resolvedVariables: Map<string, string | Blob>;
  unresolvedVariables: string[];
}
