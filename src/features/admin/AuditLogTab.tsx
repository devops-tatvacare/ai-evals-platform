import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Spinner, EmptyState, Pagination } from '@/components/ui';
import { rolesApi } from '@/services/api/rolesApi';
import type { AuditLogEntry } from '@/services/api/rolesApi';
import { notificationService } from '@/services/notifications';

const PAGE_SIZE = 50;

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

function DetailsCell({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.beforeState !== null || entry.afterState !== null;

  if (!hasDetails) return <span className="text-[var(--text-muted)]">—</span>;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[12px] text-[var(--text-brand)] hover:underline"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? 'Hide' : 'Show'}
      </button>
      {expanded && (
        <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-[var(--bg-secondary)] p-2 text-[11px] text-[var(--text-secondary)]">
          {JSON.stringify({ before: entry.beforeState, after: entry.afterState }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [pendingFilter, setPendingFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadLog = useCallback(async (p: number, filter: string) => {
    setIsLoading(true);
    try {
      const data = await rolesApi.getAuditLog(p, PAGE_SIZE, filter || undefined);
      setEntries(data.items);
      setTotal(data.total);
    } catch {
      notificationService.error('Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLog(page, actionFilter);
  }, [loadLog, page, actionFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActionFilter(pendingFilter.trim());
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Filter bar */}
      <form onSubmit={handleSearch} className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={pendingFilter}
            onChange={(e) => setPendingFilter(e.target.value)}
            placeholder="Filter by action (e.g. role.create)..."
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)] transition-colors"
          />
        </div>
        <Button type="submit" size="md" variant="secondary">
          Search
        </Button>
        {actionFilter && (
          <Button
            type="button"
            size="md"
            variant="ghost"
            onClick={() => {
              setPendingFilter('');
              setPage(1);
              setActionFilter('');
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No audit log entries"
          description={actionFilter ? `No entries matching "${actionFilter}"` : 'Activity will appear here as actions are performed'}
          compact
          className="mt-4"
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Time</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Actor</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Action</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Entity</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {entries.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-[var(--bg-secondary)]/50">
                    <td className="px-4 py-2.5 text-[12px] text-[var(--text-muted)] whitespace-nowrap" title={entry.createdAt}>
                      {formatTime(entry.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                      {entry.actorEmail ?? entry.actorId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[12px] font-mono text-[var(--text-primary)]">
                        {entry.action}
                      </code>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                      <span className="capitalize">{entry.entityType}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DetailsCell entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} showCount totalItems={total} pageSize={PAGE_SIZE} />
        </>
      )}
    </div>
  );
}
