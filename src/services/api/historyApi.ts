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

export const historyRepository = {
  async save(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): Promise<string> {
    const data = await apiRequest<{ id: string }>('/api/history', {
      method: 'POST',
      body: JSON.stringify({
        app_id: entry.appId,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        source_type: entry.sourceType,
        source_id: entry.sourceId,
        status: entry.status,
        duration_ms: entry.durationMs,
        data: entry.data,
        triggered_by: entry.triggeredBy,
        schema_version: entry.schemaVersion,
        user_context: entry.userContext,
      }),
    });
    return data.id;
  },

  async getById(id: string): Promise<HistoryEntry | undefined> {
    try {
      const data = await apiRequest<{
        id: string;
        app_id: string;
        entity_type?: string;
        entity_id?: string;
        source_type: string;
        source_id?: string;
        status: string;
        duration_ms?: number;
        data?: unknown;
        triggered_by?: string;
        schema_version?: string;
        user_context?: unknown;
        timestamp: number;
      }>(`/api/history/${id}`);

      return {
        id: data.id,
        appId: data.app_id,
        entityType: data.entity_type as EntityType,
        entityId: data.entity_id,
        sourceType: data.source_type as HistorySourceType,
        sourceId: data.source_id,
        status: data.status as HistoryEntry['status'],
        durationMs: data.duration_ms,
        data: data.data as HistoryEntry['data'],
        triggeredBy: data.triggered_by as HistoryEntry['triggeredBy'],
        schemaVersion: data.schema_version,
        userContext: data.user_context as HistoryEntry['userContext'],
        timestamp: data.timestamp,
      };
    } catch (err) {
      return undefined;
    }
  },

  async getByEntity(
    entityType: EntityType,
    entityId: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult> {
    const params = new URLSearchParams({
      entity_type: entityType,
      entity_id: entityId,
    });

    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.status) params.append('status', options.status);
    if (options?.startDate) params.append('start_date', options.startDate.toISOString());
    if (options?.endDate) params.append('end_date', options.endDate.toISOString());

    const data = await apiRequest<{
      entries: Array<{
        id: string;
        app_id: string;
        entity_type?: string;
        entity_id?: string;
        source_type: string;
        source_id?: string;
        status: string;
        duration_ms?: number;
        data?: unknown;
        timestamp: number;
      }>;
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(e => ({
        id: e.id,
        appId: e.app_id,
        entityType: e.entity_type as EntityType,
        entityId: e.entity_id,
        sourceType: e.source_type as HistorySourceType,
        sourceId: e.source_id,
        status: e.status as HistoryEntry['status'],
        durationMs: e.duration_ms,
        data: e.data as HistoryEntry['data'],
        timestamp: e.timestamp,
      })),
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
      entries: Array<{
        id: string;
        app_id: string;
        entity_type?: string;
        entity_id?: string;
        source_type: string;
        source_id?: string;
        status: string;
        duration_ms?: number;
        data?: unknown;
        timestamp: number;
      }>;
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(e => ({
        id: e.id,
        appId: e.app_id,
        entityType: e.entity_type as EntityType,
        entityId: e.entity_id,
        sourceType: e.source_type as HistorySourceType,
        sourceId: e.source_id,
        status: e.status as HistoryEntry['status'],
        durationMs: e.duration_ms,
        data: e.data as HistoryEntry['data'],
        timestamp: e.timestamp,
      })),
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
      entries: Array<{
        id: string;
        app_id: string;
        entity_type?: string;
        entity_id?: string;
        source_type: string;
        source_id?: string;
        status: string;
        duration_ms?: number;
        data?: unknown;
        timestamp: number;
      }>;
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history?${params}`);

    return {
      entries: data.entries.map(e => ({
        id: e.id,
        appId: e.app_id,
        entityType: e.entity_type as EntityType,
        entityId: e.entity_id,
        sourceType: e.source_type as HistorySourceType,
        sourceId: e.source_id,
        status: e.status as HistoryEntry['status'],
        durationMs: e.duration_ms,
        data: e.data as HistoryEntry['data'],
        timestamp: e.timestamp,
      })),
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
      entries: Array<{
        id: string;
        app_id: string;
        entity_type?: string;
        entity_id?: string;
        source_type: string;
        source_id?: string;
        status: string;
        duration_ms?: number;
        data?: unknown;
        timestamp: number;
      }>;
      total_count: number;
      has_more: boolean;
      page: number;
    }>(`/api/history/evaluator-runs?${params}`);

    return {
      entries: data.entries.map(e => ({
        id: e.id,
        appId: e.app_id,
        entityType: e.entity_type as EntityType,
        entityId: e.entity_id,
        sourceType: e.source_type as HistorySourceType,
        sourceId: e.source_id,
        status: e.status as HistoryEntry['status'],
        durationMs: e.duration_ms,
        data: e.data as HistoryEntry['data'],
        timestamp: e.timestamp,
      })) as EvaluatorRunHistory[],
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
