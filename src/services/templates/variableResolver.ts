/**
 * Variable Resolver
 * Resolves template variables from listing/evaluation context
 */

import type { Listing, AIEvaluation, TranscriptData, TemplateVariableStatus, ResolvedPrompt, EvaluationPrerequisites } from '@/types';
import { extractVariables, isKnownVariable } from './variableRegistry';
import { detectTranscriptScript } from '@/services/normalization';
import { getNestedValue } from './apiVariableExtractor';

/**
 * Context for resolving variables
 */
export interface VariableContext {
  listing: Listing;
  aiEval?: AIEvaluation;
  audioBlob?: Blob;
  prerequisites?: EvaluationPrerequisites;
}

/**
 * Format transcript data as text for prompt inclusion
 */
function formatTranscriptAsText(transcript: TranscriptData): string {
  return transcript.segments
    .map((seg) => `[${seg.speaker}]: ${seg.text}`)
    .join('\n');
}

/**
 * Extract unique speakers from transcript
 */
function extractSpeakers(transcript: TranscriptData): string[] {
  const speakers = new Set<string>();
  transcript.segments.forEach(seg => speakers.add(seg.speaker));
  return Array.from(speakers);
}

/**
 * Extract time windows from transcript for segment-aligned transcription
 * Returns formatted string for prompt injection
 */
function extractTimeWindows(transcript: TranscriptData): string {
  return transcript.segments
    .map((seg, idx) => {
      const start = seg.startTime || '00:00:00';
      const end = seg.endTime || '00:00:00';
      return `${idx + 1}. [${start} - ${end}] Speaker hint: ${seg.speaker}`;
    })
    .join('\n');
}

/**
 * Resolve a single variable from the context
 */
export function resolveVariable(
  key: string,
  context: VariableContext
): TemplateVariableStatus {
  if (!isKnownVariable(key)) {
    return {
      key,
      available: false,
      reason: 'Unknown variable',
    };
  }

  switch (key) {
    case '{{audio}}': {
      if (context.audioBlob) {
        return {
          key,
          available: true,
          value: context.audioBlob,
        };
      }
      return {
        key,
        available: false,
        reason: 'Audio file not loaded',
      };
    }

    case '{{transcript}}': {
      const transcript = context.listing.transcript;
      if (transcript) {
        return {
          key,
          available: true,
          value: formatTranscriptAsText(transcript),
        };
      }
      return {
        key,
        available: false,
        reason: 'Original transcript not available',
      };
    }

    case '{{llm_transcript}}': {
      const llmTranscript = context.aiEval?.llmTranscript;
      if (llmTranscript) {
        return {
          key,
          available: true,
          value: formatTranscriptAsText(llmTranscript),
        };
      }
      return {
        key,
        available: false,
        reason: 'AI transcript not yet generated (requires Call 1)',
      };
    }

    // Multilingual variables (from prerequisites)
    case '{{script_preference}}': {
      const pref = context.prerequisites?.targetScript || 'roman';
      return {
        key,
        available: true,
        value: pref,
      };
    }

    case '{{language_hint}}': {
      const hint = context.prerequisites?.language || '';
      return {
        key,
        available: true,
        value: hint || 'Not specified',
      };
    }

    case '{{preserve_code_switching}}': {
      const preserve = context.prerequisites?.preserveCodeSwitching ?? true;
      return {
        key,
        available: true,
        value: preserve ? 'yes' : 'no',
      };
    }

    case '{{original_script}}': {
      const transcript = context.listing.transcript;
      if (transcript) {
        const detection = detectTranscriptScript(transcript);
        return {
          key,
          available: true,
          value: detection.primaryScript,
        };
      }
      return {
        key,
        available: false,
        reason: 'Original transcript not available for script detection',
      };
    }

    case '{{segment_count}}': {
      const transcript = context.listing.transcript;
      if (transcript) {
        return {
          key,
          available: true,
          value: String(transcript.segments.length),
        };
      }
      return {
        key,
        available: false,
        reason: 'Original transcript not available',
      };
    }

    case '{{speaker_list}}': {
      const transcript = context.listing.transcript;
      if (transcript) {
        const speakers = extractSpeakers(transcript);
        return {
          key,
          available: true,
          value: speakers.join(', '),
        };
      }
      return {
        key,
        available: false,
        reason: 'Original transcript not available',
      };
    }

    case '{{time_windows}}': {
      const transcript = context.listing.transcript;
      if (transcript && transcript.segments.length > 0) {
        return {
          key,
          available: true,
          value: extractTimeWindows(transcript),
        };
      }
      return {
        key,
        available: false,
        reason: 'Original transcript not available or has no segments',
      };
    }

    case '{{structured_output}}': {
      const apiResponse = context.listing.apiResponse;
      if (apiResponse) {
        const apiResponseObj = apiResponse as unknown as Record<string, unknown>;
        if (apiResponseObj.rx) {
          return {
            key,
            available: true,
            value: JSON.stringify(apiResponseObj.rx, null, 2),
          };
        }
      }
      return {
        key,
        available: false,
        reason: 'API structured output (rx) not available',
      };
    }

    case '{{api_input}}': {
      const apiResponse = context.listing.apiResponse;
      if (apiResponse && (apiResponse as unknown as Record<string, unknown>).input) {
        const input = (apiResponse as unknown as Record<string, unknown>).input;
        return {
          key,
          available: true,
          value: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        };
      }
      return {
        key,
        available: false,
        reason: 'API input not available',
      };
    }

    case '{{api_rx}}': {
      const apiResponse = context.listing.apiResponse;
      if (apiResponse) {
        return {
          key,
          available: true,
          value: JSON.stringify(apiResponse, null, 2),
        };
      }
      return {
        key,
        available: false,
        reason: 'API response not available',
      };
    }

    case '{{llm_structured}}': {
      const judgeOutput = context.aiEval?.judgeOutput;
      if (judgeOutput && judgeOutput.structuredData) {
        return {
          key,
          available: true,
          value: JSON.stringify(judgeOutput.structuredData, null, 2),
        };
      }
      return {
        key,
        available: false,
        reason: 'LLM structured output not yet generated (requires Call 1)',
      };
    }

    default:
      return {
        key,
        available: false,
        reason: `Resolver not implemented for ${key}`,
      };
  }
}

