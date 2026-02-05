/**
 * Timeout Strategy for LLM Invocations
 * Centralized timeout calculation based on request type
 */

import type { LLMInvocationRequest } from './types';

export class TimeoutStrategy {
  private readonly DEFAULTS = {
    TEXT_ONLY: 60_000,              // 60s
    WITH_SCHEMA: 90_000,            // 90s
    WITH_AUDIO: 180_000,            // 3min
    WITH_AUDIO_AND_SCHEMA: 240_000, // 4min
  };
  
  calculateTimeout(request: LLMInvocationRequest): number {
    // If explicitly provided, use it
    if (request.config?.timeoutMs) {
      return request.config.timeoutMs;
    }
    
    const hasAudio = !!request.media?.audio;
    const hasSchema = !!request.output.schema;
    
    // Check source-specific overrides
    const sourceOverride = this.getSourceTimeout(request.context.source);
    if (sourceOverride) return sourceOverride;
    
    // Auto-determine based on content
    if (hasAudio && hasSchema) return this.DEFAULTS.WITH_AUDIO_AND_SCHEMA;
    if (hasAudio) return this.DEFAULTS.WITH_AUDIO;
    if (hasSchema) return this.DEFAULTS.WITH_SCHEMA;
    return this.DEFAULTS.TEXT_ONLY;
  }
  
  private getSourceTimeout(source: string): number | null {
    // Source-specific customization
    const overrides: Record<string, number> = {
      'normalization': 300_000, // 5min for large transcripts
    };
    return overrides[source] ?? null;
  }
}
