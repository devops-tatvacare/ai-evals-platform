import { db, type StoredFile } from './db';
import type { Listing, AppId } from '@/types';
import { generateId } from '@/utils';

export const listingsRepository = {
  /**
   * Get all listings for a specific app
   */
  async getAll(appId: AppId): Promise<Listing[]> {
    return db.listings
      .where('appId')
      .equals(appId)
      .reverse()
      .sortBy('updatedAt');
  },

  /**
   * Get all listings across all apps (for migration/admin purposes)
   */
  async getAllApps(): Promise<Listing[]> {
    return db.listings.orderBy('updatedAt').reverse().toArray();
  },

  /**
   * Get a listing by ID, with appId verification
   */
  async getById(appId: AppId, id: string): Promise<Listing | undefined> {
    const listing = await db.listings.get(id);
    if (listing && listing.appId !== appId) {
      console.warn(`Listing ${id} belongs to ${listing.appId}, not ${appId}`);
      return undefined;
    }
    return listing;
  },

  /**
   * Get a listing by ID without appId check (for internal use)
   */
  async getByIdUnsafe(id: string): Promise<Listing | undefined> {
    return db.listings.get(id);
  },

  /**
   * Create a new listing
   */
  async create(appId: AppId, listing: Omit<Listing, 'id' | 'appId' | 'createdAt' | 'updatedAt'>): Promise<Listing> {
    const now = new Date();
    const newListing: Listing = {
      ...listing,
      id: generateId(),
      appId,
      createdAt: now,
      updatedAt: now,
    };
    
    await db.listings.add(newListing);
    return newListing;
  },

  /**
   * Update a listing (verifies appId ownership)
   */
  async update(appId: AppId, id: string, updates: Partial<Listing>): Promise<void> {
    const existing = await db.listings.get(id);
    if (!existing) {
      throw new Error(`Listing ${id} not found`);
    }
    if (existing.appId !== appId) {
      throw new Error(`Listing ${id} belongs to ${existing.appId}, not ${appId}`);
    }
    
    console.log('[DEBUG NORM] Repository update - incoming updates:', {
      listingId: id,
      hasAiEval: !!(updates as any).aiEval,
      aiEvalKeys: (updates as any).aiEval ? Object.keys((updates as any).aiEval) : [],
      hasNormalizedOriginal: !!(updates as any).aiEval?.normalizedOriginal,
      normalizedSegmentCount: (updates as any).aiEval?.normalizedOriginal?.segments?.length,
      metaEnabled: (updates as any).aiEval?.normalizationMeta?.enabled,
    });
    
    const updatePayload = {
      ...updates,
      updatedAt: new Date(),
    };
    
    console.log('[DEBUG NORM] Repository update - final payload to Dexie:', {
      payloadKeys: Object.keys(updatePayload),
      hasAiEvalInPayload: !!(updatePayload as any).aiEval,
      aiEvalNormalizedExists: !!(updatePayload as any).aiEval?.normalizedOriginal,
    });
    
    await db.listings.update(id, updatePayload);
    
    console.log('[DEBUG NORM] Repository update - Dexie update completed, reading back...');
    
    const updated = await db.listings.get(id);
    console.log('[DEBUG NORM] Repository update - data read back from DB:', {
      hasAiEval: !!updated?.aiEval,
      hasNormalizedOriginal: !!updated?.aiEval?.normalizedOriginal,
      normalizedSegmentCount: updated?.aiEval?.normalizedOriginal?.segments?.length,
      metaEnabled: updated?.aiEval?.normalizationMeta?.enabled,
      aiEvalKeys: updated?.aiEval ? Object.keys(updated.aiEval) : [],
    });
  },

  /**
   * Delete a listing and associated files (verifies appId ownership)
   */
  async delete(appId: AppId, id: string): Promise<void> {
    const listing = await db.listings.get(id);
    if (!listing) return;
    
    if (listing.appId !== appId) {
      throw new Error(`Listing ${id} belongs to ${listing.appId}, not ${appId}`);
    }
    
    // Delete associated files
    const fileIds = [
      listing.audioFile?.id,
      listing.transcriptFile?.id,
      listing.structuredJsonFile?.id,
    ].filter((id): id is string => !!id);
    
    await Promise.all(fileIds.map(fileId => db.files.delete(fileId)));
    await db.listings.delete(id);
  },

  /**
   * Search listings by title within an app
   */
  async search(appId: AppId, query: string): Promise<Listing[]> {
    const lowerQuery = query.toLowerCase();
    return db.listings
      .where('appId')
      .equals(appId)
      .filter(listing => listing.title.toLowerCase().includes(lowerQuery))
      .toArray();
  },
};

export const filesRepository = {
  /**
   * Get a file by ID
   */
  async getById(id: string): Promise<StoredFile | undefined> {
    return db.files.get(id);
  },

  /**
   * Save a file
   */
  async save(data: Blob): Promise<string> {
    const id = generateId();
    await db.files.add({
      id,
      data,
      createdAt: new Date(),
    });
    return id;
  },

  /**
   * Delete a file
   */
  async delete(id: string): Promise<void> {
    await db.files.delete(id);
  },
};
