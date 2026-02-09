import Dexie, { type Table } from 'dexie';
import type { Listing, HistoryEntry } from '@/types';

export interface StoredFile {
  id: string;
  data: Blob;
  createdAt: Date;
}

export interface Entity {
  id?: number;              // Auto-increment, Dexie generates
  appId: string | null;     // null = global, 'voice-rx' | 'kaira-bot' = app-specific
  type: 'setting' | 'prompt' | 'schema' | 'chatSession' | 'chatMessage' | 'evaluator';
  key: string;              // Context-dependent: setting key, promptType, sessionId, evaluatorId
  version: number | null;   // For prompts/schemas only
  data: Record<string, unknown>; // Flexible payload
}

export class AiEvalsDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  entities!: Table<Entity, number>;
  history!: Table<HistoryEntry, string>;

  constructor() {
    super('ai-evals-platform');
    
    this.version(1).stores({
      listings: 'id, appId, updatedAt',
      files: 'id',
      entities: '++id, appId, type',
    });
    
    // Version 2: Add history table with compound indexes
    this.version(2).stores({
      listings: 'id, appId, updatedAt',
      files: 'id',
      entities: '++id, appId, type',
      history: 'id, timestamp, [entity_id+source_type+source_id+timestamp], [source_type+source_id+timestamp], [app_id+source_type+timestamp], [entity_type+entity_id+timestamp]',
    });
  }
}

export const db = new AiEvalsDatabase();

/**
 * Get a single entity by filters
 */
export async function getEntity(
  type: Entity['type'],
  appId: string | null,
  key: string
): Promise<Entity | undefined> {
  return await db.entities
    .where('type').equals(type)
    .filter(e => e.appId === appId && e.key === key)
    .first();
}

/**
 * Get multiple entities by type and appId
 */
export async function getEntities(
  type: Entity['type'],
  appId: string | null,
  keyFilter?: string
): Promise<Entity[]> {
  let results = await db.entities
    .where('type').equals(type)
    .filter(e => e.appId === appId)
    .toArray();
  
  if (keyFilter) {
    results = results.filter(e => e.key === keyFilter);
  }
  
  return results;
}

/**
 * Save or update an entity
 */
export async function saveEntity(entity: Omit<Entity, 'id'> & { id?: number }): Promise<number> {
  if (entity.id) {
    await db.entities.put(entity as Entity);
    return entity.id;
  } else {
    return await db.entities.add(entity);
  }
}

/**
 * Delete an entity by id
 */
export async function deleteEntity(id: number): Promise<void> {
  await db.entities.delete(id);
}

// Storage quota monitoring
export async function getStorageUsage(): Promise<{ used: number; quota: number; percentage: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    return {
      used,
      quota,
      percentage: quota > 0 ? (used / quota) * 100 : 0,
    };
  }
  return { used: 0, quota: 0, percentage: 0 };
}

export interface TableStorageInfo {
  name: string;
  count: number;
  estimatedBytes: number;
}

/**
 * Get storage usage broken down by IndexedDB table.
 * Estimates byte sizes by serializing sampled rows.
 */
export async function getStorageUsageByTable(): Promise<{
  tables: TableStorageInfo[];
  totalBytes: number;
  quota: number;
}> {
  const tables: TableStorageInfo[] = [];

  // Helper: estimate table size by sampling rows and extrapolating
  async function estimateTableSize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: Table<any, any>,
    tableName: string,
  ): Promise<TableStorageInfo> {
    const count = await table.count();
    if (count === 0) return { name: tableName, count: 0, estimatedBytes: 0 };

    const sampleSize = Math.min(count, 20);
    const sample = await table.limit(sampleSize).toArray();

    let totalSampleBytes = 0;
    for (const row of sample) {
      try {
        // For files table, measure blob size directly
        if (tableName === 'files' && row && typeof row === 'object' && 'data' in row) {
          const fileRow = row as unknown as StoredFile;
          totalSampleBytes += fileRow.data.size + 100; // 100 bytes overhead for id/metadata
        } else {
          totalSampleBytes += new Blob([JSON.stringify(row)]).size;
        }
      } catch {
        totalSampleBytes += 500; // fallback estimate per row
      }
    }

    const avgRowBytes = totalSampleBytes / sampleSize;
    return {
      name: tableName,
      count,
      estimatedBytes: Math.round(avgRowBytes * count),
    };
  }

  tables.push(await estimateTableSize(db.listings, 'listings'));
  tables.push(await estimateTableSize(db.files, 'files'));
  tables.push(await estimateTableSize(db.entities, 'entities'));
  tables.push(await estimateTableSize(db.history, 'history'));

  const totalBytes = tables.reduce((sum, t) => sum + t.estimatedBytes, 0);

  let quota = 0;
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    quota = estimate.quota ?? 0;
  }

  return { tables, totalBytes, quota };
}

export const DB_NAME = 'ai-evals-platform';
