import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ScrollText } from 'lucide-react';
import {
  FilterButton,
  FilterPanel,
  type FilterFieldConfig,
} from '@/components/ui';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { rolesApi } from '@/services/api/rolesApi';
import type { AuditLogEntry } from '@/services/api/rolesApi';
import { notificationService } from '@/services/notifications';

const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'action',
    label: 'Action',
    control: 'text',
    placeholder: 'Filter by action (e.g. role.create)',
  },
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [actionFilter, setActionFilter] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // Debounce the pending action input so URL/network traffic isn't spammed
  useEffect(() => {
    const handle = setTimeout(() => {
      setActionFilter(pendingAction.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [pendingAction]);

  const loadLog = useCallback(async (p: number, size: number, filter: string) => {
    setIsLoading(true);
    try {
      const data = await rolesApi.getAuditLog(p, size, filter || undefined);
      setEntries(data.items);
      setTotal(data.total);
    } catch {
      notificationService.error('Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog(page, pageSize, actionFilter);
  }, [loadLog, page, pageSize, actionFilter]);

  const activeFilterCount = actionFilter.length > 0 ? 1 : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo((): ColumnDef<AuditLogEntry>[] => [
    {
      key: 'time',
      header: 'Time',
      width: 'w-[110px]',
      render: (entry) => (
        <span className="text-[12px] text-[var(--text-muted)] whitespace-nowrap" title={entry.createdAt}>
          {formatTime(entry.createdAt)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      width: 'min-w-[180px]',
      render: (entry) => (
        <span className="text-[13px] text-[var(--text-secondary)]">
          {entry.actorEmail ?? entry.actorId.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: 'min-w-[180px]',
      render: (entry) => (
        <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[12px] font-mono text-[var(--text-primary)]">
          {entry.action}
        </code>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      width: 'w-[140px]',
      render: (entry) => (
        <span className="capitalize text-[13px] text-[var(--text-secondary)]">{entry.entityType}</span>
      ),
    },
  ], []);

  const toolbar = (
    <div className="flex items-center gap-2">
      <FilterButton activeCount={activeFilterCount} onClick={() => setFilterPanelOpen(true)} />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" style={{ height: 'calc(100vh - 220px)' }}>
      {toolbar}

      <DataTable
        columns={columns}
        data={entries}
        keyExtractor={(row) => row.id}
        loading={isLoading}
        renderExpandedRow={(entry) => {
          const hasDetails = entry.beforeState !== null || entry.afterState !== null;
          if (!hasDetails) {
            return <span className="text-[12px] text-[var(--text-muted)]">No before/after state captured.</span>;
          }
          return (
            <pre className="max-w-full overflow-x-auto rounded bg-[var(--bg-secondary)] p-2 text-[11px] text-[var(--text-secondary)]">
              {JSON.stringify({ before: entry.beforeState, after: entry.afterState }, null, 2)}
            </pre>
          );
        }}
        pagination={{
          page,
          totalPages,
          pageSize,
          totalItems: total,
          showCount: true,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n);
            setPage(1);
          },
        }}
        emptyIcon={actionFilter ? Search : ScrollText}
        emptyTitle={actionFilter ? 'No matching audit entries' : 'No audit log entries'}
        emptyDescription={
          actionFilter
            ? `No entries matching "${actionFilter}"`
            : 'Activity will appear here as actions are performed.'
        }
      />

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        fields={FILTER_FIELDS}
        values={{ action: pendingAction }}
        onChange={(patch) => {
          if (typeof patch.action === 'string') setPendingAction(patch.action);
        }}
        onClear={() => setPendingAction('')}
      />
    </div>
  );
}
