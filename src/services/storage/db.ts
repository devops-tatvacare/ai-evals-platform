import Dexie, { type Table } from 'dexie';
import type { Listing } from '@/types';

export interface StoredFile {
  id: string;
  data: Blob;
  createdAt: Date;
}

export interface Entity {
  id?: number;              // Auto-increment, Dexie generates
  appId: string | null;     // null = global, 'voice-rx' | 'kaira-bot' = app-specific
  type: 'setting' | 'prompt' | 'schema' | 'chatSession' | 'chatMessage';
  key: string;              // Context-dependent: setting key, promptType, sessionId
  version: number | null;   // For prompts/schemas only
  data: Record<string, unknown>; // Flexible payload
}

export class AiEvalsDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  entities!: Table<Entity, number>;

  constructor() {
    super('ai-evals-platform');
    
    this.version(1).stores({
      listings: 'id, appId, updatedAt',
      files: 'id',
      entities: '++id, appId, type',
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

export const DB_NAME = 'ai-evals-platform';
