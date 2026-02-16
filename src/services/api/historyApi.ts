/**
 * History API - HTTP implementation replacing Dexie-based historyRepository.
 */
import type {
  HistoryEntry,
  EvaluatorRunHistory,
  EvaluatorRunFilters,
  HistoryQueryOptions,
  HistoryQueryResult,
  HistorySourceType,
  EntityType,
} from '@/types';
import { apiRequest } from './client';

/** Shape returned by the backend for a single history entry */
interface ApiHistoryEntry {
  id: string;
  app_id: string;
  entity_type: string | null;
  entity_id: string | null;
  source_type: string;
  source_id: string | null;
  status: string;
  duration_ms: number | null;
  data: Record<string, unknown>;
  triggered_by?: string;
  schema_version?: string;
  user_context?: Record<string, unknown> | null;
  timestamp: number;
}

/** Map a backend entry to our HistoryEntry type (both use snake_case) */
function mapApiEntry(e: ApiHistoryEntry): HistoryEntry {
  return {
    id: e.id,
    app_id: e.app_id as HistoryEntry['app_id'],
    entity_type: e.entity_type as EntityType,
    entity_id: e.entity_id ?? null,
    source_type: e.source_type as HistorySourceType,
    source_id: e.source_id ?? null,
    status: e.status as HistoryEntry['status'],
    duration_ms: e.duration_ms ?? null,
    data: (e.data ?? {}) as HistoryEntry['data'],
    triggered_by: (e.triggered_by ?? 'manual') as HistoryEntry['triggered_by'],
    schema_version: e.schema_version ?? '1.0',
    user_context: e.user_context ?? null,
    timestamp: e.timestamp,
  };
}

export const historyRepository = {
  async save(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): Promise<string> {
    const data = await apiRequest<{ id: string }>('/api/history', {
      method: 'POST',
      body: JSON.stringify({
        app_id: entry.app_id,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        source_type: entry.source_type,
        source_id: entry.source_id,
        status: entry.status,
        duration_ms: entry.duration_ms,
        data: entry.data,
        triggered_by: entry.triggered_by,
        schema_version: entry.schema_version,
        user_context: entry.user_context,
      }),
    });
    return data.id;
  },

  async getById(id: string): Promise<HistoryEntry | undefined> {
    try {
      const data = await apiRequest<ApiHistoryEntry>(`/api/history/${id}`);
      return mapApiEntry(data);
    } catch {
      return undefined;
    }
  },

  async getByEntity(
    entityType: EntityType,
    entityId: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult> {
    const params = new URLSearchParams();
    if (entityType) params.append('entity_type', entityType);
    params.append('entity_id', entityId);

    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.status) params.append('status', options.status);
    if (options?.startDate) params.append('start_date', options.startDate.toISOString());
    if (options?.endDate) params.append('end_date', options.endDate.toISOString());

    const data = await apiRequest<{
      entries: ApiHistoryEntry[];
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(mapApiEntry),
      totalCount: data.total_count,
      hasMore: data.has_more,
      page: data.page,
    };
  },

  async getByApp(
    appId: string,
    options?: HistoryQueryOptions & { sourceType?: HistorySourceType }
  ): Promise<HistoryQueryResult> {
    const params = new URLSearchParams({ app_id: appId });

    if (options?.sourceType) params.append('source_type', options.sourceType);
    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.status) params.append('status', options.status);
    if (options?.startDate) params.append('start_date', options.startDate.toISOString());
    if (options?.endDate) params.append('end_date', options.endDate.toISOString());

    const data = await apiRequest<{
      entries: ApiHistoryEntry[];
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(mapApiEntry),
      totalCount: data.total_count,
      hasMore: data.has_more,
      page: data.page,
    };
  },

  async getRecent(options?: HistoryQueryOptions): Promise<HistoryQueryResult> {
    const params = new URLSearchParams();

    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.status) params.append('status', options.status);

    const data = await apiRequest<{
      entries: ApiHistoryEntry[];
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(mapApiEntry),
      totalCount: data.total_count,
      hasMore: data.has_more,
      page: data.page,
    };
  },

  async getEvaluatorRuns(
    filters: EvaluatorRunFilters,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    const params = new URLSearchParams();

    if (filters.entityId) params.append('entity_id', filters.entityId);
    if (filters.sourceId) params.append('source_id', filters.sourceId);
    if (filters.appId) params.append('app_id', filters.appId);
    if (filters.status) params.append('status', filters.status);

    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.startDate) params.append('start_date', options.startDate.toISOString());
    if (options?.endDate) params.append('end_date', options.endDate.toISOString());

    const data = await apiRequest<{
      entries: ApiHistoryEntry[];
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history/evaluator-runs?${params}`);

    return {
      entries: data.entries.map(mapApiEntry) as EvaluatorRunHistory[],
      totalCount: data.total_count,
      hasMore: data.has_more,
      page: data.page,
    };
  },

  async getEvaluatorRunsForListing(
    listingId: string,
    evaluatorName?: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    return this.getEvaluatorRuns(
      {
        entityId: listingId,
        sourceId: evaluatorName,
      },
      options
    );
  },

  async getGlobalEvaluatorRuns(
    evaluatorName?: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    return this.getEvaluatorRuns(
      {
        sourceId: evaluatorName,
      },
      options
    );
  },

  async getAllEvaluatorRuns(
    evaluatorName: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    return this.getEvaluatorRuns(
      {
        sourceId: evaluatorName,
      },
      options
    );
  },

  async deleteByEntity(entityType: EntityType, entityId: string): Promise<void> {
    await apiRequest(`/api/history/by-entity?entity_type=${entityType}&entity_id=${entityId}`, {
      method: 'DELETE',
    });
  },

  async deleteOlderThan(days: number, sourceType?: HistorySourceType): Promise<number> {
    const params = new URLSearchParams({ days: String(days) });
    if (sourceType) params.append('source_type', sourceType);

    const data = await apiRequest<{ deleted_count: number }>(
      `/api/history/older-than?${params}`,
      { method: 'DELETE' }
    );
    return data.deleted_count;
  },
};
