/**
 * Tags API - HTTP implementation replacing Dexie-based tagRegistryRepository.
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
    last_used: string;
  }>>(`/api/tags?app_id=${appId}`);

  return data.map(t => ({
    name: t.name,
    count: t.count,
    lastUsed: new Date(t.last_used),
  }));
}

export async function addTag(appId: AppId, tagName: string): Promise<void> {
  await apiRequest('/api/tags', {
    method: 'POST',
    body: JSON.stringify({
      app_id: appId,
      name: tagName.trim().toLowerCase(),
    }),
  });
}

export async function renameTag(appId: AppId, oldName: string, newName: string): Promise<void> {
  await apiRequest('/api/tags/rename', {
    method: 'PUT',
    body: JSON.stringify({
      app_id: appId,
      old_name: oldName.trim().toLowerCase(),
      new_name: newName.trim().toLowerCase(),
    }),
  });
}

export async function decrementTag(appId: AppId, tagName: string): Promise<void> {
  await apiRequest('/api/tags/decrement', {
    method: 'PUT',
    body: JSON.stringify({
      app_id: appId,
      name: tagName.trim().toLowerCase(),
    }),
  });
}

export async function deleteTag(appId: AppId, tagName: string): Promise<void> {
  await apiRequest(`/api/tags?app_id=${appId}&name=${encodeURIComponent(tagName.trim().toLowerCase())}`, {
    method: 'DELETE',
  });
}
