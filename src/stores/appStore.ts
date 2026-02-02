import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppId } from '@/types';
import { DEFAULT_APP } from '@/types';

interface AppStoreState {
  currentApp: AppId;
  setCurrentApp: (app: AppId) => void;
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set) => ({
      currentApp: DEFAULT_APP,
      setCurrentApp: (app) => set({ currentApp: app }),
    }),
    {
      name: 'app-selection',
    }
  )
);

// Re-export AppId for convenience
export type { AppId };
