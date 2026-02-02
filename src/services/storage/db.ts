import Dexie, { type Table } from 'dexie';
import type { Listing, AppId, KairaChatSession, KairaChatMessage, PromptDefinition, SchemaDefinition } from '@/types';

// Single database - no version suffix
const DB_NAME = 'ai-evals-platform';

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

// Extended types with appId for storage
export interface StoredPrompt extends PromptDefinition {
  appId: AppId;
}

export interface StoredSchema extends SchemaDefinition {
  appId: AppId;
}

export class AiEvalsPlatformDatabase extends Dexie {
  listings!: Table<Listing, string>;
  files!: Table<StoredFile, string>;
  globalSettings!: Table<GlobalSetting, string>;
  appSettings!: Table<AppSetting, [AppId, string]>;
  prompts!: Table<StoredPrompt, string>;
  schemas!: Table<StoredSchema, string>;
  kairaChatSessions!: Table<KairaChatSession, string>;
  kairaChatMessages!: Table<KairaChatMessage, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    
    // Single version with all tables
    this.version(1).stores({
      listings: 'id, appId, createdAt, updatedAt, status',
      files: 'id, appId, createdAt',
      globalSettings: 'key',
      appSettings: '[appId+key], appId',
      prompts: 'id, appId, promptType, [appId+promptType], [appId+promptType+version]',
      schemas: 'id, appId, promptType, [appId+promptType], [appId+promptType+version]',
      kairaChatSessions: 'id, appId, userId, threadId, createdAt, updatedAt, status',
      kairaChatMessages: 'id, sessionId, role, timestamp, [sessionId+timestamp]',
    });
  }
}

// Create database instance - Dexie auto-opens on first access
export const db = new AiEvalsPlatformDatabase();

// Legacy compatibility functions (no-op, Dexie handles everything)
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

// Global settings helpers (shared across all apps)
export async function getGlobalSetting<T>(key: string): Promise<T | undefined> {
  await ensureDbReady();
  const result = await db.globalSettings.get(key);
  return result?.value as T | undefined;
}

export async function setGlobalSetting<T>(key: string, value: T): Promise<void> {
  await ensureDbReady();
  await db.globalSettings.put({ key, value });
}

export async function getAllGlobalSettings(): Promise<Record<string, unknown>> {
  await ensureDbReady();
  const settings: Record<string, unknown> = {};
  const all = await db.globalSettings.toArray();
  for (const { key, value } of all) {
    settings[key] = value;
  }
  return settings;
}

// App-specific settings helpers
export async function getAppSetting<T>(appId: AppId, key: string): Promise<T | undefined> {
  await ensureDbReady();
  const result = await db.appSettings.get([appId, key]);
  return result?.value as T | undefined;
}

export async function setAppSetting<T>(appId: AppId, key: string, value: T): Promise<void> {
  await ensureDbReady();
  await db.appSettings.put({ appId, key, value });
}

export async function getAllAppSettings(appId: AppId): Promise<Record<string, unknown>> {
  await ensureDbReady();
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

export { DB_NAME };
