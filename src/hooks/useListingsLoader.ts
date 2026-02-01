import { useEffect } from 'react';
import { useListingsStore } from '@/stores';
import { listingsRepository } from '@/services/storage';

export function useListingsLoader() {
  const { setListings, setLoading } = useListingsStore();

  useEffect(() => {
    async function loadListings() {
      setLoading(true);
      try {
        const listings = await listingsRepository.getAll();
        setListings(listings);
      } catch (err) {
        console.error('Failed to load listings:', err);
      } finally {
        setLoading(false);
      }
    }

    loadListings();
  }, [setListings, setLoading]);
}
