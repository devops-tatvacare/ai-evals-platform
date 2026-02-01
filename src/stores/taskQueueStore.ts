import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LLMTask, LLMRequestStatus } from '@/types';
import { generateId } from '@/utils';

interface TaskQueueState {
  tasks: LLMTask[];
  
  // Actions
  addTask: (task: Omit<LLMTask, 'id' | 'createdAt' | 'status'>) => string;
  updateTask: (id: string, updates: Partial<LLMTask>) => void;
  setTaskStatus: (id: string, status: LLMRequestStatus, error?: string) => void;
  completeTask: (id: string, result: unknown) => void;
  removeTask: (id: string) => void;
  getTasksByListing: (listingId: string) => LLMTask[];
  getActiveTask: () => LLMTask | undefined;
  clearCompletedTasks: () => void;
}

export const useTaskQueueStore = create<TaskQueueState>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (taskData) => {
        const id = generateId();
        const task: LLMTask = {
          ...taskData,
          id,
          status: 'pending',
          createdAt: new Date(),
        };
        set((state) => ({
          tasks: [...state.tasks, task],
        }));
        return id;
      },

      updateTask: (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, ...updates } : task
          ),
        }));
      },

      setTaskStatus: (id, status, error) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status,
                  error: error ?? task.error,
                  completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
                }
              : task
          ),
        }));
      },

      completeTask: (id, result) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: 'completed',
                  result,
                  completedAt: new Date(),
                }
              : task
          ),
        }));
      },

      removeTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        }));
      },

      getTasksByListing: (listingId) => {
        return get().tasks.filter((task) => task.listingId === listingId);
      },

      getActiveTask: () => {
        return get().tasks.find(
          (task) => task.status === 'pending' || task.status === 'processing'
        );
      },

      clearCompletedTasks: () => {
        set((state) => ({
          tasks: state.tasks.filter(
            (task) => task.status !== 'completed' && task.status !== 'failed'
          ),
        }));
      },
    }),
    {
      name: 'voice-rx-task-queue',
      partialize: (state) => ({
        // Only persist completed/failed tasks for history
        tasks: state.tasks.filter(
          (task) => task.status === 'completed' || task.status === 'failed'
        ),
      }),
    }
  )
);
