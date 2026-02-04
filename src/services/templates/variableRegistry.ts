/**
 * Template Variable Registry
 * Central registry of all template variables with their metadata
 */

import type { TemplateVariable, PromptType, PromptValidationResult, TemplateVariableStatus, ListingSourceType } from '@/types';

/**
 * Central registry of all template variables
 */
export const TEMPLATE_VARIABLES: Record<string, TemplateVariable> = {
  '{{audio}}': {
    key: '{{audio}}',
    type: 'file',
    label: 'Audio',
    description: 'Audio file for transcription/evaluation',
    availableIn: ['transcription', 'evaluation'],
    required: true,
    compatibleFlows: ['upload', 'api'],
  },
  '{{transcript}}': {
    key: '{{transcript}}',
    type: 'text',
    label: 'Original Transcript',
    description: 'Original AI transcript (system under test)',
    availableIn: ['evaluation', 'extraction'],
    required: false,
    compatibleFlows: ['upload', 'api'],
  },
  '{{llm_transcript}}': {
    key: '{{llm_transcript}}',
    type: 'computed',
    label: 'Judge Transcript',
    description: 'Judge AI transcript (generated in Step 1)',
    availableIn: ['evaluation'],
    required: false,
    compatibleFlows: ['upload', 'api'],
  },
  // Multilingual/script-aware variables
  '{{script_preference}}': {
    key: '{{script_preference}}',
    type: 'text',
    label: 'Script Preference',
    description: 'User preference for output script (devanagari, romanized, auto)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
    compatibleFlows: ['upload', 'api'],
  },
  '{{language_hint}}': {
    key: '{{language_hint}}',
    type: 'text',
    label: 'Language Hint',
    description: 'Language hint for the audio (e.g., Hindi, Hinglish)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
    compatibleFlows: ['upload', 'api'],
  },
  '{{preserve_code_switching}}': {
    key: '{{preserve_code_switching}}',
    type: 'text',
    label: 'Code Switching',
    description: 'Whether to preserve code-switching (yes/no)',
    availableIn: ['transcription', 'evaluation'],
    required: false,
    compatibleFlows: ['upload', 'api'],
  },
  '{{original_script}}': {
    key: '{{original_script}}',
    type: 'computed',
    label: 'Detected Script',
    description: 'Detected script of the original transcript',
    availableIn: ['evaluation'],
    required: false,
    compatibleFlows: ['upload'],
  },
  '{{segment_count}}': {
    key: '{{segment_count}}',
    type: 'computed',
    label: 'Segment Count',
    description: 'Number of segments in the original transcript',
    availableIn: ['transcription', 'evaluation'],
    required: false,
    compatibleFlows: ['upload'], // Only for segment-based upload flow
  },
  '{{speaker_list}}': {
    key: '{{speaker_list}}',
    type: 'computed',
    label: 'Speakers',
    description: 'Comma-separated list of speakers in the transcript',
    availableIn: ['transcription', 'evaluation'],
    required: false,
    compatibleFlows: ['upload'], // Only for segment-based upload flow
  },
  '{{time_windows}}': {
    key: '{{time_windows}}',
    type: 'computed',
    label: 'Time Windows',
    description: 'Time windows from original transcript for segment-aligned transcription',
    availableIn: ['transcription'],
    required: false,
    requiredFor: ['transcription'], // Required specifically for transcription prompts (upload flow only)
    compatibleFlows: ['upload'], // Only for segment-based upload flow
  },
  '{{structured_output}}': {
    key: '{{structured_output}}',
    type: 'text',
    label: 'Structured Output',
    description: 'AI-generated structured data (rx object) from API response',
    availableIn: ['evaluation'],
    required: false,
    compatibleFlows: ['api'], // Only for API flow evaluation
  },
};

/**
 * Get all available variables for a specific prompt type and source type
 */
export function getAvailableVariables(
  promptType: PromptType,
  sourceType?: ListingSourceType
): TemplateVariable[] {
  return Object.values(TEMPLATE_VARIABLES).filter((variable) => {
    const availableForPrompt = variable.availableIn.includes(promptType);
    if (!sourceType) return availableForPrompt;
    
    // Filter by flow compatibility if specified
    const compatibleFlows = variable.compatibleFlows || ['upload', 'api'];
    return availableForPrompt && compatibleFlows.includes(sourceType);
  });
}

/**
 * Get required variables for a specific prompt type and source type
 */
export function getRequiredVariables(
  promptType: PromptType,
  sourceType?: ListingSourceType
): TemplateVariable[] {
  return getAvailableVariables(promptType, sourceType).filter((v) => v.required);
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
  availableData: Set<string>, // Keys of data that are available
  sourceType?: ListingSourceType
): PromptValidationResult {
  const usedVariables = extractVariables(prompt);
  const availableVars = getAvailableVariables(promptType, sourceType);
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
    
    // Check flow compatibility
    if (sourceType) {
      const compatibleFlows = varDef.compatibleFlows || ['upload', 'api'];
      if (!compatibleFlows.includes(sourceType)) {
        variables.push({
          key: varKey,
          available: false,
          reason: `Not compatible with ${sourceType} flow`,
        });
        continue;
      }
    }
    
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
  for (const reqVar of getRequiredVariables(promptType, sourceType)) {
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
