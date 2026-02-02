/**
 * Data Migration Utility
 * Handles migration from old database schema to new unified database
 */

import Dexie from 'dexie';
import { db, waitForDb } from './db';
import type { Listing, AppId } from '@/types';

const OLD_DB_NAME = 'voice-rx-evaluator';
const OLD_SCHEMAS_DB = 'voice-rx-schemas';
const OLD_PROMPTS_DB = 'voice-rx-prompts';

interface MigrationResult {
  migrated: boolean;
  listingsCount: number;
  filesCount: number;
  errors: string[];
}

/**
 * Check if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
  // Wait for DB to be ready first
  const dbReady = await waitForDb();
  if (!dbReady) {
    console.log('[Migration] DB not available, skipping migration check');
    return false;
  }
  
  // Check if old database exists
  const oldDbExists = await Dexie.exists(OLD_DB_NAME);
  if (!oldDbExists) return false;
  
  // Check if we have any data in the new database
  const existingListings = await db.listings.count();
  return existingListings === 0;
}

/**
 * Migrate data from old Voice Rx database to new unified database
 */
export async function migrateFromOldDatabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    migrated: false,
    listingsCount: 0,
    filesCount: 0,
    errors: [],
  };

  // Wait for DB to be ready first
  const dbReady = await waitForDb();
  if (!dbReady) {
    console.log('[Migration] DB not available, skipping migration');
    return result;
  }

  try {
    // Check if old database exists
    const oldDbExists = await Dexie.exists(OLD_DB_NAME);
    if (!oldDbExists) {
      console.log('[Migration] No old database found, skipping migration');
      return result;
    }

    console.log('[Migration] Starting migration from voice-rx-evaluator...');

    // Open old database
    const oldDb = new Dexie(OLD_DB_NAME);
    oldDb.version(1).stores({
      listings: 'id, title, createdAt, updatedAt, status',
      files: 'id, createdAt',
      settings: 'key',
    });

    // Migrate listings
    const oldListings = await oldDb.table('listings').toArray();
    console.log(`[Migration] Found ${oldListings.length} listings to migrate`);

    for (const oldListing of oldListings) {
      try {
        // Add appId to listing
        const newListing: Listing = {
          ...oldListing,
          appId: 'voice-rx' as AppId,
          // Ensure dates are proper Date objects
          createdAt: new Date(oldListing.createdAt),
          updatedAt: new Date(oldListing.updatedAt),
        };

        await db.listings.put(newListing);
        result.listingsCount++;
      } catch (err) {
        const error = `Failed to migrate listing ${oldListing.id}: ${err}`;
        console.error('[Migration]', error);
        result.errors.push(error);
      }
    }

    // Migrate files
    const oldFiles = await oldDb.table('files').toArray();
    console.log(`[Migration] Found ${oldFiles.length} files to migrate`);

    for (const oldFile of oldFiles) {
      try {
        await db.files.put({
          ...oldFile,
          appId: 'voice-rx' as AppId,
          createdAt: new Date(oldFile.createdAt),
        });
        result.filesCount++;
      } catch (err) {
        const error = `Failed to migrate file ${oldFile.id}: ${err}`;
        console.error('[Migration]', error);
        result.errors.push(error);
      }
    }

    // Close old database
    oldDb.close();

    result.migrated = true;
    console.log(`[Migration] Migration complete: ${result.listingsCount} listings, ${result.filesCount} files`);

    return result;
  } catch (err) {
    const error = `Migration failed: ${err}`;
    console.error('[Migration]', error);
    result.errors.push(error);
    return result;
  }
}

/**
 * Delete old databases after successful migration
 * Only call this after verifying migration was successful
 */
export async function cleanupOldDatabases(): Promise<void> {
  const dbsToDelete = [OLD_DB_NAME, OLD_SCHEMAS_DB, OLD_PROMPTS_DB];
  
  for (const dbName of dbsToDelete) {
    try {
      const exists = await Dexie.exists(dbName);
      if (exists) {
        await Dexie.delete(dbName);
        console.log(`[Migration] Deleted old database: ${dbName}`);
      }
    } catch (err) {
      console.error(`[Migration] Failed to delete ${dbName}:`, err);
    }
  }
}

/**
 * Run migration on app startup if needed
 */
export async function runStartupMigration(): Promise<void> {
  try {
    if (await needsMigration()) {
      console.log('[Migration] Migration needed, starting...');
      const result = await migrateFromOldDatabase();
      
      if (result.migrated && result.errors.length === 0) {
        console.log('[Migration] Migration successful');
        // Don't auto-delete old databases - let user verify first
      } else if (result.errors.length > 0) {
        console.warn('[Migration] Migration completed with errors:', result.errors);
      }
    }
  } catch (err) {
    console.error('[Migration] Startup migration failed:', err);
  }
}
