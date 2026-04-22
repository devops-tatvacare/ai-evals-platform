import { useCallback, useEffect, useMemo, useState } from 'react';
import cronstrue from 'cronstrue';
import { CalendarClock, Play, Pencil, Trash2, Plus } from 'lucide-react';
import { Button, EmptyState, ConfirmDialog, DataTable, type ColumnDef, PageShell, Tooltip } from '@/components/ui';
import { useScheduledJobsStore } from '@/stores/scheduledJobsStore';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils';
import { ScheduleOverlay } from '../components/ScheduleOverlay';
import type { Schedule } from '../types';

function cronHumanPreview(expression: string): string {
  try {
    return cronstrue.toString(expression, { use24HourTimeFormat: true });
  } catch {
    return 'Invalid cron';
  }
}

function relative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (Math.abs(diffMs) < 60_000) return 'now';
  if (absMinutes < 60) return diffMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return diffMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

export function ScheduledJobsListPage() {
  const schedules = useScheduledJobsStore((state) => state.schedules);
  const isLoading = useScheduledJobsStore((state) => state.isLoading);
  const error = useScheduledJobsStore((state) => state.error);
  const registry = useScheduledJobsStore((state) => state.registry);
  const load = useScheduledJobsStore((state) => state.load);
  const loadRegistry = useScheduledJobsStore((state) => state.loadRegistry);
  const remove = useScheduledJobsStore((state) => state.remove);
  const toggle = useScheduledJobsStore((state) => state.toggle);
  const fireNow = useScheduledJobsStore((state) => state.fireNow);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void loadRegistry();
  }, [load, loadRegistry]);

  const deleteTarget = useMemo(
    () => schedules.find((s) => s.id === deletingId) ?? null,
    [schedules, deletingId],
  );
  const workloadLabels = useMemo(
    () =>
      new Map(
        (registry?.workloads ?? []).map((workload) => [
          `${workload.appId}:${workload.jobType}`,
          workload.label,
        ]),
      ),
    [registry?.workloads],
  );

  const handleToggle = useCallback(async (schedule: Schedule) => {
    try {
      await toggle(schedule.id);
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to toggle schedule');
    }
  }, [toggle]);

  const handleFireNow = useCallback(async (schedule: Schedule) => {
    try {
      await fireNow(schedule.id);
      notificationService.success(`Fired "${schedule.name}" now.`);
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to fire schedule');
    }
  }, [fireNow]);

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await remove(deletingId);
      notificationService.success('Schedule deleted.');
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to delete schedule');
    } finally {
      setDeletingId(null);
    }
  };

  const headerActions = (
    <Button onClick={() => { setEditing(null); setOverlayOpen(true); }} className="gap-1.5">
      <Plus className="h-4 w-4" />
      Create Schedule
    </Button>
  );

  const columns = useMemo((): ColumnDef<Schedule>[] => [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[220px]',
      render: (schedule) => (
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">{schedule.name}</div>
          <div className="text-[11px] text-[var(--text-muted)]">{schedule.scheduleKey}</div>
        </div>
      ),
    },
    {
      key: 'app-workload',
      header: 'App / Workload',
      width: 'min-w-[220px]',
      render: (schedule) => (
        <div>
          <div className="text-[13px] text-[var(--text-primary)]">{schedule.appId}</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {workloadLabels.get(`${schedule.appId}:${schedule.jobType}`) ?? schedule.jobType}
          </div>
        </div>
      ),
    },
    {
      key: 'cron',
      header: 'Cron',
      width: 'min-w-[220px]',
      render: (schedule) => (
        <div>
          <div className="font-mono text-[var(--text-primary)]">{schedule.cron}</div>
          <div className="text-[11px] text-[var(--text-muted)]" title={cronHumanPreview(schedule.cron)}>
            {cronHumanPreview(schedule.cron)}
          </div>
        </div>
      ),
    },
    {
      key: 'next-check',
      header: 'Next check',
      width: 'w-[120px]',
      render: (schedule) => (
        <span className="tabular-nums text-[var(--text-secondary)]">{relative(schedule.nextCheckAt)}</span>
      ),
    },
    {
      key: 'last-fire',
      header: 'Last fire',
      width: 'min-w-[140px]',
      render: (schedule) => (
        <div>
          <div className="tabular-nums text-[var(--text-secondary)]">{relative(schedule.lastFireAt)}</div>
          {schedule.lastFireJobId ? (
            <div className="text-[11px] text-[var(--text-muted)]">{schedule.lastFireJobId.slice(0, 8)}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'min-w-[180px]',
      render: (schedule) => (
        <div>
          <button
            onClick={() => void handleToggle(schedule)}
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              schedule.enabled
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
            )}
            title={schedule.enabled ? 'Disable' : 'Enable'}
          >
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </button>
          {schedule.lastSkipReason ? (
            <Tooltip
              position="top"
              maxWidth={320}
              content={
                <div className="space-y-1 text-xs leading-snug">
                  <div>
                    <span className="font-medium">Last skip: </span>
                    {schedule.lastSkipReason}
                  </div>
                  <div className="text-[var(--text-muted)]">
                    Next check {relative(schedule.nextCheckAt)}
                  </div>
                </div>
              }
            >
              <div className="mt-1 inline-flex max-w-[180px] cursor-default truncate text-[11px] text-[var(--color-warning)]">
                Skipped: {schedule.lastSkipReason}
              </div>
            </Tooltip>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[140px]',
      cellClassName: 'text-right',
      render: (schedule) => (
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => { setEditing(schedule); setOverlayOpen(true); }}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void handleFireNow(schedule)}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
            title="Fire now"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setDeletingId(schedule.id)}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--color-danger)]"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [handleFireNow, handleToggle, workloadLabels]);

  return (
    <PageShell
      title="Scheduled Jobs"
      subtitle="Tenant-scoped cron schedules that enqueue platform jobs."
      headerActions={headerActions}
    >
      {isLoading ? (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">Loading schedules…</div>
      ) : error ? (
        <div className="py-16">
          <EmptyState
            icon={CalendarClock}
            title="Failed to load schedules"
            description={error}
            action={{ label: 'Retry', onClick: load }}
          />
        </div>
      ) : schedules.length === 0 ? (
        <div className="py-16">
          <EmptyState
            icon={CalendarClock}
            title="No schedules yet"
            description="Create your first scheduled job to enqueue workloads on a cron cadence."
            action={{ label: '+ Create Schedule', onClick: () => { setEditing(null); setOverlayOpen(true); } }}
          />
        </div>
      ) : (
        <DataTable
          data={schedules}
          columns={columns}
          keyExtractor={(schedule) => schedule.id}
          emptyIcon={CalendarClock}
          emptyTitle="No schedules yet"
          emptyDescription="Create your first scheduled job to enqueue workloads on a cron cadence."
          minWidth="940px"
        />
      )}

      {overlayOpen ? (
        <ScheduleOverlay
          schedule={editing}
          onClose={() => setOverlayOpen(false)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          isOpen={true}
          title="Delete schedule"
          description={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setDeletingId(null)}
        />
      ) : null}
    </PageShell>
  );
}
