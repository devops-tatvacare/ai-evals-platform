export type HistoryAppId = 'kaira' | 'voicerx' | 'global';
export type HistorySourceType = 'evaluator_run' | 'ai_generation' | 'export';
export type EntityType = 'listing' | 'prompt' | 'schema' | 'global_config' | null;
export type HistoryStatus = 'success' | 'error' | 'timeout' | 'cancelled' | 'pending';
export type TriggeredBy = 'manual' | 'auto' | 'batch' | 'scheduled' | 'system';

/**
 * Base history entry with universal fields (camelCase from API)
 */
export interface HistoryEntry {
  id: string;
  timestamp: number;

  // Universal Context
  appId: HistoryAppId;
  sourceType: HistorySourceType;
  entityType: EntityType;
  entityId: string | null;

  // Type-Specific Identifier
  sourceId: string | null;

  // Execution Details
  status: HistoryStatus;
  durationMs: number | null;

  // Flexible Payload
  data: Record<string, unknown>;

  // Metadata
  triggeredBy: TriggeredBy;
  schemaVersion: string;
  userContext: Record<string, unknown> | null;
}

/**
 * Score structure in history (JSONB content - keys stay snake_case)
 */
export interface HistoryScores {
  overall_score: string | number | boolean | null;
  max_score: number | null;
  breakdown: Record<string, unknown> | null;
  reasoning: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Evaluator run history data (JSONB content - keys stay snake_case)
 */
export interface EvaluatorRunData extends Record<string, unknown> {
  evaluator_name: string;
  evaluator_type: string;
  config_snapshot: Record<string, unknown>;
  input_payload: string | Record<string, unknown>;
  output_payload: string | Record<string, unknown> | null;
  error_details?: Record<string, unknown>;
  scores: HistoryScores | null;
}

/**
 * Evaluator run history entry (typed)
 */
export interface EvaluatorRunHistory extends HistoryEntry {
  sourceType: 'evaluator_run';
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
