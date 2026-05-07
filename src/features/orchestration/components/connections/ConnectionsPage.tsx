import { useCallback, useEffect, useId, useState } from 'react';
import { Archive, Copy, Pencil, PlugZap, RefreshCw, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { PageSurface } from '@/components/ui/PageSurface';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { usePageMetadata } from '@/config/pageMetadata';
import { useCurrentAppId } from '@/hooks';
import { ApiError } from '@/services/api/client';
import {
  archiveConnection,
  listConnections,
  rotateWebhookToken,
  testConnection,
  type Connection,
} from '@/services/api/orchestrationConnections';
import { notificationService } from '@/services/notifications';
import { logger } from '@/services/logger';
import { useAuthStore } from '@/stores/authStore';

import { ConnectionForm } from './ConnectionForm';
import { getConnectionProviderLabel } from './providerOptions';
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

export function ConnectionsPage() {
  const appId = useCurrentAppId();
  const { icon, title } = usePageMetadata('connections');
  const user = useAuthStore((s) => s.user);
  const canManage = canManageOrchestration(user);
  const createTitleId = useId();
  const editTitleId = useId();
  const [rows, setRows] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Connection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listConnections({
        appId: appId,
        includeInactive: true,
        visibility,
      });
      setRows(result);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load connections';
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [appId, visibility]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleTest(connection: Connection) {
    setTestingId(connection.id);
    try {
      const result = await testConnection(connection.id);
      if (result.ok) {
        notificationService.success(
          `Test passed: ${result.detail || connection.provider}`,
        );
      } else {
        notificationService.error(`Test failed: ${result.detail}`);
      }
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Test failed',
      );
    } finally {
      setTestingId(null);
    }
  }

  async function handleRotate(connection: Connection) {
    setRotatingId(connection.id);
    try {
      const result = await rotateWebhookToken(connection.id);
      notificationService.success('Webhook URL rotated. Update the provider dashboard.');
      await refresh();
      // Best-effort: also copy the new URL to clipboard so the operator can
      // paste it into the provider dashboard without a second click.
      if (result.webhookUrl) await copyToClipboard(result.webhookUrl);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to rotate token';
      notificationService.error(msg);
    } finally {
      setRotatingId(null);
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    try {
      await archiveConnection(archiveTarget.id);
      notificationService.success(`Archived "${archiveTarget.name}"`);
      setArchiveTarget(null);
      await refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to archive';
      notificationService.error(msg);
    }
  }

  const columns: ColumnDef<Connection>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--text-primary)]">{c.name}</span>
          <div className="flex items-center gap-1">
            <Badge variant={c.visibility === 'shared' ? 'info' : 'neutral'} size="sm">
              {c.visibility}
            </Badge>
            {!c.active ? (
              <span className="text-[11px] text-[var(--text-secondary)]">Archived</span>
            ) : null}
          </div>
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
      header: '',
      width: '180px',
      render: (c) => {
        const canEdit = canEditOrchestrationAsset(user, c.createdBy);
        return (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            iconOnly
            icon={PlugZap}
            isLoading={testingId === c.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleTest(c);
            }}
            disabled={!canEdit || testingId === c.id}
            aria-label="Test connection"
            title={testingId === c.id ? 'Testing…' : 'Test connection'}
          />
          <Button
            size="sm"
            variant="secondary"
            iconOnly
            icon={Pencil}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(c);
            }}
            disabled={!canEdit}
            aria-label="Edit connection"
            title="Edit"
          />
          {c.webhookUrl ? (
            <Button
              size="sm"
              variant="secondary"
              iconOnly
              icon={RefreshCw}
              isLoading={rotatingId === c.id}
              onClick={(e) => {
                e.stopPropagation();
                void handleRotate(c);
              }}
                disabled={!canEdit || rotatingId === c.id}
              aria-label="Rotate webhook URL"
              title={rotatingId === c.id ? 'Rotating…' : 'Rotate webhook URL'}
            />
          ) : null}
          {c.active ? (
            <Button
              size="sm"
              variant="danger-outline"
              iconOnly
              icon={Archive}
              onClick={(e) => {
                e.stopPropagation();
                setArchiveTarget(c);
              }}
                disabled={!canEdit}
                aria-label="Archive connection"
                title="Archive"
              />
            ) : null}
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
        actions={canManage ? <Button onClick={() => setCreating(true)}>New Connection</Button> : null}
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
          {creating ? (
            <ConnectionForm
              appId={appId}
              onClose={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                void refresh();
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
              appId={appId}
              existing={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void refresh();
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
