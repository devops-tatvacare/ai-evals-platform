import Dexie, { type Table } from 'dexie';
import type { Listing } from '@/types';
import type { AppSettings } from '@/types';

export interface StoredFile {
  id: string;
  data: Blob;
  createdAt: Date;
}

export class VoiceRxDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('voice-rx-evaluator');
    
    this.version(1).stores({
      listings: 'id, title, createdAt, updatedAt, status',
      files: 'id, createdAt',
      settings: 'key',
    });
  }
}

export const db = new VoiceRxDatabase();

// Settings helpers
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K] | undefined> {
  const result = await db.settings.get(key);
  return result?.value as AppSettings[K] | undefined;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getAllSettings(): Promise<Partial<AppSettings>> {
  const settings: Partial<AppSettings> = {};
  const all = await db.settings.toArray();
  for (const { key, value } of all) {
    (settings as Record<string, unknown>)[key] = value;
  }
  return settings;
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
