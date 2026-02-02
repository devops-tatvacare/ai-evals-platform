import { db, type StoredFile, waitForDb, isDbAvailable } from './db';
import type { Listing, AppId } from '@/types';
import { generateId } from '@/utils';

export const listingsRepository = {
  /**
   * Get all listings for a specific app
   */
  async getAll(appId: AppId): Promise<Listing[]> {
    // Wait for DB init to complete first
    await waitForDb();
    
    if (!isDbAvailable()) {
      console.warn('[listingsRepository] DB not available, returning empty listings');
      return [];
    }
    
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
    const available = await waitForDb();
    if (!available) return [];
    return db.listings.orderBy('updatedAt').reverse().toArray();
  },

  /**
   * Get a listing by ID, with appId verification
   */
  async getById(appId: AppId, id: string): Promise<Listing | undefined> {
    const available = await waitForDb();
    if (!available) return undefined;
    
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
    const available = await waitForDb();
    if (!available) return undefined;
    return db.listings.get(id);
  },

  /**
   * Create a new listing
   */
  async create(appId: AppId, listing: Omit<Listing, 'id' | 'appId' | 'createdAt' | 'updatedAt'>): Promise<Listing> {
    console.log('[listingsRepository] create() called');
    
    // Wait for DB init first
    await waitForDb();
    console.log('[listingsRepository] waitForDb() complete, available:', isDbAvailable());
    
    const now = new Date();
    const newListing: Listing = {
      ...listing,
      id: generateId(),
      appId,
      createdAt: now,
      updatedAt: now,
    };
    
    // Only persist if DB available
    if (isDbAvailable()) {
      try {
        console.log('[listingsRepository] Adding listing to DB...');
        // Add timeout to prevent hanging
        const addPromise = db.listings.add(newListing);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Listing save timed out')), 5000)
        );
        
        await Promise.race([addPromise, timeoutPromise]);
        console.log('[listingsRepository] Listing saved to DB');
      } catch (err) {
        console.error('[listingsRepository] Failed to persist listing:', err);
        // Continue - listing will work in memory for this session
      }
    } else {
      console.warn('[listingsRepository] DB not available, listing will not be persisted');
    }
    
    return newListing;
  },

  /**
   * Update a listing (verifies appId ownership)
   */
  async update(appId: AppId, id: string, updates: Partial<Listing>): Promise<void> {
    await waitForDb();
    
    if (!isDbAvailable()) {
      console.warn('[listingsRepository] DB not available, update skipped');
      return;
    }
    
    const existing = await db.listings.get(id);
    if (!existing) {
      throw new Error(`Listing ${id} not found`);
    }
    if (existing.appId !== appId) {
      throw new Error(`Listing ${id} belongs to ${existing.appId}, not ${appId}`);
    }
    await db.listings.update(id, {
      ...updates,
      updatedAt: new Date(),
    });
  },

  /**
   * Delete a listing and associated files (verifies appId ownership)
   */
  async delete(appId: AppId, id: string): Promise<void> {
    await waitForDb();
    
    if (!isDbAvailable()) {
      console.warn('[listingsRepository] DB not available, delete skipped');
      return;
    }
    
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
    const available = await waitForDb();
    if (!available) return [];
    
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
    console.log('[filesRepository] getById() called:', id);
    
    if (!isDbAvailable()) {
      console.log('[filesRepository] getById() DB not ready, returning undefined');
      return undefined;
    }
    
    try {
      console.log('[filesRepository] getById() querying DB...');
      const result = await Promise.race([
        db.files.get(id),
        new Promise<StoredFile | undefined>((_, reject) => 
          setTimeout(() => reject(new Error('DB query timeout after 5s')), 5000)
        )
      ]);
      console.log('[filesRepository] getById() result:', result ? 'found' : 'not found');
      return result;
    } catch (err) {
      console.error('[filesRepository] getById() error:', err);
      return undefined;
    }
  },

  /**
   * Save a file
   */
  async save(appId: AppId, data: Blob): Promise<string> {
    console.log('[filesRepository] save() called, size:', data.size);
    
    // Wait for DB init first
    await waitForDb();
    console.log('[filesRepository] waitForDb() complete, available:', isDbAvailable());
    
    const id = generateId();
    
    // Only persist if DB available
    if (isDbAvailable()) {
      try {
        console.log('[filesRepository] Adding file to DB...');
        // Add timeout to prevent hanging
        const addPromise = db.files.add({
          id,
          appId,
          data,
          createdAt: new Date(),
        });
        
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('File save timed out')), 5000)
        );
        
        await Promise.race([addPromise, timeoutPromise]);
        console.log('[filesRepository] File saved to DB');
      } catch (err) {
        console.error('[filesRepository] Failed to persist file:', err);
        // Continue - return ID anyway for in-memory use
      }
    } else {
      console.warn('[filesRepository] DB not available, file will not be persisted');
    }
    
    return id;
  },

  /**
   * Delete a file
   */
  async delete(id: string): Promise<void> {
    await waitForDb();
    if (!isDbAvailable()) return;
    await db.files.delete(id);
  },

  /**
   * Get all files for an app
   */
  async getAllForApp(appId: AppId): Promise<StoredFile[]> {
    const available = await waitForDb();
    if (!available) return [];
    return db.files.where('appId').equals(appId).toArray();
  },
};
