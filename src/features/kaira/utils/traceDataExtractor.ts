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
// Type Guards
// ============================================================================

function isFoodEntry(obj: unknown): obj is FoodEntry {
  if (!obj || typeof obj !== 'object') return false;
  const entry = obj as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.quantity === 'number' &&
    typeof entry.unit === 'string'
  );
}

function isNutritionData(obj: unknown): obj is NutritionData {
  if (!obj || typeof obj !== 'object') return false;
  const nutrition = obj as Record<string, unknown>;
  return (
    (nutrition.total_calories === undefined || typeof nutrition.total_calories === 'number') &&
    (nutrition.total_protein === undefined || typeof nutrition.total_protein === 'number') &&
    (nutrition.total_carbs === undefined || typeof nutrition.total_carbs === 'number') &&
    (nutrition.total_fats === undefined || typeof nutrition.total_fats === 'number')
  );
}

function isCurrentEntry(obj: unknown): obj is CurrentEntry {
  if (!obj || typeof obj !== 'object') return false;
  const entry = obj as Record<string, unknown>;
  
  // Check foods array if present
  if (entry.foods !== undefined) {
    if (!Array.isArray(entry.foods)) return false;
    if (!entry.foods.every(isFoodEntry)) return false;
  }
  
  return (
    (entry.food_time === undefined || typeof entry.food_time === 'string') &&
    (entry.time_mentioned === undefined || typeof entry.time_mentioned === 'boolean') &&
    (entry.quantity_mentioned === undefined || typeof entry.quantity_mentioned === 'boolean')
  );
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract FoodAgent-specific state from agent response data
 */
function extractFoodAgentState(data: unknown): FoodAgentState | undefined {
  if (!data || typeof data !== 'object') return undefined;
  
  const raw = data as Record<string, unknown>;
  const state: FoodAgentState = {};
  
  // Extract top-level flags
  if (typeof raw.food_logged === 'boolean') {
    state.food_logged = raw.food_logged;
  }
  if (typeof raw.can_session_end === 'boolean') {
    state.can_session_end = raw.can_session_end;
  }
  if (typeof raw.is_meal_confirmed === 'boolean') {
    state.is_meal_confirmed = raw.is_meal_confirmed;
  }
  
  // Extract nested data object
  const nestedData = raw.data as Record<string, unknown> | undefined;
  if (nestedData && typeof nestedData === 'object') {
    // Extract current_entry
    if (isCurrentEntry(nestedData.current_entry)) {
      state.current_entry = nestedData.current_entry;
    }
    
    // Extract nutrition_data
    if (isNutritionData(nestedData.nutrition_data)) {
      state.nutrition_data = nestedData.nutrition_data;
    }
    
    // Extract conversation history length
    if (Array.isArray(nestedData.conversation_history)) {
      state.conversation_history_length = nestedData.conversation_history.length;
    }
  }
  
  // Only return if we extracted something
  return Object.keys(state).length > 0 ? state : undefined;
}

/**
 * Extract intent classification data with reasoning
 */
function extractIntentClassification(
  intents?: Array<{ agent: string; confidence: number }>,
  apiResponse?: { detected_intents?: Array<{ agent: string; confidence: number; query_type?: string; reasoning?: string }> }
): IntentClassification[] {
  // Prefer apiResponse data as it has more details
  if (apiResponse?.detected_intents) {
    return apiResponse.detected_intents.map(intent => ({
      agent: intent.agent,
      confidence: intent.confidence,
      query_type: intent.query_type,
      reasoning: intent.reasoning,
    }));
  }
  
  // Fallback to basic intents
  if (intents) {
    return intents.map(intent => ({
      agent: intent.agent,
      confidence: intent.confidence,
    }));
  }
  
  return [];
}

/**
 * Main extraction function - extracts all structured data from metadata
 */
export function extractTraceData(metadata?: ChatMessageMetadata): ExtractedTraceData {
  if (!metadata) return {};
  
  const extracted: ExtractedTraceData = {};
  
  // Extract intent classification
  const intents = extractIntentClassification(metadata.intents, metadata.apiResponse);
  if (intents.length > 0) {
    extracted.allIntents = intents;
    extracted.primaryIntent = intents[0];
    extracted.isMultiIntent = metadata.isMultiIntent ?? intents.length > 1;
  }
  
  // Extract processing time
  if (metadata.processingTime !== undefined) {
    extracted.processingTime = metadata.processingTime;
  }
  
  // Extract response ID
  if (metadata.responseId) {
    extracted.responseId = metadata.responseId;
  }
  
  // Extract agent responses
  if (metadata.agentResponses) {
    extracted.agentResponses = metadata.agentResponses;
    
    // Extract FoodAgent-specific state if present
    const foodResponse = metadata.agentResponses.find(r => r.agent === 'FoodAgent');
    if (foodResponse?.data) {
      const foodState = extractFoodAgentState(foodResponse.data);
      if (foodState) {
        extracted.foodAgentState = foodState;
      }
    }
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
