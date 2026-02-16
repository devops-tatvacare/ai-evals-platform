/**
 * Listings API - HTTP client for listings API.
 *
 * Backend outputs camelCase via Pydantic alias_generator.
 * No manual field mapping needed.
 */
import type { Listing } from '@/types';
import { apiRequest } from './client';

/** Parse ISO date strings into Date objects */
function parseDates(data: Record<string, unknown>): Listing {
  return {
    ...data,
    createdAt: new Date(data.createdAt as string),
    updatedAt: new Date(data.updatedAt as string),
  } as Listing;
}

export const listingsRepository = {
  async getAll(appId: string): Promise<Listing[]> {
    const data = await apiRequest<Record<string, unknown>[]>(`/api/listings?app_id=${appId}`);
    return data.map(parseDates);
  },

  async getById(appId: string, id: string): Promise<Listing> {
    const data = await apiRequest<Record<string, unknown>>(`/api/listings/${id}?app_id=${appId}`);
    return parseDates(data);
  },

  async create(appId: string, listingData: Partial<Listing>): Promise<Listing> {
    const data = await apiRequest<Record<string, unknown>>('/api/listings', {
      method: 'POST',
      body: JSON.stringify({ ...listingData, appId }),
    });
    return parseDates(data);
  },

  async update(_appId: string, id: string, updates: Partial<Listing>): Promise<void> {
    await apiRequest(`/api/listings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(appId: string, id: string): Promise<void> {
    await apiRequest(`/api/listings/${id}?app_id=${appId}`, {
      method: 'DELETE',
    });
  },

  async search(appId: string, query: string): Promise<Listing[]> {
    const data = await apiRequest<Record<string, unknown>[]>(`/api/listings/search?app_id=${appId}&q=${encodeURIComponent(query)}`);
    return data.map(parseDates);
  },
};
