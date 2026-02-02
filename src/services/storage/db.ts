import Dexie, { type Table } from 'dexie';
import type { Listing, AppId, KairaChatSession, KairaChatMessage } from '@/types';

export interface StoredFile {
  id: string;
  data: Blob;
  createdAt: Date;
}

export class VoiceRxDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  kairaChatSessions!: Table<KairaChatSession, string>;
  kairaChatMessages!: Table<KairaChatMessage, string>;

  constructor() {
    super('voice-rx-evaluator-v2');
    
    this.version(1).stores({
      listings: 'id, appId, updatedAt',
      files: 'id',
      settings: 'key',
      kairaChatSessions: 'id, appId',
      kairaChatMessages: 'id, sessionId',
    });
  }
}

export const db = new VoiceRxDatabase();

// Settings helpers using the single settings table
export async function getGlobalSetting<T>(key: string): Promise<T | undefined> {
  const result = await db.settings.get(key);
  return result?.value as T | undefined;
}

export async function setGlobalSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getAllGlobalSettings(): Promise<Record<string, unknown>> {
  const settings: Record<string, unknown> = {};
  const all = await db.settings.toArray();
  for (const { key, value } of all) {
    settings[key] = value;
  }
  return settings;
}

// App settings stored with prefixed keys: "appId:key"
export async function getAppSetting<T>(appId: AppId, key: string): Promise<T | undefined> {
  const fullKey = `${appId}:${key}`;
  const result = await db.settings.get(fullKey);
  return result?.value as T | undefined;
}

export async function setAppSetting<T>(appId: AppId, key: string, value: T): Promise<void> {
  const fullKey = `${appId}:${key}`;
  await db.settings.put({ key: fullKey, value });
}

export async function getAllAppSettings(appId: AppId): Promise<Record<string, unknown>> {
  const prefix = `${appId}:`;
  const settings: Record<string, unknown> = {};
  const all = await db.settings.filter(s => s.key.startsWith(prefix)).toArray();
  for (const { key, value } of all) {
    settings[key.slice(prefix.length)] = value;
  }
  return settings;
}

// Legacy exports for compatibility
export function ensureDbReady(): Promise<void> {
  return Promise.resolve();
}

export async function waitForDb(): Promise<boolean> {
  return true;
}

export function isDbAvailable(): boolean {
  return true;
}

export function isDbInitComplete(): boolean {
  return true;
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

export const DB_NAME = 'voice-rx-evaluator-v2';
