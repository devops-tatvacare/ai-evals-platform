/**
 * History API - HTTP client for history API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * HistoryEntry type already uses camelCase fields — no mapping needed.
 * Query params remain snake_case (FastAPI query params).
 */
import type {
  HistoryEntry,
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
        appId: entry.appId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        status: entry.status,
        durationMs: entry.durationMs,
        data: entry.data,
        triggeredBy: entry.triggeredBy,
        schemaVersion: entry.schemaVersion,
        userContext: entry.userContext,
      }),
    });
    return data.id;
  },

  async getById(id: string): Promise<HistoryEntry | undefined> {
    try {
      return await apiRequest<HistoryEntry>(`/api/history/${id}`);
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

    return apiRequest<HistoryQueryResult>(`/api/history?${params}`);
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

    return apiRequest<HistoryQueryResult>(`/api/history?${params}`);
  },

  async getRecent(options?: HistoryQueryOptions): Promise<HistoryQueryResult> {
    const params = new URLSearchParams();

    if (options?.page) params.append('page', String(options.page));
    if (options?.pageSize) params.append('page_size', String(options.pageSize));
    if (options?.status) params.append('status', options.status);

    return apiRequest<HistoryQueryResult>(`/api/history?${params}`);
  },

  async deleteByEntity(entityType: EntityType, entityId: string): Promise<void> {
    await apiRequest(`/api/history/by-entity?entity_type=${entityType}&entity_id=${entityId}`, {
      method: 'DELETE',
    });
  },

  async deleteOlderThan(days: number, sourceType?: HistorySourceType): Promise<number> {
    const params = new URLSearchParams({ days: String(days) });
    if (sourceType) params.append('source_type', sourceType);

    const data = await apiRequest<{ deletedCount: number }>(
      `/api/history/older-than?${params}`,
      { method: 'DELETE' }
    );
    return data.deletedCount;
  },
};
