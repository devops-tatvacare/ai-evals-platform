import { db } from './db';
import type {
  HistoryEntry,
  EvaluatorRunHistory,
  EvaluatorRunFilters,
  HistoryQueryOptions,
  HistoryQueryResult,
  HistorySourceType,
  EntityType,
} from '@/types';
import { generateId } from '@/utils';

export const historyRepository = {
  /**
   * Save a history entry (auto-generates ID and timestamp)
   */
  async save(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): Promise<string> {
    const newEntry: HistoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };
    
    await db.history.add(newEntry);
    return newEntry.id;
  },

  /**
   * Get a single history entry by ID
   */
  async getById(id: string): Promise<HistoryEntry | undefined> {
    return db.history.get(id);
  },

  /**
   * Get all history for an entity
   */
  async getByEntity(
    entityType: EntityType,
    entityId: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = db.history
      .where('[entity_type+entity_id+timestamp]')
      .between(
        [entityType, entityId, options?.startDate?.getTime() || 0],
        [entityType, entityId, options?.endDate?.getTime() || Date.now()]
      );

    if (options?.status) {
      query = query.filter(e => e.status === options.status);
    }

    const allEntries = await query.reverse().toArray();
    const totalCount = allEntries.length;
    const entries = allEntries.slice(offset, offset + pageSize);

    return {
      entries,
      totalCount,
      hasMore: offset + pageSize < totalCount,
      page,
    };
  },

  /**
   * Get all history for an app
   */
  async getByApp(
    appId: string,
    options?: HistoryQueryOptions & { sourceType?: HistorySourceType }
  ): Promise<HistoryQueryResult> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = db.history
      .where('[app_id+source_type+timestamp]')
      .between(
        [appId, options?.sourceType || '', options?.startDate?.getTime() || 0],
        [appId, options?.sourceType || '\uffff', options?.endDate?.getTime() || Date.now()]
      );

    if (options?.status) {
      query = query.filter(e => e.status === options.status);
    }

    const allEntries = await query.reverse().toArray();
    const totalCount = allEntries.length;
    const entries = allEntries.slice(offset, offset + pageSize);

    return {
      entries,
      totalCount,
      hasMore: offset + pageSize < totalCount,
      page,
    };
  },

  /**
   * Get recent history across platform
   */
  async getRecent(options?: HistoryQueryOptions): Promise<HistoryQueryResult> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = db.history.orderBy('timestamp').reverse();

    if (options?.status) {
      query = query.filter(e => e.status === options.status);
    }

    const allEntries = await query.toArray();
    const totalCount = allEntries.length;
    const entries = allEntries.slice(offset, offset + pageSize);

    return {
      entries,
      totalCount,
      hasMore: offset + pageSize < totalCount,
      page,
    };
  },

  /**
   * Get evaluator runs with filters
   */
  async getEvaluatorRuns(
    filters: EvaluatorRunFilters,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query;

    if (filters.entityId && filters.sourceId) {
      // Most specific query: entity + evaluator
      query = db.history
        .where('[entity_id+source_type+source_id+timestamp]')
        .between(
          [filters.entityId, 'evaluator_run', filters.sourceId, options?.startDate?.getTime() || 0],
          [filters.entityId, 'evaluator_run', filters.sourceId, options?.endDate?.getTime() || Date.now()]
        );
    } else if (filters.sourceId) {
      // Cross-entity view for an evaluator
      query = db.history
        .where('[source_type+source_id+timestamp]')
        .between(
          ['evaluator_run', filters.sourceId, options?.startDate?.getTime() || 0],
          ['evaluator_run', filters.sourceId, options?.endDate?.getTime() || Date.now()]
        );
    } else if (filters.appId) {
      // All evaluator runs in an app
      query = db.history
        .where('[app_id+source_type+timestamp]')
        .between(
          [filters.appId, 'evaluator_run', options?.startDate?.getTime() || 0],
          [filters.appId, 'evaluator_run', options?.endDate?.getTime() || Date.now()]
        );
    } else {
      // All evaluator runs
      query = db.history
        .where('source_type')
        .equals('evaluator_run')
        .and(e => {
          if (options?.startDate && e.timestamp < options.startDate.getTime()) return false;
          if (options?.endDate && e.timestamp > options.endDate.getTime()) return false;
          return true;
        });
    }

    // Apply status filter
    if (filters.status || options?.status) {
      const statusToFilter = filters.status || options?.status;
      query = query.filter(e => e.status === statusToFilter);
    }

    const allEntries = await query.reverse().toArray();
    const totalCount = allEntries.length;
    const entries = allEntries.slice(offset, offset + pageSize) as EvaluatorRunHistory[];

    return {
      entries,
      totalCount,
      hasMore: offset + pageSize < totalCount,
      page,
    };
  },

  /**
   * Get evaluator runs for a specific listing
   */
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

  /**
   * Get global evaluator runs (not tied to any entity)
   */
  async getGlobalEvaluatorRuns(
    evaluatorName?: string,
    options?: HistoryQueryOptions
  ): Promise<HistoryQueryResult<EvaluatorRunHistory>> {
    const result = await this.getEvaluatorRuns(
      {
        sourceId: evaluatorName,
      },
      options
    );

    // Filter for null entity_id
    const globalEntries = result.entries.filter(e => e.entity_id === null);
    
    return {
      ...result,
      entries: globalEntries,
      totalCount: globalEntries.length,
      hasMore: false, // Simplified for now
    };
  },

  /**
   * Get all runs for an evaluator across all entities
   */
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

  /**
   * Delete all history for an entity (CASCADE DELETE)
   */
  async deleteByEntity(entityType: EntityType, entityId: string): Promise<void> {
    await db.history
      .where('[entity_type+entity_id+timestamp]')
      .between(
        [entityType, entityId, 0],
        [entityType, entityId, Date.now()]
      )
      .delete();
  },

  /**
   * Delete history older than specified days
   */
  async deleteOlderThan(days: number, sourceType?: HistorySourceType): Promise<number> {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    
    let query = db.history.where('timestamp').below(cutoffTime);
    
    if (sourceType) {
      query = query.filter(e => e.source_type === sourceType);
    }
    
    return await query.delete();
  },

  /**
   * Delete by source type with optional age filter
   */
  async deleteBySourceType(
    sourceType: HistorySourceType,
    olderThanDays?: number
  ): Promise<number> {
    if (olderThanDays) {
      return this.deleteOlderThan(olderThanDays, sourceType);
    }
    
    return await db.history.where('source_type').equals(sourceType).delete();
  },
};