/**
 * Resolve all variables found in a prompt
 */
export function resolveAllVariables(
  prompt: string,
  context: VariableContext
): Map<string, TemplateVariableStatus> {
  const variables = extractVariables(prompt);
  const resolved = new Map<string, TemplateVariableStatus>();

  for (const varKey of variables) {
    resolved.set(varKey, resolveVariable(varKey, context));
  }

  return resolved;
}

/**
 * Get a set of available variable keys based on context
 */
export function getAvailableDataKeys(context: VariableContext): Set<string> {
  const available = new Set<string>();
  const sourceType = context.listing.sourceType || 'upload';
  
  if (context.audioBlob) {
    available.add('{{audio}}');
  }
  
  if (context.listing.transcript) {
    available.add('{{transcript}}');
    
    // Only add segment-based variables for upload flow
    if (sourceType === 'upload') {
      available.add('{{original_script}}');
      available.add('{{segment_count}}');
      available.add('{{speaker_list}}');
      available.add('{{time_windows}}');
    }
  }
  
  if (context.aiEval?.llmTranscript) {
    available.add('{{llm_transcript}}');
  }

  // API flow: add API-related variables
  if (sourceType === 'api' && context.listing.apiResponse) {
    const apiResponseObj = context.listing.apiResponse as unknown as Record<string, unknown>;
    
    // {{structured_output}} needs apiResponse.rx specifically
    if (apiResponseObj.rx) {
      available.add('{{structured_output}}');
    }
    
    // {{api_rx}} is the full response
    available.add('{{api_rx}}');
    
    if (apiResponseObj.input) {
      available.add('{{api_input}}');
    }
  }

  // LLM structured output (if available)
  if (context.aiEval?.judgeOutput?.structuredData) {
    available.add('{{llm_structured}}');
  }

  // Transcription preferences are always available (have defaults from prerequisites)
  available.add('{{script_preference}}');
  available.add('{{language_hint}}');
  available.add('{{preserve_code_switching}}');
  
  return available;
}

/**
 * Resolve a prompt by substituting all text variables
 * Note: File variables (like {{audio}}) are not substituted but returned separately
 */
export function resolvePrompt(
  prompt: string,
  context: VariableContext
): ResolvedPrompt {
  const variables = extractVariables(prompt);
  const resolvedVariables = new Map<string, string | Blob>();
  const unresolvedVariables: string[] = [];
  
  let resolvedPrompt = prompt;

  // First, resolve known registry variables
  for (const varKey of variables) {
    const status = resolveVariable(varKey, context);
    
    if (status.available && status.value !== undefined) {
      resolvedVariables.set(varKey, status.value);
      
      // Only substitute text variables in the prompt string
      if (typeof status.value === 'string') {
        resolvedPrompt = resolvedPrompt.replace(varKey, status.value);
      }
      // File variables remain as placeholders (handled separately by LLM service)
    } else {
      unresolvedVariables.push(varKey);
    }
  }

  // Second, resolve API JSON path variables (e.g., {{rx.vitals.temperature}}, {{input}}, {{rx}})
  if (context.listing.sourceType === 'api' && context.listing.apiResponse) {
    const apiVarRegex = /\{\{([a-zA-Z0-9_.]+)\}\}/g;
    const matches = Array.from(resolvedPrompt.matchAll(apiVarRegex));
    
    for (const match of matches) {
      const fullVar = match[0]; // e.g., {{rx.vitals.temperature}} or {{input}} or {{rx}}
      const path = match[1];    // e.g., rx.vitals.temperature or input or rx
      
      // Skip if already handled by registry
      if (isKnownVariable(fullVar)) continue;
      
      try {
        const value = getNestedValue(context.listing.apiResponse as unknown as Record<string, unknown>, path);
        if (value !== undefined) {
          const stringValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
          resolvedPrompt = resolvedPrompt.replace(fullVar, stringValue);
          resolvedVariables.set(fullVar, stringValue);
        } else {
          // Variable path not found in API response
          if (!unresolvedVariables.includes(fullVar)) {
            unresolvedVariables.push(fullVar);
          }
        }
      } catch {
        // Variable not found in API response
        if (!unresolvedVariables.includes(fullVar)) {
          unresolvedVariables.push(fullVar);
        }
      }
    }
  }

  return {
    prompt: resolvedPrompt,
    resolvedVariables,
    unresolvedVariables,
  };
}
