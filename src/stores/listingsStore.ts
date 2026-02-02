import { create } from 'zustand';
import type { Listing, AppId } from '@/types';

interface ListingsState {
  // Listings keyed by appId
  listings: Record<AppId, Listing[]>;
  selectedId: string | null;
  searchQuery: string;
  isLoading: boolean;
  
  // Methods with explicit appId
  setListings: (appId: AppId, listings: Listing[]) => void;
  addListing: (appId: AppId, listing: Listing) => void;
  updateListing: (appId: AppId, id: string, updates: Partial<Listing>) => void;
  removeListing: (appId: AppId, id: string) => void;
  
  // Shared state
  setSelectedId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  
  // Getters
  getListingsForApp: (appId: AppId) => Listing[];
}

export const useListingsStore = create<ListingsState>((set, get) => ({
  listings: {
    'voice-rx': [],
    'kaira-bot': [],
  },
  selectedId: null,
  searchQuery: '',
  isLoading: false,
  
  setListings: (appId, listings) => set((state) => ({
    listings: {
      ...state.listings,
      [appId]: listings,
    },
  })),
  
  addListing: (appId, listing) => set((state) => ({
    listings: {
      ...state.listings,
      [appId]: [listing, ...(state.listings[appId] || [])],
    },
  })),
  
  updateListing: (appId, id, updates) => set((state) => ({
    listings: {
      ...state.listings,
      [appId]: (state.listings[appId] || []).map((l) => 
        l.id === id ? { ...l, ...updates, updatedAt: new Date() } : l
      ),
    },
  })),
  
  removeListing: (appId, id) => set((state) => ({
    listings: {
      ...state.listings,
      [appId]: (state.listings[appId] || []).filter((l) => l.id !== id),
    },
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),
  
  setSelectedId: (id) => set({ selectedId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLoading: (loading) => set({ isLoading: loading }),
  
  getListingsForApp: (appId) => get().listings[appId] || [],
}));
