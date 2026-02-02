/**
 * Context-Aware Data Hooks
 * Automatically inject currentApp from appStore into data operations
 */

import { useAppStore } from '@/stores/appStore';
import { useListingsStore } from '@/stores/listingsStore';
import { useSchemasStore } from '@/stores/schemasStore';
import { usePromptsStore } from '@/stores/promptsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useGlobalSettingsStore } from '@/stores/globalSettingsStore';
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
  const { setListings, addListing, updateListing, removeListing } = useListingsStore();

  return {
    setListings: (listings: Listing[]) => setListings(appId, listings),
    addListing: (listing: Listing) => addListing(appId, listing),
    updateListing: (id: string, updates: Partial<Listing>) => updateListing(appId, id, updates),
    removeListing: (id: string) => removeListing(appId, id),
  };
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
  const { loadSchemas, getSchema, getSchemasByType, saveSchema, deleteSchema } = useSchemasStore();

  return {
    loadSchemas: (promptType?: SchemaDefinition['promptType']) => loadSchemas(appId, promptType),
    getSchema: (id: string) => getSchema(appId, id),
    getSchemasByType: (promptType: SchemaDefinition['promptType']) => getSchemasByType(appId, promptType),
    saveSchema: (schema: Parameters<typeof saveSchema>[1]) => saveSchema(appId, schema),
    deleteSchema: (id: string) => deleteSchema(appId, id),
  };
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
  const { loadPrompts, getPrompt, getPromptsByType, savePrompt, deletePrompt } = usePromptsStore();

  return {
    loadPrompts: (promptType?: PromptDefinition['promptType']) => loadPrompts(appId, promptType),
    getPrompt: (id: string) => getPrompt(appId, id),
    getPromptsByType: (promptType: PromptDefinition['promptType']) => getPromptsByType(appId, promptType),
    savePrompt: (prompt: Parameters<typeof savePrompt>[1]) => savePrompt(appId, prompt),
    deletePrompt: (id: string) => deletePrompt(appId, id),
  };
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

/**
 * Get app-specific settings (legacy settings store)
 * TODO: Split into app-specific settings in Phase 3
 */
export function useCurrentAppSettings() {
  // For now, return the existing settings store
  // In Phase 3, this will return app-scoped settings
  return useSettingsStore();
}

/**
 * Get global settings (shared across all apps)
 */
export function useGlobalSettings() {
  return useGlobalSettingsStore();
}
