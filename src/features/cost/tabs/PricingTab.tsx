import { useEffect, useState } from 'react';
import { RefreshCw, Tag, Plus } from 'lucide-react';
import { Badge, Button, DataTable, Tabs, type ColumnDef } from '@/components/ui';
import { useCostStore } from '@/stores/costStore';
import { useIsSuperAdmin } from '@/utils/permissions';
import { notificationService } from '@/services/notifications';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { ProviderTag } from '../components/ProviderTag';
import { formatDateTime, formatInt, formatUsd } from '../utils/format';
import type { PricingRow, RefreshDiff, SnapshotRow } from '../types';
import { PricingEditModal } from '../components/PricingEditModal';
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
  const isSuperAdmin = useIsSuperAdmin();

  const [editing, setEditing] = useState<PricingRow | 'new' | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<RefreshDiff | null>(null);

  useEffect(() => {
    if (active) void loadPricing();
  }, [active, loadPricing]);

  const doRefresh = async () => {
    if (!isSuperAdmin) return;
    setRefreshBusy(true);
    try {
      const diff = await refreshFromModelsDev();
      setLastDiff(diff);
      await loadPricing();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Refresh failed';
      notificationService.error(msg);
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-[var(--text-muted)]">
                Active pricing rows live-override bootstrap seed. Super-admin-only edits.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  disabled={!isSuperAdmin}
                  title={isSuperAdmin ? 'Add a pricing row' : 'Super-admin only'}
                  onClick={() => setEditing('new')}
                >
                  New row
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  disabled={!isSuperAdmin}
                  isLoading={refreshBusy}
                  title={isSuperAdmin ? 'Refresh from models.dev' : 'Super-admin only — Owner of system tenant'}
                  onClick={doRefresh}
                >
                  Refresh from models.dev
                </Button>
                <Button variant="ghost" size="sm" onClick={() => refresh('pricing')}>
                  Reload
                </Button>
              </div>
            </div>

            <Tabs
              tabs={[
                {
                  id: 'rows',
                  label: 'Pricing rows',
                  content: (
                    <PricingRowsTable
                      rows={data.pricing}
                      canEdit={isSuperAdmin}
                      onEdit={(row) => setEditing(row)}
                    />
                  ),
                },
                {
                  id: 'history',
                  label: 'Refresh history',
                  content: <RefreshHistoryTable rows={data.refreshHistory} />,
                },
              ] as { id: SubTab; label: string; content: React.ReactNode }[]}
              defaultTab="rows"
              fillHeight
            />
          </>
        )}
      </SliceStateBoundary>

      {editing && (
        <PricingEditModal
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
      width: 'w-28',
      render: (row) => <ProviderTag value={row.provider} />,
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) => <span className="text-[13px] text-[var(--text-primary)]">{row.model}</span>,
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
      render: (row) => (
        <Badge variant={row.effectiveTo === null ? 'success' : 'neutral'} size="sm">
          {row.effectiveTo === null ? 'active' : 'historical'}
        </Badge>
      ),
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
          notificationService.info('Pricing edits require super-admin (Owner of system tenant).');
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
