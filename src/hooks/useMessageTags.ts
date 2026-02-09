/**
 * useMessageTags Hook
 * Hook for managing message tags with registry synchronization
 */

import { useState, useEffect, useCallback } from 'react';
import { chatMessagesRepository, tagRegistryRepository, type TagRegistryItem } from '@/services/storage';
import type { AppId } from '@/types';

interface UseMessageTagsParams {
  messageId: string;
  initialTags: string[];
  appId: AppId;
}

interface UseMessageTagsReturn {
  tags: string[];
  allTags: TagRegistryItem[];
  isLoading: boolean;
  error: string | null;
  addTag: (tagName: string) => Promise<void>;
  removeTag: (tagName: string) => Promise<void>;
  refreshRegistry: () => Promise<void>;
}

export function useMessageTags({
  messageId,
  initialTags,
  appId,
}: UseMessageTagsParams): UseMessageTagsReturn {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [allTags, setAllTags] = useState<TagRegistryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tag registry on mount
  const loadRegistry = useCallback(async () => {
    try {
      const registry = await tagRegistryRepository.getAllTags(appId);
      setAllTags(registry);
    } catch (err) {
      console.error('Failed to load tag registry:', err);
    }
  }, [appId]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const addTag = useCallback(async (tagName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Add tag to message
      await chatMessagesRepository.addTag(messageId, tagName);
      
      // Add to registry
      await tagRegistryRepository.addTag(appId, tagName);
      
      // Update local state
      const normalized = tagName.trim().toLowerCase();
      setTags((prev) => [...prev, normalized]);
      
      // Refresh registry to get updated counts
      await loadRegistry();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add tag';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [messageId, appId, loadRegistry]);

  const removeTag = useCallback(async (tagName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Remove from message
      await chatMessagesRepository.removeTag(messageId, tagName);
      
      // Decrement in registry
      await tagRegistryRepository.decrementTag(appId, tagName);
      
      // Update local state
      const normalized = tagName.trim().toLowerCase();
      setTags((prev) => prev.filter(t => t !== normalized));
      
      // Refresh registry to get updated counts
      await loadRegistry();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove tag';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [messageId, appId, loadRegistry]);

  const refreshRegistry = useCallback(async () => {
    await loadRegistry();
  }, [loadRegistry]);

  return {
    tags,
    allTags,
    isLoading,
    error,
    addTag,
    removeTag,
    refreshRegistry,
  };
}
