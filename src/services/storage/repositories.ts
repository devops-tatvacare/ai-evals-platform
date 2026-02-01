import { db, type StoredFile } from './db';
import type { Listing } from '@/types';
import { generateId } from '@/utils';

export const listingsRepository = {
  async getAll(): Promise<Listing[]> {
    return db.listings.orderBy('updatedAt').reverse().toArray();
  },

  async getById(id: string): Promise<Listing | undefined> {
    return db.listings.get(id);
  },

  async create(listing: Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>): Promise<Listing> {
    const now = new Date();
    const newListing: Listing = {
      ...listing,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.listings.add(newListing);
    return newListing;
  },

  async update(id: string, updates: Partial<Listing>): Promise<void> {
    await db.listings.update(id, {
      ...updates,
      updatedAt: new Date(),
    });
  },

  async delete(id: string): Promise<void> {
    const listing = await db.listings.get(id);
    if (listing) {
      // Delete associated files
      const fileIds = [
        listing.audioFile?.id,
        listing.transcriptFile?.id,
        listing.structuredJsonFile?.id,
      ].filter((id): id is string => !!id);
      
      await Promise.all(fileIds.map(fileId => db.files.delete(fileId)));
      await db.listings.delete(id);
    }
  },

  async search(query: string): Promise<Listing[]> {
    const lowerQuery = query.toLowerCase();
    return db.listings
      .filter(listing => listing.title.toLowerCase().includes(lowerQuery))
      .toArray();
  },
};

export const filesRepository = {
  async getById(id: string): Promise<StoredFile | undefined> {
    return db.files.get(id);
  },

  async save(data: Blob): Promise<string> {
    const id = generateId();
    await db.files.add({
      id,
      data,
      createdAt: new Date(),
    });
    return id;
  },

  async delete(id: string): Promise<void> {
    await db.files.delete(id);
  },
};
