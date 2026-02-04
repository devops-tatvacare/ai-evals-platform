/**
 * Variable Resolver
 * Resolves template variables from listing/evaluation context
 */

import type { Listing, AIEvaluation, TranscriptData, TemplateVariableStatus, ResolvedPrompt, TranscriptionPreferences } from '@/types';
import { extractVariables, isKnownVariable } from './variableRegistry';
import { detectTranscriptScript } from '@/services/normalization';

/**
 * Context for resolving variables
 */
export interface VariableContext {
  listing: Listing;
  aiEval?: AIEvaluation;
  audioBlob?: Blob;
  transcriptionPreferences?: TranscriptionPreferences;
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

    // Multilingual variables
    case '{{script_preference}}': {
      const pref = context.transcriptionPreferences?.scriptPreference || 'auto';
      return {
        key,
        available: true,
        value: pref,
      };
    }

    case '{{language_hint}}': {
      const hint = context.transcriptionPreferences?.languageHint || '';
      return {
        key,
        available: true,
        value: hint || 'Not specified',
      };
    }

    case '{{preserve_code_switching}}': {
      const preserve = context.transcriptionPreferences?.preserveCodeSwitching ?? true;
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

  // Transcription preferences are always available (have defaults)
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

  return {
    prompt: resolvedPrompt,
    resolvedVariables,
    unresolvedVariables,
  };
}
