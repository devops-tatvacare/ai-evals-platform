/**
 * Legacy Settings Helpers
 * Provides backwards compatibility during migration from old database
 * TODO: Remove after migration is complete
 */

import Dexie from 'dexie';
import type { AppSettings } from '@/types';

// Check if old database exists
const OLD_DB_NAME = 'voice-rx-evaluator';

class LegacyDatabase extends Dexie {
  settings!: Dexie.Table<{ key: string; value: unknown }, string>;

  constructor() {
    super(OLD_DB_NAME);
    this.version(1).stores({
      settings: 'key',
    });
  }
}

let legacyDb: LegacyDatabase | null = null;

async function getLegacyDb(): Promise<LegacyDatabase | null> {
  if (legacyDb) return legacyDb;
  
  const exists = await Dexie.exists(OLD_DB_NAME);
  if (!exists) return null;
  
  legacyDb = new LegacyDatabase();
  return legacyDb;
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K] | undefined> {
  const db = await getLegacyDb();
  if (!db) return undefined;
  
  const result = await db.settings.get(key);
  return result?.value as AppSettings[K] | undefined;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  const db = await getLegacyDb();
  if (!db) return;
  
  await db.settings.put({ key, value });
}

export async function getAllSettings(): Promise<Partial<AppSettings>> {
  const db = await getLegacyDb();
  if (!db) return {};
  
  const settings: Partial<AppSettings> = {};
  const all = await db.settings.toArray();
  for (const { key, value } of all) {
    (settings as Record<string, unknown>)[key] = value;
  }
  return settings;
}
