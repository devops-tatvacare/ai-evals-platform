import { create } from 'zustand';
import type { Listing } from '@/types';

interface ListingsState {
  listings: Listing[];
  selectedId: string | null;
  searchQuery: string;
  isLoading: boolean;
  
  setListings: (listings: Listing[]) => void;
  addListing: (listing: Listing) => void;
  updateListing: (id: string, updates: Partial<Listing>) => void;
  removeListing: (id: string) => void;
  setSelectedId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useListingsStore = create<ListingsState>((set) => ({
  listings: [],
  selectedId: null,
  searchQuery: '',
  isLoading: false,
  
  setListings: (listings) => set({ listings }),
  
  addListing: (listing) => set((state) => ({
    listings: [listing, ...state.listings],
  })),
  
  updateListing: (id, updates) => set((state) => ({
    listings: state.listings.map((l) => 
      l.id === id ? { ...l, ...updates, updatedAt: new Date() } : l
    ),
  })),
  
  removeListing: (id) => set((state) => ({
    listings: state.listings.filter((l) => l.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),
  
  setSelectedId: (id) => set({ selectedId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLoading: (loading) => set({ isLoading: loading }),
}));
