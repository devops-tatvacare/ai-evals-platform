/**
 * Template Variable Registry
 * Central registry of all template variables with their metadata
 */

import type { TemplateVariable, PromptType, PromptValidationResult, TemplateVariableStatus } from '@/types';

/**
 * Central registry of all template variables
 */
export const TEMPLATE_VARIABLES: Record<string, TemplateVariable> = {
  '{{audio}}': {
    key: '{{audio}}',
    type: 'file',
    description: 'Audio file for transcription/evaluation',
    availableIn: ['transcription', 'evaluation'],
    required: true,
  },
  '{{transcript}}': {
    key: '{{transcript}}',
    type: 'text',
    description: 'Original AI transcript (system under test)',
    availableIn: ['evaluation', 'extraction'],
    required: false,
  },
  '{{llm_transcript}}': {
    key: '{{llm_transcript}}',
    type: 'computed',
    description: 'Judge AI transcript (generated in Step 1)',
    availableIn: ['evaluation'],
    required: false,
  },
  // Multilingual/script-aware variables
  '{{script_preference}}': {
    key: '{{script_preference}}',
    type: 'text',
    description: 'User preference for output script (devanagari, romanized, auto)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
  },
  '{{language_hint}}': {
    key: '{{language_hint}}',
    type: 'text',
    description: 'Language hint for the audio (e.g., Hindi, Hinglish)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
  },
  '{{preserve_code_switching}}': {
    key: '{{preserve_code_switching}}',
    type: 'text',
    description: 'Whether to preserve code-switching (yes/no)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
  },
  '{{original_script}}': {
    key: '{{original_script}}',
    type: 'computed',
    description: 'Detected script of the original transcript',
    availableIn: ['evaluation'],
    required: false,
  },
  '{{segment_count}}': {
    key: '{{segment_count}}',
    type: 'computed',
    description: 'Number of segments in the original transcript',
    availableIn: ['transcription', 'evaluation'],
    required: false,
  },
  '{{speaker_list}}': {
    key: '{{speaker_list}}',
    type: 'computed',
    description: 'Comma-separated list of speakers in the transcript',
    availableIn: ['transcription', 'evaluation'],
    required: false,
  },
  '{{time_windows}}': {
    key: '{{time_windows}}',
    type: 'computed',
    description: 'Time windows from original transcript for segment-aligned transcription',
    availableIn: ['transcription'],
    required: false,
  },
};

/**
 * Get all available variables for a specific prompt type
 */
export function getAvailableVariables(promptType: PromptType): TemplateVariable[] {
  return Object.values(TEMPLATE_VARIABLES).filter(
    (variable) => variable.availableIn.includes(promptType)
  );
}

/**
 * Get required variables for a specific prompt type
 */
export function getRequiredVariables(promptType: PromptType): TemplateVariable[] {
  return getAvailableVariables(promptType).filter((v) => v.required);
}

/**
 * Extract all variable placeholders from a prompt string
 */
export function extractVariables(prompt: string): string[] {
  if (!prompt) return [];
  const regex = /\{\{[^}]+\}\}/g;
  const matches = prompt.match(regex) || [];
  return [...new Set(matches)]; // Remove duplicates
}

/**
 * Check if a variable key is a known variable
 */
export function isKnownVariable(key: string): boolean {
  return key in TEMPLATE_VARIABLES;
}

/**
 * Validate a prompt for a given context
 */
export function validatePromptVariables(
  prompt: string,
  promptType: PromptType,
  availableData: Set<string> // Keys of data that are available
): PromptValidationResult {
  const usedVariables = extractVariables(prompt);
  const availableVars = getAvailableVariables(promptType);
  const availableKeys = new Set(availableVars.map((v) => v.key));
  
  const variables: TemplateVariableStatus[] = [];
  const missingRequired: string[] = [];
  const unknownVariables: string[] = [];

  // Check each variable used in the prompt
  for (const varKey of usedVariables) {
    if (!isKnownVariable(varKey)) {
      unknownVariables.push(varKey);
      variables.push({
        key: varKey,
        available: false,
        reason: 'Unknown variable',
      });
      continue;
    }

    const varDef = TEMPLATE_VARIABLES[varKey];
    
    if (!availableKeys.has(varKey)) {
      variables.push({
        key: varKey,
        available: false,
        reason: `Not available for ${promptType} prompts`,
      });
      continue;
    }

    // Check if the data for this variable is available
    const dataAvailable = availableData.has(varKey);
    variables.push({
      key: varKey,
      available: dataAvailable,
      reason: dataAvailable ? undefined : 'Data not yet available',
    });

    // Track missing required variables
    if (varDef.required && !dataAvailable) {
      missingRequired.push(varKey);
    }
  }

  // Check for required variables that aren't in the prompt
  for (const reqVar of getRequiredVariables(promptType)) {
    if (!usedVariables.includes(reqVar.key) && !availableData.has(reqVar.key)) {
      missingRequired.push(reqVar.key);
    }
  }

  return {
    isValid: missingRequired.length === 0 && unknownVariables.length === 0,
    variables,
    missingRequired: [...new Set(missingRequired)],
    unknownVariables,
  };
}
