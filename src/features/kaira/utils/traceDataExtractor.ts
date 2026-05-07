/**
 * Trace Data Extractor
 * Utility for extracting structured data from chat message metadata
 */

import type { ChatMessageMetadata } from '@/types';

// ============================================================================
// Type Definitions for Extracted Data
// ============================================================================

export interface FoodEntry {
  name: string;
  quantity: number;
  unit: string;
}

export interface NutritionData {
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fats?: number;
}

export interface CurrentEntry {
  foods?: FoodEntry[];
  food_time?: string;
  time_mentioned?: boolean;
  quantity_mentioned?: boolean;
}

export interface FoodAgentState {
  food_logged?: boolean;
  can_session_end?: boolean;
  is_meal_confirmed?: boolean;
  current_entry?: CurrentEntry;
  nutrition_data?: NutritionData;
  conversation_history_length?: number;
}

export interface IntentClassification {
  agent: string;
  confidence: number;
  query_type?: string;
  reasoning?: string;
}

export interface ExtractedTraceData {
  // Intent classification
  primaryIntent?: IntentClassification;
  allIntents?: IntentClassification[];
  isMultiIntent?: boolean;
  
  // Agent-specific state
  foodAgentState?: FoodAgentState;
  
  // Processing metadata
  processingTime?: number;
  responseId?: string;
  
  // Raw agent responses
  agentResponses?: Array<{
    agent: string;
    message: string;
    success: boolean;
    data?: unknown;
  }>;
}

// ============================================================================
// Type Guards (kept for possible future use)
// ============================================================================

function _isFoodEntry(obj: unknown): obj is FoodEntry {
  if (!obj || typeof obj !== 'object') return false;
  const entry = obj as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.quantity === 'number' &&
    typeof entry.unit === 'string'
  );
}

// Suppress unused-function warnings for guards not yet called
void _isFoodEntry;

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract intent classification data from the new classification metadata field
 */
function extractIntentClassification(
  classification?: { intent: string; agent: string; confidence: number; source: 'text' | 'vision' },
): IntentClassification[] {
  if (!classification) return [];
  return [{
    agent: classification.agent,
    confidence: classification.confidence,
    query_type: classification.intent,
  }];
}

/**
 * Main extraction function - extracts all structured data from metadata
 */
export function extractTraceData(metadata?: ChatMessageMetadata): ExtractedTraceData {
  if (!metadata) return {};
  
  const extracted: ExtractedTraceData = {};
  
  // Extract intent classification from new classification field
  const intents = extractIntentClassification(metadata.classification);
  if (intents.length > 0) {
    extracted.allIntents = intents;
    extracted.primaryIntent = intents[0];
    extracted.isMultiIntent = false;
  }
  
  // Extract processing time
  if (metadata.processingTime !== undefined) {
    extracted.processingTime = metadata.processingTime;
  }
  
  // Extract food card data (new API)
  if (metadata.foodCard) {
    const foodState: FoodAgentState = {
      food_logged: true,
      current_entry: {
        foods: metadata.foodCard.items.map(item => ({
          name: item.name,
          quantity: parseFloat(item.qty) || 0,
          unit: item.meal,
        })),
        food_time: metadata.foodCard.consumed_at,
      },
    };
    extracted.foodAgentState = foodState;
  }
  
  return extracted;
}

/**
 * Check if message has FoodAgent data
 */
export function hasFoodAgentData(metadata?: ChatMessageMetadata): boolean {
  const extracted = extractTraceData(metadata);
  return !!extracted.foodAgentState;
}

/**
 * Check if message has intent classification data
 */
export function hasIntentData(metadata?: ChatMessageMetadata): boolean {
  const extracted = extractTraceData(metadata);
  return !!extracted.primaryIntent;
}
