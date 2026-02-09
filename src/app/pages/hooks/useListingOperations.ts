import { useMemo } from 'react';
import { useTaskQueueStore } from '@/stores';
import type { Listing } from '@/types';

/**
 * Hook to track all active operations for a listing
 * Returns operation states and a unified flag for disabling UI during operations
 */
export function useListingOperations(
  listing: Listing | null,
  additionalStates?: {
    isFetching?: boolean;
    isAddingTranscript?: boolean;
  }
) {
  const tasks = useTaskQueueStore((state) => state.tasks);

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

    // Find active tasks for this listing
    const listingTasks = tasks.filter(
      (task) =>
        task.listingId === listing.id &&
        (task.status === 'pending' || task.status === 'processing')
    );

    const isEvaluating = listingTasks.some((task) => task.type === 'ai_eval');
    const isRunningStructuredOutput = listingTasks.some((task) => task.type === 'structured_output');
    const isRunningEvaluator = listingTasks.some((task) => task.type === 'evaluator');
    const hasActiveTask = listingTasks.length > 0;

    return {
      isEvaluating,
      isRunningStructuredOutput,
      isRunningEvaluator,
      hasActiveTask,
      activeTasks: listingTasks,
    };
  }, [listing, tasks]);

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
