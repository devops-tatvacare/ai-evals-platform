export type HistoryAppId = 'kaira' | 'voicerx' | 'global';
export type HistorySourceType = 'evaluator_run' | 'ai_generation' | 'export';
export type EntityType = 'listing' | 'prompt' | 'schema' | 'global_config' | null;
export type HistoryStatus = 'success' | 'error' | 'timeout' | 'cancelled' | 'pending';
export type TriggeredBy = 'manual' | 'auto' | 'batch' | 'scheduled' | 'system';

/**
 * Base history entry with universal fields
 */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  
  // Universal Context
  app_id: HistoryAppId;
  source_type: HistorySourceType;
  entity_type: EntityType;
  entity_id: string | null;
  
  // Type-Specific Identifier
  source_id: string | null;
  
  // Execution Details
  status: HistoryStatus;
  duration_ms: number | null;
  
  // Flexible Payload
  data: Record<string, unknown>;
  
  // Metadata
  triggered_by: TriggeredBy;
  schema_version: string;
  user_context: Record<string, unknown> | null;
}

/**
 * Score structure in history
 */
export interface HistoryScores {
  overall_score: string | number | boolean | null;
  max_score: number | null;
  breakdown: Record<string, unknown> | null;
  reasoning: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Evaluator run history data
 */
export interface EvaluatorRunData extends Record<string, unknown> {
  evaluator_name: string;
  evaluator_type: string;
  config_snapshot: Record<string, unknown>;
  input_payload: string | Record<string, unknown>;  // Can be raw prompt string or object
  output_payload: string | Record<string, unknown> | null;  // Can be raw response string or parsed object
  error_details?: Record<string, unknown>;
  scores: HistoryScores | null;
}

/**
 * Evaluator run history entry (typed)
 */
export interface EvaluatorRunHistory extends HistoryEntry {
  source_type: 'evaluator_run';
  data: EvaluatorRunData;
}

/**
 * Query options for history
 */
export interface HistoryQueryOptions {
  page?: number;
  pageSize?: number;
  status?: HistoryStatus;
  startDate?: Date;
  endDate?: Date;
  sortDesc?: boolean;
}

/**
 * Query result with pagination
 */
export interface HistoryQueryResult<T = HistoryEntry> {
  entries: T[];
  totalCount: number;
  hasMore: boolean;
  page: number;
}

/**
 * Filters for evaluator runs
 */
export interface EvaluatorRunFilters {
  entityId?: string;
  sourceId?: string;
  appId?: HistoryAppId;
  status?: HistoryStatus;
}
