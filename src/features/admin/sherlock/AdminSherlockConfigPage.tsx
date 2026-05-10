import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Inbox,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';

import {
  Badge,
  Button,
  Combobox,
  PageSurface,
  Tabs,
  useTabsHeaderActions,
} from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { usePageMetadata } from '@/config/pageMetadata';
import { notificationService } from '@/services/notifications';
import type {
  VerifiedQueryCreateInput,
  VerifiedQueryRow,
  VerifiedQueryUpdateInput,
} from '@/services/api/sherlockAdmin';

import {
  useCreateVerifiedQuery,
  useDeleteVerifiedQuery,
  useInstructions,
  usePutInstructions,
  useUpdateVerifiedQuery,
  useVerifiedQueries,
} from './queries';
import { VerifiedQueryEditor } from './VerifiedQueryEditor';

const APP_OPTIONS = [
  { value: '', label: 'All apps' },
  { value: 'voice-rx', label: 'voice-rx' },
  { value: 'inside-sales', label: 'inside-sales' },
  { value: 'kaira-bot', label: 'kaira-bot' },
];

export function AdminSherlockConfigPage() {
  const { icon, title } = usePageMetadata('sherlock');
  return (
    <PageSurface
      icon={icon}
      title={`${title} · Config`}
      subtitle="Tenant-scoped verified queries + residual instructions for the data_specialist"
    >
      <Tabs
        defaultTab="verified-queries"
        fillHeight
        tabs={[
          {
            id: 'verified-queries',
            label: 'Verified Queries',
            content: <VerifiedQueriesTab />,
          },
          {
            id: 'instructions',
            label: 'Instructions',
            content: <InstructionsTab />,
          },
        ]}
      />
    </PageSurface>
  );
}

// ───────────────────────── Verified Queries ─────────────────────────

