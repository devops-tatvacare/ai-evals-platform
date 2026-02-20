/**
 * Global job tracker store — tracks in-flight background jobs across the app.
 *
 * Uses Zustand persist middleware with sessionStorage so that tracked jobs
 * survive in-tab navigation (SPA) but clear on tab close.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface TrackedJob {
  jobId: string;
  runId?: string;
  appId: string;
  jobType: string;
  label: string;
  trackedAt: number;
  listingId?: string;
}

interface JobTrackerState {
  activeJobs: TrackedJob[];
  trackJob: (job: TrackedJob) => void;
  resolveRunId: (jobId: string, runId: string) => void;
  untrackJob: (jobId: string) => void;
  hasActiveJobs: () => boolean;
}

export const useJobTrackerStore = create<JobTrackerState>()(
  persist(
    (set, get) => ({
      activeJobs: [],

      trackJob: (job) =>
        set((state) => ({
          activeJobs: [
            ...state.activeJobs.filter((j) => j.jobId !== job.jobId),
            job,
          ],
        })),

      resolveRunId: (jobId, runId) =>
        set((state) => ({
          activeJobs: state.activeJobs.map((j) =>
            j.jobId === jobId ? { ...j, runId } : j,
          ),
        })),

      untrackJob: (jobId) =>
        set((state) => ({
          activeJobs: state.activeJobs.filter((j) => j.jobId !== jobId),
        })),

      hasActiveJobs: () => get().activeJobs.length > 0,
    }),
    {
      name: 'job-tracker',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
