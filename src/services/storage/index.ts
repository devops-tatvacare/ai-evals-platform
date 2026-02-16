/**
 * Storage barrel export.
 * All repositories now delegate to HTTP API (src/services/api/).
 * The Dexie/IndexedDB code is still present but unused.
 * It will be removed in Phase 4.
 */
export { db, getEntity, getEntities, saveEntity, deleteEntity, getStorageUsage } from './db';
export type { Entity } from './db';

export {
  listingsRepository,
  filesRepository,
  promptsRepository,
  schemasRepository,
  evaluatorsRepository,
  chatSessionsRepository,
  chatMessagesRepository,
  historyRepository,
  settingsRepository,
  tagRegistryRepository,
} from '@/services/api';

export type { TagRegistryItem, TagRegistryData } from '@/services/api';
