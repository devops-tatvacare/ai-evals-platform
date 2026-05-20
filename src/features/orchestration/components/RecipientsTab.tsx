import { useCallback, useEffect, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { listRunRecipients } from '@/services/api/orchestration';
import {
  getRecipientLastOutcome,
  isRecipientAwaitingProviderOutcome,
  isRunActive,
  type RecipientState,
  type RunStatus,
} from '@/features/orchestration/types';

const PAGE_SIZE = 50;
const ACTIVE_REFRESH_MS = 5000;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

interface OutcomeChip {
  label: string;
  variant: BadgeVariant;
  tooltip: string;
}

const POSITIVE_OUTCOMES = new Set([
  'completed',
  'answered',
  'success',
  'wa_replied',
  'wa_read',
  'bolna_answered',
]);

const NEGATIVE_OUTCOMES = new Set([
  'failed',
  'error',
  'wa_failed',
  'bolna_failed',
]);

const NEUTRAL_OUTCOMES = new Set([
  'no-answer',
  'rnr',
  'busy',
  'cancelled',
  'canceled',
  'stopped',
  'balance-low',
  'bolna_rnr',
]);

function lastOutcomeChip(r: RecipientState): OutcomeChip | null {
  const label = getRecipientLastOutcome(r);
  if (!label) return null;
  const lower = label.toLowerCase();
  let variant: BadgeVariant = 'info';
  if (POSITIVE_OUTCOMES.has(lower)) variant = 'success';
  else if (NEGATIVE_OUTCOMES.has(lower)) variant = 'error';
  else if (NEUTRAL_OUTCOMES.has(lower)) variant = 'warning';
  else if (lower === 'wa_delivered' || lower === 'voice_queued') variant = 'info';
  return { label, variant, tooltip: label };
}

function getLastEventAt(r: RecipientState): string | null {
  const payload = (r.payload ?? {}) as Record<string, unknown>;
  const raw = payload.last_event_at;
  return typeof raw === 'string' && raw ? raw : null;
}

export function RecipientsTab({ runId, runStatus }: { runId: string; runStatus: RunStatus }) {
  const [rows, setRows] = useState<RecipientState[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRunRecipients(runId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [runId, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [runId]);

  useEffect(() => {
    if (!isRunActive(runStatus) && !rows.some(isRecipientAwaitingProviderOutcome)) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, ACTIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh, rows, runStatus]);

  const showWakeupColumn = rows.some((row) => Boolean(row.wakeupAt));

  const columns: ColumnDef<RecipientState>[] = [
    {
      key: 'recipientId',
      header: 'Recipient',
      render: (r) => (
        <span className="font-mono text-xs text-[var(--text-primary)]">{r.recipientId}</span>
      ),
    },
    {
      key: 'currentNodeId',
      header: 'Current Node',
      render: (r) => r.currentNodeId ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="text-[var(--text-primary)]">{r.status}</span>
      ),
    },
    {
      key: '_lastOutcome',
      header: 'Last Outcome',
      render: (r) => {
        const chip = lastOutcomeChip(r);
        if (!chip) return <span className="text-xs text-[var(--text-secondary)]">—</span>;
        return (
          <span title={chip.tooltip}>
            <Badge variant={chip.variant}>{chip.label}</Badge>
          </span>
        );
      },
    },
    {
      key: '_lastEventAt',
      header: 'Last Event At',
      render: (r) => fmtDate(getLastEventAt(r)),
    },
    {
      key: 'enrolledAt',
      header: 'Enrolled',
      render: (r) => fmtDate(r.enrolledAt),
    },
  ];

  if (showWakeupColumn) {
    columns.push({
      key: 'wakeupAt',
      header: 'Wake-up',
      render: (r) => fmtDate(r.wakeupAt),
    });
  }

  // Page size is fixed at 50 here; total page count is unknown from this API
  // (no count returned), so we infer "there might be a next page" when the
  // current page is full. Bumping the page advances; bumping back is allowed.
  const hasMaybeMore = rows.length === PAGE_SIZE;
  const totalPages = hasMaybeMore ? page + 1 : page;

  return (
    <div className="p-3">
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.recipientId}
        loading={loading}
        emptyTitle="No recipients yet"
        emptyDescription="Recipients appear once the source node materialises the cohort."
        pagination={{
          page,
          totalPages,
          onPageChange: setPage,
          pageSize: PAGE_SIZE,
        }}
      />
    </div>
  );
}
