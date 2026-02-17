/**
 * Context-Aware Data Hooks
 * Automatically inject currentApp from appStore into data operations
 */

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useListingsStore } from '@/stores/listingsStore';
import { useSchemasStore } from '@/stores/schemasStore';
import { usePromptsStore } from '@/stores/promptsStore';
import { APPS } from '@/types';
import type { Listing, SchemaDefinition, PromptDefinition, AppId } from '@/types';

/**
 * Get listings for the current app
 */
export function useCurrentListings(): Listing[] {
  const appId = useAppStore((state) => state.currentApp);
  const listings = useListingsStore((state) => state.listings[appId] ?? []);
  return listings;
}

/**
 * Get listings operations for the current app
 */
export function useCurrentListingsActions() {
  const appId = useAppStore((state) => state.currentApp);
  const setListings = useListingsStore((state) => state.setListings);
  const addListing = useListingsStore((state) => state.addListing);
  const updateListing = useListingsStore((state) => state.updateListing);
  const removeListing = useListingsStore((state) => state.removeListing);

  return useMemo(() => ({
    setListings: (listings: Listing[]) => setListings(appId, listings),
    addListing: (listing: Listing) => addListing(appId, listing),
    updateListing: (id: string, updates: Partial<Listing>) => updateListing(appId, id, updates),
    removeListing: (id: string) => removeListing(appId, id),
  }), [appId, setListings, addListing, updateListing, removeListing]);
}

/**
 * Get schemas for the current app
 */
export function useCurrentSchemas(): SchemaDefinition[] {
  const appId = useAppStore((state) => state.currentApp);
  const schemas = useSchemasStore((state) => state.schemas[appId] ?? []);
  return schemas;
}

/**
 * Get schemas operations for the current app
 */
export function useCurrentSchemasActions() {
  const appId = useAppStore((state) => state.currentApp);
  const loadSchemas = useSchemasStore((state) => state.loadSchemas);
  const getSchema = useSchemasStore((state) => state.getSchema);
  const getSchemasByType = useSchemasStore((state) => state.getSchemasByType);
  const saveSchema = useSchemasStore((state) => state.saveSchema);
  const deleteSchema = useSchemasStore((state) => state.deleteSchema);

  return useMemo(() => ({
    loadSchemas: (promptType?: SchemaDefinition['promptType']) => loadSchemas(appId, promptType),
    getSchema: (id: string) => getSchema(appId, id),
    getSchemasByType: (promptType: SchemaDefinition['promptType']) => getSchemasByType(appId, promptType),
    saveSchema: (schema: Parameters<typeof saveSchema>[1]) => saveSchema(appId, schema),
    deleteSchema: (id: string) => deleteSchema(appId, id),
  }), [appId, loadSchemas, getSchema, getSchemasByType, saveSchema, deleteSchema]);
}

/**
 * Get prompts for the current app
 */
export function useCurrentPrompts(): PromptDefinition[] {
  const appId = useAppStore((state) => state.currentApp);
  const prompts = usePromptsStore((state) => state.prompts[appId] ?? []);
  return prompts;
}

/**
 * Get prompts operations for the current app
 */
export function useCurrentPromptsActions() {
  const appId = useAppStore((state) => state.currentApp);
  const loadPrompts = usePromptsStore((state) => state.loadPrompts);
  const getPrompt = usePromptsStore((state) => state.getPrompt);
  const getPromptsByType = usePromptsStore((state) => state.getPromptsByType);
  const savePrompt = usePromptsStore((state) => state.savePrompt);
  const deletePrompt = usePromptsStore((state) => state.deletePrompt);

  return useMemo(() => ({
    loadPrompts: (promptType?: PromptDefinition['promptType']) => loadPrompts(appId, promptType),
    getPrompt: (id: string) => getPrompt(appId, id),
    getPromptsByType: (promptType: PromptDefinition['promptType']) => getPromptsByType(appId, promptType),
    savePrompt: (prompt: Parameters<typeof savePrompt>[1]) => savePrompt(appId, prompt),
    deletePrompt: (id: string) => deletePrompt(appId, id),
  }), [appId, loadPrompts, getPrompt, getPromptsByType, savePrompt, deletePrompt]);
}

/**
 * Get current app metadata
 */
export function useCurrentAppMetadata() {
  const appId = useAppStore((state) => state.currentApp);
  return APPS[appId];
}

/**
 * Get current appId
 */
export function useCurrentAppId(): AppId {
  return useAppStore((state) => state.currentApp);
}
