import { useMemo } from 'react';
import { useTaskQueueStore, useJobTrackerStore } from '@/stores';
import type { Listing } from '@/types';

/**
 * Hook to track all active operations for a listing.
 * Checks both the in-memory task queue AND the sessionStorage-persisted
 * job tracker so that "isEvaluating" survives page refresh.
 */
export function useListingOperations(
  listing: Listing | null,
  additionalStates?: {
    isFetching?: boolean;
    isAddingTranscript?: boolean;
  }
) {
  const tasks = useTaskQueueStore((state) => state.tasks);
  const activeJobs = useJobTrackerStore((state) => state.activeJobs);

  const operationStates = useMemo(() => {
    if (!listing) {
      return {
        isEvaluating: false,
        isRunningStructuredOutput: false,
        isRunningEvaluator: false,
        hasActiveTask: false,
        activeTasks: [],
      };
    }

    // Find active tasks for this listing (in-memory — lost on refresh)
    const listingTasks = tasks.filter(
      (task) =>
        task.listingId === listing.id &&
        (task.status === 'pending' || task.status === 'processing')
    );

    const isEvaluatingFromTasks = listingTasks.some((task) => task.type === 'ai_eval');
    const isRunningStructuredOutput = listingTasks.some((task) => task.type === 'structured_output');
    const isRunningEvaluator = listingTasks.some((task) => task.type === 'evaluator');

    // Also check persistent job tracker (survives refresh via sessionStorage)
    const isEvaluatingFromTracker = activeJobs.some(
      (job) => job.listingId === listing.id && job.jobType === 'evaluate-voice-rx',
    );

    const isEvaluating = isEvaluatingFromTasks || isEvaluatingFromTracker;
    const hasActiveTask = listingTasks.length > 0 || isEvaluatingFromTracker;

    return {
      isEvaluating,
      isRunningStructuredOutput,
      isRunningEvaluator,
      hasActiveTask,
      activeTasks: listingTasks,
    };
  }, [listing, tasks, activeJobs]);

  // Combine all operation states
  const isAnyOperationInProgress = useMemo(() => {
    return (
      operationStates.hasActiveTask ||
      additionalStates?.isFetching ||
      additionalStates?.isAddingTranscript ||
      false
    );
  }, [
    operationStates.hasActiveTask,
    additionalStates?.isFetching,
    additionalStates?.isAddingTranscript,
  ]);

  return {
    ...operationStates,
    isAnyOperationInProgress,
    // Individual flags for specific UI feedback
    isFetching: additionalStates?.isFetching || false,
    isAddingTranscript: additionalStates?.isAddingTranscript || false,
  };
}
