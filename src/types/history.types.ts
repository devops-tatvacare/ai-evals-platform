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

