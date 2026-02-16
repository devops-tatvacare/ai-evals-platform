/**
 * Settings API - HTTP client for settings API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import { apiRequest } from './client';

interface SettingRecord {
  id: number;
  appId: string | null;
  key: string;
  value: unknown;
  updatedAt: string;
  userId: string;
}

export const settingsRepository = {
  async get(appId: string | null, key: string): Promise<unknown> {
    try {
      const params = new URLSearchParams({ key });
      if (appId) params.append('app_id', appId);

      // Backend returns a list of matching settings (even when filtered by key)
      const results = await apiRequest<SettingRecord[]>(
        `/api/settings?${params}`
      );
      return results[0]?.value;
    } catch (err) {
      // Return undefined if setting doesn't exist
      return undefined;
    }
  },

  async set(appId: string | null, key: string, value: unknown): Promise<void> {
    await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        appId: appId,
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
