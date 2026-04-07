/**
 * Context-Aware Data Hooks
 * Automatically inject currentApp from appStore into data operations
 */

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useListingsStore } from '@/stores/listingsStore';
import { getAppMetadataFromConfig } from '@/types';
import type { AppConfig, Listing, AppId } from '@/types';

/**
 * Get listings for the current app
 */
export function useCurrentListings(): Listing[] {
  const appId = useAppStore((state) => state.currentApp);
  const listings = useListingsStore((state) => state.listings[appId]);
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
 * Get config for a specific app.
 */
export function useAppConfig(appId: AppId): AppConfig {
  return useAppStore((state) => state.getAppConfig(appId));
}

/**
 * Get config for the current app
 */
export function useCurrentAppConfig(): AppConfig {
  const appId = useAppStore((state) => state.currentApp);
  return useAppConfig(appId);
}

/**
 * Get current app metadata
 */
export function useCurrentAppMetadata() {
  const appId = useAppStore((state) => state.currentApp);
  const config = useCurrentAppConfig();
  return getAppMetadataFromConfig(appId, config);
}

/**
 * Get current appId
 */
export function useCurrentAppId(): AppId {
  return useAppStore((state) => state.currentApp);
}
