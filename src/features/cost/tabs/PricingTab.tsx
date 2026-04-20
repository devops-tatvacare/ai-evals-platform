import { useEffect, useState } from 'react';
import { RefreshCw, Tag, Plus } from 'lucide-react';
import { Alert, Badge, Button, DataTable, ProviderTag, Tabs, type ColumnDef } from '@/components/ui';
import { useCostStore } from '@/stores/costStore';
import { ApiError } from '@/services/api/client';
import { usePermission } from '@/utils/permissions';
import { notificationService } from '@/services/notifications';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { formatDateTime, formatInt, formatUsd } from '../utils/format';
import type { PricingRow, RefreshDiff, SnapshotRow } from '../types';
import { PricingEditOverlay } from '../components/PricingEditOverlay';
import { RefreshDiffDialog } from '../components/RefreshDiffDialog';

interface TabProps {
  active: boolean;
}

type SubTab = 'rows' | 'history';

export function PricingTab({ active }: TabProps) {
  const slice = useCostStore((s) => s.pricing);
  const loadPricing = useCostStore((s) => s.loadPricing);
  const refresh = useCostStore((s) => s.refreshActive);
  const refreshFromModelsDev = useCostStore((s) => s.refreshFromModelsDev);
  const canEdit = usePermission('cost:edit');

  const [editing, setEditing] = useState<PricingRow | 'new' | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<RefreshDiff | null>(null);

  useEffect(() => {
    if (active) void loadPricing();
  }, [active, loadPricing]);

  const doRefresh = async () => {
    if (!canEdit) return;
    setRefreshBusy(true);
    try {
      const diff = await refreshFromModelsDev();
      setLastDiff(diff);
      await loadPricing();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        notificationService.warning('Pricing refresh is rate-limited. Please wait before retrying.');
      } else {
        const msg = e instanceof Error ? e.message : 'Refresh failed';
        notificationService.error(msg);
      }
    } finally {
      setRefreshBusy(false);
    }
  };

  // Empty check must ignore the "active pricing" filter on the bundle —
  // when the backend seeds are missing and no refresh has run, both the
  // active pricing and refresh-history arrays are empty.
  const isBundleEmpty = (data: { pricing: PricingRow[]; refreshHistory: SnapshotRow[] }) =>
    data.pricing.length === 0 && data.refreshHistory.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col pb-6">
      <SliceStateBoundary
        slice={slice}
        onRetry={() => refresh('pricing')}
        emptyIcon={Tag}
        emptyTitle="No pricing rows"
        emptyDescription="Seed the DB or refresh from models.dev to populate pricing."
        isEmpty={isBundleEmpty}
      >
        {(data) => (
          <>
            <Alert variant="info" title="Effective-dated pricing" className="mb-3">
              Adding a new rate creates a new row with <code className="font-mono">effective_from</code>{' '}
              and sets <code className="font-mono">effective_to</code> on the prior row. Historical
              rows are never edited — past costs remain reproducible.
            </Alert>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-[var(--text-muted)]">
                Active pricing rows live-override bootstrap seed. Edits require the
                <code className="ml-1 font-mono">cost:edit</code> permission.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  disabled={!canEdit}
                  title={canEdit ? 'Add a pricing row' : 'Requires cost:edit permission'}
                  onClick={() => setEditing('new')}
                >
                  New row
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  disabled={!canEdit}
                  isLoading={refreshBusy}
                  title={canEdit ? 'Refresh from models.dev' : 'Requires cost:edit permission'}
                  onClick={doRefresh}
                >
                  Refresh from models.dev
                </Button>
              </div>
            </div>

            <Tabs
              tabs={[
                {
                  id: 'rows',
                  label: 'Pricing rows',
                  content: (
                    <div className="flex h-full min-h-0 flex-col">
                      <PricingRowsTable
                        rows={data.pricing}
                        canEdit={canEdit}
                        onEdit={(row) => setEditing(row)}
                      />
                    </div>
                  ),
                },
                {
                  id: 'history',
                  label: 'Refresh history',
                  content: (
                    <div className="flex h-full min-h-0 flex-col">
                      <RefreshHistoryTable rows={data.refreshHistory} />
                    </div>
                  ),
                },
              ] as { id: SubTab; label: string; content: React.ReactNode }[]}
              defaultTab="rows"
              fillHeight
            />
          </>
        )}
      </SliceStateBoundary>

      {editing && (
        <PricingEditOverlay
          mode={editing === 'new' ? 'create' : 'patch'}
          pricing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {lastDiff && <RefreshDiffDialog diff={lastDiff} onClose={() => setLastDiff(null)} />}
    </div>
  );
}

