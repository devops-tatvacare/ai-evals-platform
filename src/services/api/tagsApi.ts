/**
 * Tags API - HTTP client for tags API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import type { AppId } from '@/types';
import { apiRequest } from './client';

export interface TagRegistryItem {
  name: string;
  count: number;
  lastUsed: Date;
}

export interface TagRegistryData {
  tags: TagRegistryItem[];
}

export async function getAllTags(appId: AppId): Promise<TagRegistryItem[]> {
  const data = await apiRequest<Array<{
    name: string;
    count: number;
    lastUsed: string;
  }>>(`/api/tags?app_id=${appId}`);

  return data.map(t => ({
    name: t.name,
    count: t.count,
    lastUsed: new Date(t.lastUsed),
  }));
}

export async function addTag(appId: AppId, tagName: string): Promise<void> {
  await apiRequest('/api/tags', {
    method: 'POST',
    body: JSON.stringify({
      appId: appId,
      name: tagName.trim().toLowerCase(),
    }),
  });
}

export async function renameTag(appId: AppId, oldName: string, newName: string): Promise<void> {
  const raw = await apiRequest<Array<{ id: number; name: string }>>(
    `/api/tags?app_id=${appId}`
  );
  const match = raw.find(t => t.name === oldName.trim().toLowerCase());
  if (!match) return;

  await apiRequest(`/api/tags/${match.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: newName.trim().toLowerCase() }),
  });
}

export async function decrementTag(appId: AppId, tagName: string): Promise<void> {
  const raw = await apiRequest<Array<{ id: number; name: string }>>(
    `/api/tags?app_id=${appId}`
  );
  const match = raw.find(t => t.name === tagName.trim().toLowerCase());
  if (!match) return;

  await apiRequest(`/api/tags/${match.id}/decrement`, { method: 'POST' });
}

export async function deleteTag(appId: AppId, tagName: string): Promise<void> {
  const raw = await apiRequest<Array<{ id: number; name: string }>>(
    `/api/tags?app_id=${appId}`
  );
  const match = raw.find(t => t.name === tagName.trim().toLowerCase());
  if (!match) return;

  await apiRequest(`/api/tags/${match.id}`, { method: 'DELETE' });
}
