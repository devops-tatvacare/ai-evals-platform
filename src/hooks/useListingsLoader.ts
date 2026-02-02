import { useEffect } from 'react';
import { useListingsStore, useAppStore } from '@/stores';
import { listingsRepository } from '@/services/storage';

export function useListingsLoader() {
  const appId = useAppStore((state) => state.currentApp);
  const { setListings, setLoading } = useListingsStore();

  useEffect(() => {
    async function loadListings() {
      setLoading(true);
      try {
        const listings = await listingsRepository.getAll(appId);
        setListings(appId, listings);
      } catch (err) {
        console.error('Failed to load listings:', err);
      } finally {
        setLoading(false);
      }
    }

    loadListings();
  }, [appId, setListings, setLoading]);
}
