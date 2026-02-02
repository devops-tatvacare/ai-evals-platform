import Dexie, { type Table } from 'dexie';
import type { Listing, AppId, KairaChatSession, KairaChatMessage } from '@/types';

// Database name - use v4 to get a completely fresh start
const DB_NAME = 'ai-evals-platform-v4';

export interface StoredFile {
  id: string;
  appId: AppId;
  data: Blob;
  createdAt: Date;
}

export interface GlobalSetting {
  key: string;
  value: unknown;
}

export interface AppSetting {
  appId: AppId;
  key: string;
  value: unknown;
}

export class AiEvalsPlatformDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  globalSettings!: Table<GlobalSetting, string>;
  appSettings!: Table<AppSetting, [AppId, string]>;
  kairaChatSessions!: Table<KairaChatSession, string>;
  kairaChatMessages!: Table<KairaChatMessage, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    
    // Use version 2 to ensure upgrade runs even if a v1 skeleton exists
    this.version(2).stores({
      listings: 'id, appId, createdAt, updatedAt, status',
      files: 'id, appId, createdAt',
      globalSettings: 'key',
      appSettings: '[appId+key], appId',
      kairaChatSessions: 'id, appId, userId, threadId, createdAt, updatedAt, status',
      kairaChatMessages: 'id, sessionId, role, timestamp, [sessionId+timestamp]',
    });
    
    // Keep version 1 for upgrade path
    this.version(1).stores({
      listings: 'id, appId, createdAt, updatedAt, status',
      files: 'id, appId, createdAt',
      globalSettings: 'key',
      appSettings: '[appId+key], appId',
      kairaChatSessions: 'id, appId, userId, threadId, createdAt, updatedAt, status',
      kairaChatMessages: 'id, sessionId, role, timestamp, [sessionId+timestamp]',
    });
  }
}

// Create database instance
export let db = new AiEvalsPlatformDatabase();

// Track DB state
let dbAvailable = false;
let dbInitComplete = false;
let dbInitPromise: Promise<boolean> | null = null;

// Initialize database
function initDb(): Promise<boolean> {
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = new Promise<boolean>(async (resolve) => {
    console.log('[DB] Opening database:', DB_NAME);
    
    const timeout = setTimeout(() => {
      console.error('[DB] Database open timed out after 5 seconds');
      console.warn('[DB] Running in memory-only mode - data will NOT persist');
      dbAvailable = false;
      dbInitComplete = true;
      resolve(false);
    }, 5000);
    
    try {
      await db.open();
      clearTimeout(timeout);
      
      console.log('[DB] Database opened successfully');
      console.log('[DB] Tables:', db.tables.map(t => t.name).join(', '));
      console.log('[DB] Version:', db.verno);
      
      dbAvailable = true;
      dbInitComplete = true;
      resolve(true);
    } catch (err) {
      clearTimeout(timeout);
      console.error('[DB] Failed to open database:', err);
      console.warn('[DB] Running in memory-only mode - data will NOT persist');
      dbAvailable = false;
      dbInitComplete = true;
      resolve(false);
    }
  });
  
  return dbInitPromise;
}

// Start initialization immediately
initDb();

// Wait for initialization to complete
export async function waitForDb(): Promise<boolean> {
  console.log('[DB] waitForDb() called, dbInitComplete:', dbInitComplete, 'dbAvailable:', dbAvailable);
  if (dbInitComplete) {
    console.log('[DB] waitForDb() returning immediately:', dbAvailable);
    return dbAvailable;
  }
  console.log('[DB] waitForDb() waiting for initDb...');
  return initDb();
}

// Check if DB is available (only valid after init complete)
export function isDbAvailable(): boolean {
  return dbAvailable;
}

// Check if init is complete
export function isDbInitComplete(): boolean {
  return dbInitComplete;
}

// Global settings helpers (shared across all apps)
export async function getGlobalSetting<T>(key: string): Promise<T | undefined> {
  await waitForDb();
  const result = await db.globalSettings.get(key);
  return result?.value as T | undefined;
}

export async function setGlobalSetting<T>(key: string, value: T): Promise<void> {
  await waitForDb();
  await db.globalSettings.put({ key, value });
}

export async function getAllGlobalSettings(): Promise<Record<string, unknown>> {
  await waitForDb();
  const settings: Record<string, unknown> = {};
  const all = await db.globalSettings.toArray();
  for (const { key, value } of all) {
    settings[key] = value;
  }
  return settings;
}

// App-specific settings helpers
export async function getAppSetting<T>(appId: AppId, key: string): Promise<T | undefined> {
  await waitForDb();
  const result = await db.appSettings.get([appId, key]);
  return result?.value as T | undefined;
}

export async function setAppSetting<T>(appId: AppId, key: string, value: T): Promise<void> {
  await waitForDb();
  await db.appSettings.put({ appId, key, value });
}

export async function getAllAppSettings(appId: AppId): Promise<Record<string, unknown>> {
  await waitForDb();
  const settings: Record<string, unknown> = {};
  const all = await db.appSettings.where('appId').equals(appId).toArray();
  for (const { key, value } of all) {
    settings[key] = value;
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

// Legacy compatibility - will be removed after migration
export type { AppSettings } from '@/types';
export { getSetting, setSetting, getAllSettings } from './legacySettings';

// Re-export for backwards compatibility during transition
export { DB_NAME };
