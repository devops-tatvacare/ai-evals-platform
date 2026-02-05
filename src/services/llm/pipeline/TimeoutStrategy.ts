/**
 * Timeout Strategy for LLM Invocations
 * Centralized timeout calculation based on request type
 * Reads configurable values from settings store
 */

import { useSettingsStore } from '@/stores';
import type { LLMInvocationRequest } from './types';

// Default values in milliseconds (fallback if settings not available)
const DEFAULT_TIMEOUTS = {
  TEXT_ONLY: 60_000,              // 60s
  WITH_SCHEMA: 90_000,            // 90s
  WITH_AUDIO: 180_000,            // 3min
  WITH_AUDIO_AND_SCHEMA: 240_000, // 4min
};

export class TimeoutStrategy {
  /**
   * Get timeout values from settings (in milliseconds)
   * Settings store values in seconds, we convert to ms
   */
  private getTimeouts(): typeof DEFAULT_TIMEOUTS {
    const { llm } = useSettingsStore.getState();
    const timeouts = llm.timeouts;
    
    if (!timeouts) {
      return DEFAULT_TIMEOUTS;
    }
    
    return {
      TEXT_ONLY: (timeouts.textOnly || 60) * 1000,
      WITH_SCHEMA: (timeouts.withSchema || 90) * 1000,
      WITH_AUDIO: (timeouts.withAudio || 180) * 1000,
      WITH_AUDIO_AND_SCHEMA: (timeouts.withAudioAndSchema || 240) * 1000,
    };
  }
  
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
    
    // Get configured timeouts
    const timeouts = this.getTimeouts();
    
    // Auto-determine based on content
    if (hasAudio && hasSchema) return timeouts.WITH_AUDIO_AND_SCHEMA;
    if (hasAudio) return timeouts.WITH_AUDIO;
    if (hasSchema) return timeouts.WITH_SCHEMA;
    return timeouts.TEXT_ONLY;
  }
  
  private getSourceTimeout(source: string): number | null {
    // Source-specific customization (fixed, not configurable)
    const overrides: Record<string, number> = {
      'normalization': 300_000, // 5min for large transcripts
    };
    return overrides[source] ?? null;
  }
}
