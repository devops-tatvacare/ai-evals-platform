/**
 * Listings API - HTTP implementation replacing Dexie-based listingsRepository.
 *
 * IMPORTANT: This file exports the same interface as the old listingsRepository.
 * Stores call these methods identically. No store changes needed.
 */
import type { Listing } from '@/types';
import { apiRequest } from './client';

export const listingsRepository = {
  async getAll(appId: string): Promise<Listing[]> {
    return apiRequest<Listing[]>(`/api/listings?app_id=${appId}`);
  },

  async getById(appId: string, id: string): Promise<Listing> {
    return apiRequest<Listing>(`/api/listings/${id}?app_id=${appId}`);
  },

  async create(appId: string, listingData: Partial<Listing>): Promise<Listing> {
    return apiRequest<Listing>('/api/listings', {
      method: 'POST',
      body: JSON.stringify({ ...listingData, app_id: appId }),
    });
  },

  async update(appId: string, id: string, updates: Partial<Listing>): Promise<void> {
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
    return apiRequest<Listing[]>(`/api/listings/search?app_id=${appId}&q=${encodeURIComponent(query)}`);
  },
};