function VerifiedQueriesTab() {
  const [appFilter, setAppFilter] = useState<string>('voice-rx');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VerifiedQueryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VerifiedQueryRow | null>(null);

  const { data, isLoading, error } = useVerifiedQueries({
    appId: appFilter || undefined,
  });
  const createMut = useCreateVerifiedQuery();
  const updateMut = useUpdateVerifiedQuery();
  const deleteMut = useDeleteVerifiedQuery();

  const rows = data?.items ?? [];

  // Push the filter + add button into the tab strip's right-side slot so the
  // page reads as one header bar instead of two stacked toolbars.
  useTabsHeaderActions(
    'verified-queries',
    <div className="flex items-center gap-2">
      <div className="w-[180px]">
        <Combobox
          options={APP_OPTIONS}
          value={appFilter}
          onChange={setAppFilter}
          size="sm"
        />
      </div>
      <Button
        variant="primary"
        size="sm"
        icon={Plus}
        onClick={() => {
          setEditTarget(null);
          setEditorOpen(true);
        }}
      >
        Add verified query
      </Button>
    </div>,
  );

  const columns = useMemo<ColumnDef<VerifiedQueryRow>[]>(() => [
    {
      key: 'scope',
      header: 'Scope',
      width: '110px',
      render: (row) =>
        row.isSystem ? (
          <Badge variant="neutral">
            <Lock className="mr-1 inline h-3 w-3" /> System
          </Badge>
        ) : (
          <Badge variant="info">Tenant</Badge>
        ),
    },
    { key: 'app', header: 'App', width: '130px', render: (row) => row.appId },
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <span className="font-medium text-[var(--text-primary)]">{row.question}</span>
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      width: '110px',
      render: (row) =>
        row.enabled ? (
          <Badge variant="success">on</Badge>
        ) : (
          <Badge variant="neutral">off</Badge>
        ),
    },
    {
      key: 'usage',
      header: 'Used',
      width: '80px',
      render: (row) => (
        <span className="font-mono text-[12px] text-[var(--text-secondary)]">
          {row.useCount}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      cellClassName: 'text-right',
      render: (row) => (
        <div
          className="inline-grid w-[100px] grid-cols-3 gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="secondary"
            size="sm"
            icon={Pencil}
            iconOnly
            title={row.isSystem ? 'System rows are managed via deploy' : 'Edit'}
            disabled={row.isSystem}
            onClick={() => {
              setEditTarget(row);
              setEditorOpen(true);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={row.enabled ? PowerOff : Power}
            iconOnly
            title={row.enabled ? 'Disable' : 'Enable'}
            disabled={row.isSystem || updateMut.isPending}
            onClick={() => {
              updateMut.mutate(
                { id: row.id, input: { enabled: !row.enabled } },
                {
                  onSuccess: () =>
                    notificationService.success(
                      row.enabled ? 'Disabled' : 'Enabled',
                    ),
                  onError: (err) =>
                    notificationService.error(
                      err instanceof Error ? err.message : 'Toggle failed',
                    ),
                },
              );
            }}
          />
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            iconOnly
            title={row.isSystem ? 'System rows cannot be deleted' : 'Delete'}
            disabled={row.isSystem}
            onClick={() => setDeleteTarget(row)}
          />
        </div>
      ),
    },
  ], [updateMut]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-5">
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--border-error)] bg-[var(--surface-error)] p-3 text-[13px] text-[var(--color-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {error instanceof Error ? error.message : 'Failed to load verified queries'}
          </span>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading verified queries…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No verified queries"
          description="Seeded system rows + your tenant rows show here. Add one to teach Sherlock a new pattern for this app."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.id}
        />
      )}

      <VerifiedQueryEditor
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditTarget(null);
        }}
        target={editTarget}
        defaultAppId={appFilter || 'voice-rx'}
        onSubmitCreate={(input: VerifiedQueryCreateInput) =>
          createMut.mutateAsync(input).then(() => {
            notificationService.success('Verified query created');
            setEditorOpen(false);
            setEditTarget(null);
          }).catch((err: unknown) => {
            notificationService.error(
              err instanceof Error ? err.message : 'Create failed',
            );
            throw err;
          })
        }
        onSubmitUpdate={(id: string, input: VerifiedQueryUpdateInput) =>
          updateMut.mutateAsync({ id, input }).then(() => {
            notificationService.success('Verified query updated');
            setEditorOpen(false);
            setEditTarget(null);
          }).catch((err: unknown) => {
            notificationService.error(
              err instanceof Error ? err.message : 'Update failed',
            );
            throw err;
          })
        }
        submitting={createMut.isPending || updateMut.isPending}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete verified query?"
        description={
          deleteTarget
            ? `"${deleteTarget.question}" — this only deletes the tenant-owned row. Cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMut.mutate(deleteTarget.id, {
            onSuccess: () => {
              notificationService.success('Deleted');
              setDeleteTarget(null);
            },
            onError: (err) => {
              notificationService.error(
                err instanceof Error ? err.message : 'Delete failed',
              );
            },
          });
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─────────────────────────── Instructions ───────────────────────────

function InstructionsTab() {
  const { data, isLoading, error } = useInstructions();
  const putMut = usePutInstructions();
  const [draft, setDraft] = useState<string | null>(null);
  const [previewApp, setPreviewApp] = useState<string>('voice-rx');

  const tenantOverride = data?.tenantOverride ?? '';
  const effectiveDraft = draft ?? tenantOverride;
  const dirty = effectiveDraft !== tenantOverride;

  // Header actions: Discard (when dirty) + Save. Match the verified-queries
  // tab so the toolbar lives in the tab strip, not in a second row.
  useTabsHeaderActions(
    'instructions',
    <div className="flex items-center gap-2">
      {dirty ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(null)}
          disabled={putMut.isPending}
        >
          Discard
        </Button>
      ) : null}
      <Button
        variant="primary"
        size="sm"
        onClick={() =>
          putMut.mutateAsync(effectiveDraft || null).then(() => {
            setDraft(null);
            notificationService.success('Tenant override saved');
          }).catch((err: unknown) =>
            notificationService.error(
              err instanceof Error ? err.message : 'Save failed',
            ),
          )
        }
        disabled={!dirty || putMut.isPending}
        isLoading={putMut.isPending}
      >
        Save
      </Button>
    </div>,
  );

  if (isLoading) return <LoadingState message="Loading instructions…" />;
  if (error) {
    return (
      <div className="m-5 flex items-start gap-2 rounded-md border border-[var(--border-error)] bg-[var(--surface-error)] p-3 text-[13px] text-[var(--color-error)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{error instanceof Error ? error.message : 'Failed to load instructions'}</span>
      </div>
    );
  }

  const appDefaults = data?.appDefaults ?? {};
  const appDefault = appDefaults[previewApp] ?? '(none)';
  const appOptions = Object.keys(appDefaults).map((id) => ({ value: id, label: id }));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 p-5 md:grid-cols-2">
      <section className="flex min-h-0 flex-col gap-2">
        <header className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
            Tenant override
          </h2>
          <span className="text-[11px] text-[var(--text-muted)]">
            {dirty ? 'unsaved changes' : 'saved'}
          </span>
        </header>
        <p className="text-[12px] text-[var(--text-muted)]">
          Markdown rules. Concatenated AFTER the app default each turn — your
          rules win on conflict. Empty = clear the override.
        </p>
        <textarea
          value={effectiveDraft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[420px] flex-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text-primary)] focus:border-[var(--interactive-primary)] focus:outline-none"
          placeholder={'# Tenant overrides\n\n- Always cap LIMIT at 50 rows for this tenant.\n- Render dates in dd-MMM-yyyy.'}
        />
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <header className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
            App default
          </h2>
          <div className="w-[160px]">
            <Combobox
              options={appOptions}
              value={previewApp}
              onChange={setPreviewApp}
              size="sm"
            />
          </div>
        </header>
        <p className="text-[12px] text-[var(--text-muted)]">
          Engineering-managed. <code className="rounded bg-[var(--bg-secondary)] px-1 py-0.5 text-[11px]">sherlock_v3/instructions/{previewApp}.md</code>
        </p>
        <pre className="min-h-[420px] flex-1 w-full overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          {appDefault}
        </pre>
      </section>
    </div>
  );
}