function PricingRowsTable({
  rows,
  canEdit,
  onEdit,
}: {
  rows: PricingRow[];
  canEdit: boolean;
  onEdit: (row: PricingRow) => void;
}) {
  const columns: ColumnDef<PricingRow>[] = [
    {
      key: 'provider',
      header: 'Provider',
      width: 'w-32',
      render: (row) => <ProviderTag value={row.provider} />,
    },
    {
      key: 'model',
      header: 'Model',
      width: 'w-80',
      render: (row) => (
        <span className="truncate text-[13px] text-[var(--text-primary)]" title={row.model}>
          {row.model}
        </span>
      ),
    },
    {
      key: 'effective',
      header: 'Effective',
      width: 'w-48',
      cellClassName: 'whitespace-nowrap',
      render: (row) => {
        const from = row.effectiveFrom ? row.effectiveFrom.slice(0, 10) : '—';
        const to = row.effectiveTo ? row.effectiveTo.slice(0, 10) : 'now';
        const isFuture = row.effectiveFrom ? new Date(row.effectiveFrom) > new Date() : false;
        const isExpired = row.effectiveTo !== null;
        const colorClass = isFuture
          ? 'text-[var(--interactive-primary)]'
          : isExpired
            ? 'text-[var(--text-muted)] italic'
            : 'text-[var(--text-secondary)]';
        return (
          <span className={`font-mono text-[11.5px] ${colorClass}`}>
            {from} → {to}
          </span>
        );
      },
    },
    {
      key: 'input',
      header: 'Input $/1M',
      width: 'w-28',
      cellClassName: 'text-right tabular-nums',
      headerClassName: 'text-right',
      render: (row) => formatUsd(row.inputPer1MUsd),
    },
    {
      key: 'output',
      header: 'Output $/1M',
      width: 'w-28',
      cellClassName: 'text-right tabular-nums',
      headerClassName: 'text-right',
      render: (row) => formatUsd(row.outputPer1MUsd),
    },
    {
      key: 'cached',
      header: 'Cached $/1M',
      width: 'w-28',
      cellClassName: 'text-right tabular-nums text-[var(--text-secondary)]',
      headerClassName: 'text-right',
      render: (row) => formatUsd(row.cachedReadPer1MUsd),
    },
    {
      key: 'reasoning',
      header: 'Reasoning $/1M',
      width: 'w-32',
      cellClassName: 'text-right tabular-nums text-[var(--text-secondary)]',
      headerClassName: 'text-right',
      render: (row) => formatUsd(row.reasoningPer1MUsd),
    },
    {
      key: 'source',
      header: 'Source',
      width: 'w-28',
      render: (row) => (
        <Badge variant={row.source === 'manual' ? 'warning' : 'neutral'} size="sm">
          {row.source}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-24',
      render: (row) => {
        const isFuture = row.effectiveFrom ? new Date(row.effectiveFrom) > new Date() : false;
        if (isFuture) return <Badge variant="info" size="sm">scheduled</Badge>;
        if (row.effectiveTo === null) return <Badge variant="success" size="sm">active</Badge>;
        return <Badge variant="neutral" size="sm">historical</Badge>;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      emptyIcon={Tag}
      emptyTitle="No pricing rows"
      emptyDescription="Seed the DB or refresh from models.dev to populate pricing."
      onRowClick={(row) => {
        if (!canEdit) {
          notificationService.info('Pricing edits require the cost:edit permission.');
          return;
        }
        if (row.effectiveTo !== null) {
          notificationService.info('This is a historical row; create a new row to update pricing.');
          return;
        }
        onEdit(row);
      }}
    />
  );
}

function RefreshHistoryTable({ rows }: { rows: SnapshotRow[] }) {
  const columns: ColumnDef<SnapshotRow>[] = [
    {
      key: 'fetched_at',
      header: 'Fetched',
      width: 'w-40',
      render: (row) => formatDateTime(row.fetchedAt),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-24',
      render: (row) => (
        <Badge variant={row.status === 'ok' ? 'success' : 'error'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'diff',
      header: 'Diff',
      render: (row) => (
        <span className="tabular-nums text-[var(--text-secondary)]">
          +{formatInt(row.addedCount)} / ~{formatInt(row.updatedCount)} / -{formatInt(row.removedCount)}{' '}
          <span className="text-[var(--text-muted)]">({formatInt(row.unchangedCount)} unchanged)</span>
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      width: 'w-24',
      cellClassName: 'text-[var(--text-secondary)]',
      render: (row) => (row.durationMs != null ? `${row.durationMs} ms` : '—'),
    },
    {
      key: 'hash',
      header: 'Hash',
      width: 'w-40',
      cellClassName: 'font-mono text-[11px] text-[var(--text-muted)]',
      render: (row) => row.payloadHash.slice(0, 12),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      emptyIcon={RefreshCw}
      emptyTitle="No snapshots"
      emptyDescription="No models.dev refreshes have run yet."
    />
  );
}
