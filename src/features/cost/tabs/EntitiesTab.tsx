import { useEffect } from 'react';
import { Database } from 'lucide-react';
import { DataTable, type ColumnDef } from '@/components/ui';
import { useCostStore } from '@/stores/costStore';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { formatDateTime, formatInt, formatTokensCompact, formatUsd, truncateId } from '../utils/format';
import type { EntityRow, OwnerType } from '../types';

interface TabProps {
  active: boolean;
}

const PAGE_SIZE = 25;

export function EntitiesTab({ active }: TabProps) {
  const slice = useCostStore((s) => s.entities);
  const loadEntities = useCostStore((s) => s.loadEntities);
  const refresh = useCostStore((s) => s.refreshActive);
  const filtersKey = useCostStore((s) => s.filtersKey);

  useEffect(() => {
    if (active) void loadEntities();
  }, [active, loadEntities, filtersKey]);

  return (
    <div className="flex h-full min-h-0 flex-col pb-6">
      <SliceStateBoundary
        slice={slice}
        onRetry={() => refresh('entities')}
        emptyIcon={Database}
        emptyTitle="No entities"
        emptyDescription="No LLM usage rows match the current filters."
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <EntitiesTable
            rows={data.items}
            page={data.page}
            total={data.total}
            pageSize={data.pageSize || PAGE_SIZE}
            onPageChange={(p) => loadEntities(p)}
          />
        )}
      </SliceStateBoundary>
    </div>
  );
}

function EntitiesTable({
  rows,
  page,
  total,
  pageSize,
  onPageChange,
}: {
  rows: EntityRow[];
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const columns: ColumnDef<EntityRow>[] = [
    {
      key: 'owner',
      header: 'Owner',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{row.ownerType}</span>
          <span className="text-[11px] text-[var(--text-muted)]">{truncateId(row.ownerId)}</span>
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'Spend',
      width: 'w-32',
      cellClassName: 'text-right tabular-nums',
      headerClassName: 'text-right',
      render: (row) => formatUsd(row.costUsd),
    },
    {
      key: 'tokens',
      header: 'Tokens',
      width: 'w-24',
      cellClassName: 'text-right tabular-nums text-[var(--text-secondary)]',
      headerClassName: 'text-right',
      render: (row) => formatTokensCompact(row.totalTokens),
    },
    {
      key: 'calls',
      header: 'Calls',
      width: 'w-20',
      cellClassName: 'text-right tabular-nums text-[var(--text-secondary)]',
      headerClassName: 'text-right',
      render: (row) => formatInt(row.callCount),
    },
    {
      key: 'first_at',
      header: 'First call',
      width: 'w-32',
      cellClassName: 'text-[var(--text-secondary)]',
      render: (row) => formatDateTime(row.firstAt),
    },
    {
      key: 'last_at',
      header: 'Last call',
      width: 'w-32',
      cellClassName: 'text-[var(--text-secondary)]',
      render: (row) => formatDateTime(row.lastAt),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <DataTable
      columns={columns}
      data={rows}
      keyExtractor={(row) => `${row.ownerType}:${row.ownerId ?? 'null'}`}
      emptyIcon={Database}
      emptyTitle="No entities"
      emptyDescription="No LLM usage rows match the current filters."
      renderExpandedRow={(row) =>
        row.ownerId ? <EntityDrillDown ownerType={row.ownerType} ownerId={row.ownerId} /> : null
      }
      pagination={{
        page,
        totalPages,
        onPageChange,
        pageSize,
        totalItems: total,
        showCount: true,
      }}
    />
  );
}

function EntityDrillDown({ ownerType, ownerId }: { ownerType: OwnerType; ownerId: string }) {
  const loadEntity = useCostStore((s) => s.loadEntity);
  const filtersKey = useCostStore((s) => s.filtersKey);
  // Pulling directly from the store selector is both the cache read and the
  // reactive update path — the store patches `entityCache` once the fetch
  // resolves, and the selector re-runs.
  const detail = useCostStore(
    (s) => s.entityCache[`${filtersKey}:${ownerType}:${ownerId}`],
  );

  useEffect(() => {
    if (detail) return;
    void loadEntity(ownerType, ownerId);
  }, [loadEntity, ownerType, ownerId, detail]);

  if (!detail) {
    return <div className="text-xs text-[var(--text-muted)]">Loading drill-down…</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DetailList title="By purpose" rows={detail.byPurpose} />
      <DetailList title="By model" rows={detail.byModel} />
    </div>
  );
}

function DetailList({ title, rows }: { title: string; rows: { key: string; costUsd: number }[] }) {
  if (!rows.length) {
    return (
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</h4>
        <p className="text-xs text-[var(--text-muted)]">No data</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</h4>
      <ul className="space-y-1 text-[13px]">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between">
            <span className="truncate text-[var(--text-secondary)]">{r.key}</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">{formatUsd(r.costUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
