import { useMemo, useState } from 'react';
import { Database, Pause, Play } from 'lucide-react';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageSurface,
  type ColumnDef,
} from '@/components/ui';
import { notificationService } from '@/services/notifications';
import {
  useDisableMapping,
  useEnableMapping,
  useMappingState,
} from './queries';
import type { MappingStateRow } from '@/services/api/analyticsAdmin';

/**
 * Phase 3 admin surface for operator-controlled mirror->fact mapping disable.
 *
 * Read-mostly: lists every row in ``analytics.mapping_state`` and toggles
 * ``enabled`` via the dedicated admin endpoints. Disabling requires a
 * reason; the breadcrumb lands in ``analytics.log_fact_population_run``.
 */
export function AnalyticsMappingsPage() {
  const { data, isLoading, error } = useMappingState();
  const disableMutation = useDisableMapping();
  const enableMutation = useEnableMapping();

  const [pendingDisable, setPendingDisable] = useState<MappingStateRow | null>(
    null,
  );
  const [pendingEnable, setPendingEnable] = useState<MappingStateRow | null>(
    null,
  );
  const [reason, setReason] = useState('');

  const columns = useMemo<ColumnDef<MappingStateRow>[]>(
    () => [
      { key: 'appId', header: 'App', render: (row) => row.appId },
      { key: 'sourceTable', header: 'Source table', render: (row) => row.sourceTable },
      { key: 'targetFact', header: 'Target fact', render: (row) => row.targetFact },
      { key: 'activityType', header: 'Activity', render: (row) => row.activityType },
      {
        key: 'state',
        header: 'State',
        render: (row) =>
          row.enabled ? (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              Enabled
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
              Disabled
            </span>
          ),
      },
      { key: 'reason', header: 'Disabled reason', render: (row) => row.disabledReason ?? '—' },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) =>
          row.enabled ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReason('');
                setPendingDisable(row);
              }}
              disabled={disableMutation.isPending}
            >
              <Pause className="mr-1 h-3.5 w-3.5" />
              Disable
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingEnable(row)}
              disabled={enableMutation.isPending}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Re-enable
            </Button>
          ),
      },
    ],
    [disableMutation.isPending, enableMutation.isPending],
  );

  return (
    <PageSurface
      icon={Database}
      title="Analytics mappings"
      subtitle="Operator-controlled disable for mirror→fact projection mappings (Phase 3)."
    >
      {error ? (
        <EmptyState
          icon={Database}
          title="Failed to load mapping state"
          description={(error as Error).message}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data?.mappings ?? []}
          keyExtractor={(row) => row.id}
          loading={isLoading}
          emptyIcon={Database}
          emptyTitle="No mappings registered"
          emptyDescription="Mappings are loaded from YAML at backend boot. Check the migration seed."
        />
      )}

      <ConfirmDialog
        isOpen={pendingDisable !== null}
        onClose={() => setPendingDisable(null)}
        title={
          pendingDisable
            ? `Disable mapping for ${pendingDisable.appId} / ${pendingDisable.activityType}?`
            : 'Disable mapping?'
        }
        description={
          'Steady-state sync will proceed mirror-only. A follow-up backfill ' +
          'is required before declaring the fact table healthy again. ' +
          'Provide a reason (min 3 chars) — it is written to ' +
          'log_fact_population_run for the audit trail.'
        }
        confirmLabel="Disable"
        variant="danger"
        isLoading={disableMutation.isPending}
        extraActions={[
          {
            label: 'Edit reason',
            onClick: () => {
              const next = window.prompt(
                'Reason for disabling (min 3 chars):',
                reason,
              );
              if (next !== null) setReason(next);
            },
            variant: 'secondary',
          },
        ]}
        onConfirm={async () => {
          if (!pendingDisable) return;
          if (reason.trim().length < 3) {
            notificationService.error('Reason must be at least 3 characters.');
            return;
          }
          try {
            await disableMutation.mutateAsync({
              mappingId: pendingDisable.id,
              body: { reason: reason.trim() },
            });
            notificationService.success('Mapping disabled');
            setPendingDisable(null);
          } catch (e) {
            notificationService.error(
              `Failed to disable: ${(e as Error).message}`,
            );
          }
        }}
      />

      <ConfirmDialog
        isOpen={pendingEnable !== null}
        onClose={() => setPendingEnable(null)}
        title={
          pendingEnable
            ? `Re-enable mapping for ${pendingEnable.appId} / ${pendingEnable.activityType}?`
            : 'Re-enable mapping?'
        }
        description={
          'Steady-state fact writes resume on the next sync. Make sure the ' +
          'follow-up backfill has completed before re-enabling.'
        }
        confirmLabel="Re-enable"
        variant="primary"
        isLoading={enableMutation.isPending}
        onConfirm={async () => {
          if (!pendingEnable) return;
          try {
            await enableMutation.mutateAsync({ mappingId: pendingEnable.id });
            notificationService.success('Mapping re-enabled');
            setPendingEnable(null);
          } catch (e) {
            notificationService.error(
              `Failed to re-enable: ${(e as Error).message}`,
            );
          }
        }}
      />
    </PageSurface>
  );
}
