/**
 * JobCompletionWatcher — headless component (renders null).
 *
 * Mounted once at app level inside the router context.
 * Polls tracked jobs from useJobTrackerStore and fires global
 * toasts on completion/failure, suppressing if the user is already
 * viewing the run detail page for that run.
 */
import { useNavigate } from 'react-router-dom';
import { usePoll } from '@/hooks';
import { useJobTrackerStore } from '@/stores';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { isRunDetailPath, runDetailForApp } from '@/config/routes';

export function JobCompletionWatcher() {
  const activeJobs = useJobTrackerStore((s) => s.activeJobs);
  const navigate = useNavigate();

  usePoll({
    fn: async () => {
      const { activeJobs: jobs, resolveRunId, untrackJob } =
        useJobTrackerStore.getState();

      const results = await Promise.allSettled(
        jobs.map((tracked) =>
          jobsApi.get(tracked.jobId).then((job) => ({ tracked, job })),
        ),
      );

      for (const result of results) {
        if (result.status === 'rejected') continue;

        const { tracked, job } = result.value;

        // Resolve run_id if not yet known
        if (!tracked.runId) {
          const runId = (job.progress as Record<string, unknown>)
            ?.run_id as string | undefined;
          if (runId) {
            resolveRunId(tracked.jobId, runId);
          }
        }

        // Check terminal state
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          const runId =
            tracked.runId ??
            ((job.progress as Record<string, unknown>)?.run_id as
              | string
              | undefined);

          const currentPath = window.location.pathname;
          const isOnRunDetail =
            runId != null && isRunDetailPath(currentPath, runId);

          if (!isOnRunDetail) {
            if (job.status === 'completed') {
              notificationService.notify({
                type: 'success',
                message: `${tracked.label} completed`,
                title: 'Job Complete',
                dismissible: true,
                priority: 'normal',
                ...(runId
                  ? {
                      action: {
                        label: 'View Run',
                        onClick: () =>
                          navigate(runDetailForApp(tracked.appId, runId)),
                      },
                    }
                  : {}),
              });
            } else if (job.status === 'failed') {
              notificationService.error(
                `${tracked.label} failed${job.errorMessage ? `: ${job.errorMessage}` : ''}`,
                'Job Failed',
              );
            } else if (job.status === 'cancelled') {
              notificationService.warning(
                `${tracked.label} was cancelled`,
                'Job Cancelled',
              );
            }
          }

          untrackJob(tracked.jobId);
        }
      }

      return true; // always keep polling (enabled controls start/stop)
    },
    enabled: activeJobs.length > 0,
    intervalMs: 5000,
  });

  return null;
}
