import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppNotification } from '@/types';

interface UIState {
  // Loading state
  globalLoading: boolean;
  loadingMessage?: string;
  setGlobalLoading: (loading: boolean, message?: string) => void;
  
  // Sidebar state
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  
  // Notification queue
  notifications: AppNotification[];
  addNotification: (notification: AppNotification) => void;
  dismissNotification: (id: string) => void;
  
  // Modal management
  activeModal: string | null;
  modalData: Record<string, unknown>;
  openModal: (id: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Loading
      globalLoading: false,
      loadingMessage: undefined,
      setGlobalLoading: (loading, message) => set({ 
        globalLoading: loading, 
        loadingMessage: message,
      }),
      
      // Sidebar
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      // Notifications
      notifications: [],
      addNotification: (notification) => set((state) => ({
        notifications: [...state.notifications, notification],
      })),
      dismissNotification: (id) => set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      })),
      
      // Modal
      activeModal: null,
      modalData: {},
      openModal: (id, data = {}) => set({ activeModal: id, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: {} }),
    }),
    {
      name: 'voice-rx-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
