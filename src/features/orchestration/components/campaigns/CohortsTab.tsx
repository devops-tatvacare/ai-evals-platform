import { useState } from 'react';
import { ExternalLink, Lock, Share2, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import {
  RowActionsMenu,
  type RowAction,
} from '@/components/ui/RowActionsMenu';
import { Badge } from '@/components/ui/Badge';
import { VisibilityBadge } from '@/components/ui/VisibilityBadge';
import { useCurrentAppId } from '@/hooks';
import {
  useCohorts,
  useDeleteCohort,
  useUpdateCohort,
} from '@/features/orchestration/queries/cohorts';
import { ApiError } from '@/services/api/client';
import type { CohortResponse } from '@/services/api/orchestrationCohorts';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores/authStore';
import { timeAgo } from '@/utils/evalFormatters';

import { CohortDetailPane } from '../cohorts/CohortDetailPane';
import { CreateCohortDialog } from '../cohorts/CreateCohortDialog';
import { canEditOrchestrationAsset } from '@/features/orchestration/utils/access';

interface CohortsTabProps {
  showCreate?: boolean;
  onShowCreateChange?: (next: boolean) => void;
  highlightId?: string | null;
}

function CohortRowActions({
  cohort,
  onOpen,
  onDelete,
}: {
  cohort: CohortResponse;
  onOpen: (id: string) => void;
  onDelete: (cohort: CohortResponse) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const canEdit = canEditOrchestrationAsset(user, cohort.createdBy);
  const updateCohort = useUpdateCohort(cohort.id);
  const [open, setOpen] = useState(false);

  const isShared = cohort.visibility === 'shared';

  const handleVisibility = async () => {
    const next = isShared ? 'private' : 'shared';
    try {
      await updateCohort.mutateAsync({ visibility: next });
      notificationService.success(
        next === 'shared'
          ? `"${cohort.name}" is now shared`
          : `"${cohort.name}" is now private`,
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update visibility';
      notificationService.error(msg);
    }
  };

  const actions: RowAction[] = [
    {
      id: 'open',
      icon: ExternalLink,
      label: 'Open',
      onClick: () => onOpen(cohort.id),
    },
    {
      id: 'visibility',
      icon: isShared ? Lock : Share2,
      label: isShared ? 'Make private' : 'Share with team',
      hidden: !canEdit,
      disabled: updateCohort.isPending,
      onClick: () => {
        void handleVisibility();
      },
    },
    {
      id: 'delete',
      icon: Trash2,
      label: 'Delete',
      danger: true,
      disabled: !canEdit,
      onClick: () => onDelete(cohort),
    },
  ];

  return (
    <div className="flex items-center justify-end">
      <RowActionsMenu
        actions={actions}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

export function CohortsTab({
  showCreate: showCreateProp,
  onShowCreateChange,
  highlightId,
}: CohortsTabProps = {}) {
  const appId = useCurrentAppId();
  const { data: rows = [], isLoading } = useCohorts(appId);
  const deleteCohort = useDeleteCohort();

  const [showCreateLocal, setShowCreateLocal] = useState(false);
  const showCreate = showCreateProp ?? showCreateLocal;
  const setShowCreate = (next: boolean) => {
    if (showCreateProp === undefined) setShowCreateLocal(next);
    onShowCreateChange?.(next);
  };

  const [selectedId, setSelectedId] = useState<string | null>(highlightId ?? null);
  const [deleteTarget, setDeleteTarget] = useState<CohortResponse | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteCohort.mutateAsync(deleteTarget.id);
      notificationService.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete cohort';
      notificationService.error(msg);
    }
  }

  const columns: ColumnDef<CohortResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[240px] max-w-[420px]',
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          <span className="truncate text-[var(--text-primary)]">{c.name}</span>
          {c.description ? (
            <span className="line-clamp-1 text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
              {c.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: 'min-w-[160px]',
      render: (c) => (
        <span className="font-mono text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
          {c.latestVersion?.sourceRef ?? '—'}
        </span>
      ),
    },
    {
      key: 'filters',
      header: 'Filters',
      width: 'w-[80px]',
      render: (c) => (
        <span className="tabular-nums text-[var(--text-secondary)]">
          {c.latestVersion?.filters.length ?? 0}
        </span>
      ),
    },
    {
      key: 'usedBy',
      header: 'Used by',
      width: 'w-[110px]',
      render: (c) => (
        <Badge variant={c.usedByWorkflowCount > 0 ? 'info' : 'neutral'} size="sm">
          {c.usedByWorkflowCount} workflow{c.usedByWorkflowCount === 1 ? '' : 's'}
        </Badge>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: 'w-[120px]',
      render: (c) => <VisibilityBadge visibility={c.visibility} compact />,
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 'min-w-[120px]',
      textBehavior: 'nowrap',
      render: (c) => (
        <span className="text-[var(--text-secondary)]">{timeAgo(c.updatedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[80px]',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (c) => (
        <CohortRowActions
          cohort={c}
          onOpen={setSelectedId}
          onDelete={setDeleteTarget}
        />
      ),
    },
  ];

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable<CohortResponse>
          data={rows}
          columns={columns}
          keyExtractor={(c) => c.id}
          loading={isLoading}
          emptyTitle="No saved cohorts yet"
          emptyDescription="Save a filter you use often so workflows pick up new matching contacts as your data changes."
          onRowClick={(c) => setSelectedId(c.id)}
        />
      </div>

      <CreateCohortDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(cohortId: string) => {
          setShowCreate(false);
          setSelectedId(cohortId);
        }}
      />

      {selectedId ? (
        <CohortDetailPane
          cohortId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() =>
          deleteCohort.isPending ? null : setDeleteTarget(null)
        }
        onConfirm={handleDelete}
        title="Delete cohort"
        description={
          deleteTarget
            ? deleteTarget.usedByWorkflowCount > 0
              ? `"${deleteTarget.name}" is used by ${deleteTarget.usedByWorkflowCount} workflow${deleteTarget.usedByWorkflowCount === 1 ? '' : 's'}. Delete anyway? Those workflows will be blocked from running until rebound.`
              : `Delete "${deleteTarget.name}"? This cannot be undone.`
            : ''
        }
        confirmLabel={deleteCohort.isPending ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deleteCohort.isPending}
      />
    </>
  );
}
