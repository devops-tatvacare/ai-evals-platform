/**
 * Tag Registry Repository
 * Manages global tag registry for autocomplete and usage tracking
 */

import type { AppId } from '@/types';
import { db, type Entity } from './db';
import { TAG_LIMITS, TAG_VALIDATION } from '@/constants';

export interface TagRegistryItem {
  name: string;
  count: number;
  lastUsed: Date;
}

export interface TagRegistryData {
  tags: TagRegistryItem[];
}

const ENTITY_TYPE = 'tagRegistry';
const REGISTRY_KEY = 'registry';

/**
 * Validate tag name
 */
function validateTagName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length < TAG_VALIDATION.MIN_LENGTH) {
    return { valid: false, error: 'Tag name cannot be empty' };
  }
  
  if (name.length > TAG_LIMITS.MAX_TAG_LENGTH) {
    return { valid: false, error: `Tag name cannot exceed ${TAG_LIMITS.MAX_TAG_LENGTH} characters` };
  }
  
  if (!TAG_VALIDATION.PATTERN.test(name)) {
    return { valid: false, error: 'Tag name can only contain letters, numbers, spaces, and hyphens' };
  }
  
  return { valid: true };
}

/**
 * Normalize tag name (lowercase, trim)
 */
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Get tag registry for an app
 */
export async function getRegistry(appId: AppId): Promise<TagRegistryData> {
  const entity = await db.entities
    .where('type').equals(ENTITY_TYPE)
    .filter(e => e.appId === appId && e.key === REGISTRY_KEY)
    .first();
  
  if (!entity) {
    return { tags: [] };
  }
  
  const data = entity.data as Record<string, unknown>;
  if (!data.tags || !Array.isArray(data.tags)) {
    return { tags: [] };
  }
  
  // Deserialize dates from ISO strings
  const tags = (data.tags as Array<{ name: string; count: number; lastUsed: string | Date }>).map(t => ({
    name: t.name,
    count: t.count,
    lastUsed: typeof t.lastUsed === 'string' ? new Date(t.lastUsed) : t.lastUsed,
  }));
  
  return { tags };
}

/**
 * Get all tags sorted by usage count (descending)
 */
export async function getAllTags(appId: AppId): Promise<TagRegistryItem[]> {
  const registry = await getRegistry(appId);
  return registry.tags.sort((a, b) => b.count - a.count);
}

/**
 * Add or increment a tag in the registry
 */
export async function addTag(appId: AppId, tagName: string): Promise<void> {
  const validation = validateTagName(tagName);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const normalized = normalizeTagName(tagName);
  const registry = await getRegistry(appId);
  
  const existingTag = registry.tags.find(t => t.name === normalized);
  
  if (existingTag) {
    existingTag.count++;
    existingTag.lastUsed = new Date();
  } else {
    registry.tags.push({
      name: normalized,
      count: 1,
      lastUsed: new Date(),
    });
  }
  
  await saveRegistry(appId, registry);
}

/**
 * Decrement a tag's count in the registry
 * Removes tag if count reaches 0
 */
export async function decrementTag(appId: AppId, tagName: string): Promise<void> {
  const normalized = normalizeTagName(tagName);
  const registry = await getRegistry(appId);
  
  const existingTag = registry.tags.find(t => t.name === normalized);
  
  if (existingTag) {
    existingTag.count--;
    
    if (existingTag.count <= 0) {
      registry.tags = registry.tags.filter(t => t.name !== normalized);
    }
  }
  
  await saveRegistry(appId, registry);
}

/**
 * Rename a tag globally in the registry
 */
export async function renameTag(appId: AppId, oldName: string, newName: string): Promise<void> {
  const validation = validateTagName(newName);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const oldNormalized = normalizeTagName(oldName);
  const newNormalized = normalizeTagName(newName);
  
  if (oldNormalized === newNormalized) {
    return; // No change needed
  }
  
  const registry = await getRegistry(appId);
  const existingTag = registry.tags.find(t => t.name === oldNormalized);
  
  if (!existingTag) {
    throw new Error('Tag not found in registry');
  }
  
  // Check if new name already exists
  const targetTag = registry.tags.find(t => t.name === newNormalized);
  
  if (targetTag) {
    // Merge counts
    targetTag.count += existingTag.count;
    targetTag.lastUsed = new Date();
    registry.tags = registry.tags.filter(t => t.name !== oldNormalized);
  } else {
    // Rename
    existingTag.name = newNormalized;
    existingTag.lastUsed = new Date();
  }
  
  await saveRegistry(appId, registry);
}

/**
 * Delete a tag from the registry
 */
export async function deleteTag(appId: AppId, tagName: string): Promise<void> {
  const normalized = normalizeTagName(tagName);
  const registry = await getRegistry(appId);
  
  registry.tags = registry.tags.filter(t => t.name !== normalized);
  
  await saveRegistry(appId, registry);
}

/**
 * Save registry entity
 */
async function saveRegistry(appId: AppId, data: TagRegistryData): Promise<void> {
  const existing = await db.entities
    .where('type').equals(ENTITY_TYPE)
    .filter(e => e.appId === appId && e.key === REGISTRY_KEY)
    .first();
  
  const entity: Omit<Entity, 'id'> & { id?: number } = {
    appId,
    type: ENTITY_TYPE,
    key: REGISTRY_KEY,
    version: null,
    data: {
      tags: data.tags.map(t => ({
        name: t.name,
        count: t.count,
        lastUsed: t.lastUsed.toISOString(),
      })),
    } as Record<string, unknown>,
  };
  
  if (existing) {
    entity.id = existing.id;
  }
  
  if (entity.id) {
    await db.entities.put(entity as Entity);
  } else {
    await db.entities.add(entity);
  }
}

/**
 * Validate and normalize tag name for public use
 */
export function validateAndNormalizeTag(tagName: string): { valid: boolean; normalized?: string; error?: string } {
  const validation = validateTagName(tagName);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }
  return { valid: true, normalized: normalizeTagName(tagName) };
}
