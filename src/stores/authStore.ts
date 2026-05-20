import { create } from 'zustand';
import type { User, LoginCredentials } from '@/types/auth.types';
import { authApi } from '@/services/api/authApi';
import { useListingsStore } from '@/stores/listingsStore';
import { useEvaluatorsStore } from '@/stores/evaluatorsStore';
import { useChatStore } from '@/stores/chatStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { queryClient } from '@/features/orchestration/queries/queryClient';
import { useAppStore } from '@/stores/appStore';
import { useJobTrackerStore } from '@/stores/jobTrackerStore';
import { useGlobalSettingsStore } from '@/stores/globalSettingsStore';
import { useTaskQueueStore } from '@/stores/taskQueueStore';
import { useUIStore } from '@/stores/uiStore';
import { useMiniPlayerStore } from '@/stores/miniPlayerStore';
import { useCostStore } from '@/stores/costStore';
import { useChatWidgetStore } from '@/features/chat-widget/useChatWidget';

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  loadUser: () => Promise<void>;
  setAccessToken: (token: string) => void;
}

// Singleton refresh promise — prevents concurrent refresh calls from racing
let refreshPromise: Promise<boolean> | null = null;

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  isAuthenticated: false,
  isLoading: true,

  login: async (credentials) => {
    const { accessToken, user } = await authApi.login(credentials);
    localStorage.setItem('accessToken', accessToken);
    set({ accessToken, user, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort — clear local state regardless
    }
    localStorage.removeItem('accessToken');

    // Reset all data stores to prevent cross-user data leakage
    useListingsStore.getState().reset();
    useEvaluatorsStore.getState().reset();
    useChatStore.getState().reset();
    useAppSettingsStore.getState().reset();
    // Drop the cached admin AI-Settings list so the next user doesn't briefly
    // see the previous tenant's provider catalogue.
    queryClient.removeQueries({ queryKey: ['admin', 'ai-settings'] });
    useAppStore.getState().reset();
    useJobTrackerStore.getState().reset();
    useGlobalSettingsStore.getState().reset();
    useTaskQueueStore.getState().reset();
    useUIStore.getState().reset();
    useMiniPlayerStore.getState().reset();
    useCostStore.getState().reset();
    useChatWidgetStore.getState().resetForSignOut();

    set({ accessToken: null, user: null, isAuthenticated: false, isLoading: false });
  },

  refreshToken: async () => {
    // If a refresh is already in-flight, reuse it instead of firing another
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const { accessToken } = await authApi.refresh();
        localStorage.setItem('accessToken', accessToken);
        set({ accessToken });
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  },

  loadUser: async () => {
    const token = get().accessToken;
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const user = await authApi.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      // Access token expired — try refresh
      const refreshed = await get().refreshToken();
      if (refreshed) {
        try {
          const user = await authApi.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
          return;
        } catch {
          // Refresh succeeded but /me still failed — clear everything
        }
      }
      // Refresh failed — clear state
      localStorage.removeItem('accessToken');
      set({ accessToken: null, user: null, isAuthenticated: false, isLoading: false });
    }
  },

  setAccessToken: (token) => {
    localStorage.setItem('accessToken', token);
    set({ accessToken: token });
  },
}));
