/**
 * Settings API - HTTP client for settings API.
 */
import { apiRequest } from './client';

export const settingsRepository = {
  async get(appId: string | null, key: string): Promise<unknown> {
    try {
      const params = new URLSearchParams({ key });
      if (appId) params.append('app_id', appId);

      const result = await apiRequest<{ value: unknown }>(
        `/api/settings?${params}`
      );
      return result.value;
    } catch (err) {
      // Return undefined if setting doesn't exist
      return undefined;
    }
  },

  async set(appId: string | null, key: string, value: unknown): Promise<void> {
    await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        app_id: appId,
        key,
        value,
      }),
    });
  },

  async delete(appId: string | null, key: string): Promise<void> {
    const params = new URLSearchParams({ key });
    if (appId) params.append('app_id', appId);

    await apiRequest(`/api/settings?${params}`, {
      method: 'DELETE',
    });
  },
};
