import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, Copy, Lock, Pencil, PlugZap, RefreshCw, Share2, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { PageSurface } from '@/components/ui/PageSurface';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { RowActionsMenu, type RowAction } from '@/components/ui/RowActionsMenu';
import { VisibilityBadge } from '@/components/ui/VisibilityBadge';
import { usePageMetadata } from '@/config/pageMetadata';
import { ApiError } from '@/services/api/client';
import { type Connection } from '@/services/api/orchestrationConnections';
import { notificationService } from '@/services/notifications';
import { logger } from '@/services/logger';
import { useAuthStore } from '@/stores/authStore';

import { ConnectionForm } from './ConnectionForm';
import { getConnectionProviderLabel } from './providerOptions';
import {
  useConnections,
  useDeleteConnection,
  useRotateToken,
  useTestConnection,
  useUpdateConnection,
} from './queries';
import {
  canEditOrchestrationAsset,
  canManageOrchestration,
} from '@/features/orchestration/utils/access';

type VisibilityFilter = 'all' | 'private' | 'shared';

const VISIBILITY_FILTERS: Array<{ id: VisibilityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'shared', label: 'Shared' },
];

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    logger.warn('clipboard write failed', { err: String(err) });
    return false;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function ConnectionsPage() {
  // Relocated to the admin sidebar (Phase 12). The app slug is no longer
  // taken from the URL path — tenant scoping comes from the bearer token,
  // and an optional `?app=` query param filters the list (and supplies the
  // app the create form binds new connections to).
  const [searchParams] = useSearchParams();
  const appId = searchParams.get('app') ?? undefined;
  const { icon, title } = usePageMetadata('connections');
  const user = useAuthStore((s) => s.user);
  const canManage = canManageOrchestration(user);
  const createTitleId = useId();
  const editTitleId = useId();
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Connection | null>(null);
  // Single-open per page — opening a row's menu closes any other row's.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const connectionsQuery = useConnections({ appId, includeInactive: true, visibility });
  const testMutation = useTestConnection();
  const rotateMutation = useRotateToken();
  const updateMutation = useUpdateConnection();
  const deleteMutation = useDeleteConnection();

  const rows = connectionsQuery.data ?? [];
  const loading = connectionsQuery.isLoading;

  useEffect(() => {
    if (connectionsQuery.error) {
      notificationService.error(
        errorMessage(connectionsQuery.error, 'Failed to load connections'),
      );
    }
  }, [connectionsQuery.error]);

  function handleTest(connection: Connection) {
    testMutation.mutate(connection.id, {
      onSuccess: (result) => {
        if (result.ok) {
          notificationService.success(
            `Test passed: ${result.detail || connection.provider}`,
          );
        } else {
          notificationService.error(`Test failed: ${result.detail}`);
        }
      },
      onError: (err) => {
        notificationService.error(errorMessage(err, 'Test failed'));
      },
    });
  }

  function handleRotate(connection: Connection) {
    rotateMutation.mutate(connection.id, {
      onSuccess: async (result) => {
        notificationService.success('Webhook URL rotated. Update the provider dashboard.');
        // Best-effort: copy the new URL so the operator can paste it into
        // the provider dashboard without a second click.
        if (result.webhookUrl) await copyToClipboard(result.webhookUrl);
      },
      onError: (err) => {
        notificationService.error(errorMessage(err, 'Failed to rotate token'));
      },
    });
  }

  function handleVisibilityChange(
    connection: Connection,
    nextVisibility: 'private' | 'shared',
  ) {
    if (connection.visibility === nextVisibility) return;
    updateMutation.mutate(
      { id: connection.id, body: { visibility: nextVisibility } },
      {
        onSuccess: () => {
          notificationService.success(
            nextVisibility === 'shared'
              ? `"${connection.name}" is now shared`
              : `"${connection.name}" is now private`,
          );
        },
        onError: (err) => {
          notificationService.error(
            errorMessage(err, 'Failed to update connection visibility'),
          );
        },
      },
    );
  }

  function handleArchive() {
    if (!archiveTarget) return;
    const target = archiveTarget;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        notificationService.success(`Archived "${target.name}"`);
        setArchiveTarget(null);
      },
      onError: (err) => {
        notificationService.error(errorMessage(err, 'Failed to archive'));
      },
    });
  }

  const columns: ColumnDef<Connection>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--text-primary)]">{c.name}</span>
          {!c.active ? (
            <span className="text-[11px] text-[var(--text-secondary)]">Archived</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      render: (c) => (
        <Badge variant="neutral" size="sm">
          {getConnectionProviderLabel(c.provider)}
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
      key: 'active',
      header: 'Status',
      render: (c) =>
        c.active ? (
          <Badge variant="success" size="sm">
            Active
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            Inactive
          </Badge>
        ),
    },
    {
      key: 'lastUsedAt',
      header: 'Last Used',
      render: (c) => (
        <span className="text-[var(--text-secondary)]">
          {fmtDate(c.lastUsedAt)}
        </span>
      ),
    },
    {
      key: 'webhookUrl',
      header: 'Webhook URL',
      textBehavior: 'truncate',
      render: (c) =>
        c.webhookUrl ? (
          <button
            type="button"
            className="inline-flex max-w-[260px] items-center gap-1 truncate font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await copyToClipboard(c.webhookUrl!);
              if (ok) notificationService.success('Webhook URL copied');
            }}
            title="Click to copy"
          >
            <Copy className="h-3 w-3 shrink-0" />
            <span className="truncate">{c.webhookUrl}</span>
          </button>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: '_actions',
      header: 'Actions',
      width: 'w-[80px]',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (c) => {
        const canEdit = canEditOrchestrationAsset(user, c.createdBy);
        const isShared = c.visibility === 'shared';
        const testing = testMutation.isPending && testMutation.variables === c.id;
        const rotating = rotateMutation.isPending && rotateMutation.variables === c.id;
        const updatingVisibility =
          updateMutation.isPending && updateMutation.variables?.id === c.id;
        const actions: RowAction[] = [
          {
            id: 'test',
            icon: PlugZap,
            label: testing ? 'Testing…' : 'Test connection',
            disabled: !canEdit || testing,
            onClick: () => {
              handleTest(c);
            },
          },
          {
            id: 'edit',
            icon: Pencil,
            label: 'Edit',
            disabled: !canEdit,
            onClick: () => setEditing(c),
          },
          {
            id: 'rotate',
            icon: RefreshCw,
            label: rotating ? 'Rotating…' : 'Rotate webhook URL',
            disabled: !canEdit || rotating,
            // Only relevant when the connection exposes an inbound
            // webhook (Bolna / WATI). Hidden otherwise so the menu
            // doesn't bait the operator with an irrelevant action.
            hidden: !c.webhookUrl,
            onClick: () => {
              handleRotate(c);
            },
          },
          {
            // Visibility toggle — same shape as the workflow list so
            // operators learn one action across orchestration assets.
            id: 'visibility',
            icon: isShared ? Lock : Share2,
            label: isShared ? 'Make private' : 'Share with team',
            disabled: updatingVisibility,
            hidden: !canEdit,
            onClick: () => {
              handleVisibilityChange(c, isShared ? 'private' : 'shared');
            },
          },
          {
            id: 'archive',
            icon: Archive,
            label: 'Archive',
            danger: true,
            disabled: !canEdit,
            // Archived connections are read-only — hide the action so
            // we don't surface a no-op or a confusing repeated archive.
            hidden: !c.active,
            onClick: () => setArchiveTarget(c),
          },
        ];
        return (
          <div className="flex items-center justify-end">
            <RowActionsMenu
              actions={actions}
              open={openMenuId === c.id}
              onOpenChange={(open) => setOpenMenuId(open ? c.id : null)}
            />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageSurface
        icon={icon}
        title={title}
        filters={(
          <FilterPills
            options={VISIBILITY_FILTERS}
            active={visibility}
            onChange={(id) => setVisibility(id as VisibilityFilter)}
          />
        )}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)} disabled={!appId}>
              New Connection
            </Button>
          ) : null
        }
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<Connection>
            data={rows}
            columns={columns}
            keyExtractor={(c) => c.id}
            loading={loading}
            emptyTitle="No connections yet"
            emptyDescription="Create a provider connection to wire campaigns to Bolna, WATI, LSQ, or SMS providers."
          />
        </div>
      </PageSurface>

      <RightSlideOverShell
        isOpen={creating}
        onClose={() => setCreating(false)}
        labelledBy={createTitleId}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <h2
            id={createTitleId}
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            New Connection
          </h2>
          <button
            onClick={() => setCreating(false)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {creating && appId ? (
            <ConnectionForm
              appId={appId}
              onClose={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                void connectionsQuery.refetch();
              }}
            />
          ) : null}
        </div>
      </RightSlideOverShell>

      <RightSlideOverShell
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        labelledBy={editTitleId}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <h2
            id={editTitleId}
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            {editing ? `Edit ${editing.name}` : ''}
          </h2>
          <button
            onClick={() => setEditing(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {editing ? (
            <ConnectionForm
              appId={editing.appId}
              existing={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void connectionsQuery.refetch();
              }}
            />
          ) : null}
        </div>
      </RightSlideOverShell>

      <ConfirmDialog
        isOpen={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title="Archive connection"
        description={
          archiveTarget
            ? `Archive "${archiveTarget.name}"? Webhooks for this connection will stop matching incoming requests immediately. Workflows referencing it will fail until rebound.`
            : ''
        }
        confirmLabel="Archive"
        variant="danger"
      />
    </>
  );
}
