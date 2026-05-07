import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { listRunActions } from '@/services/api/orchestration';
import {
  getActionProviderStatus,
  isActionAwaitingProviderOutcome,
  isActionProviderTerminal,
  isRunActive,
  type ActionRow,
  type RunStatus,
} from '@/features/orchestration/types';
import { ActionDetailPanel } from './ActionDetailPanel';

const PAGE_SIZE = 100;
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
  icon: LucideIcon;
}

function outcomeChip(r: ActionRow): OutcomeChip | null {
  const channel = (r.channel || '').toLowerCase();
  if (channel === 'bolna') {
    const response = (r.response ?? {}) as Record<string, unknown>;
    const providerStatus = getActionProviderStatus(r);
    const terminal = isActionProviderTerminal(r);
    if (!providerStatus) return null;
    const s = providerStatus.toLowerCase();
    let variant: BadgeVariant = 'info';
    if (terminal) {
      if (['completed', 'answered', 'success'].includes(s)) variant = 'success';
      else if (['no-answer', 'rnr', 'busy', 'cancelled', 'canceled', 'stopped'].includes(s)) {
        variant = 'warning';
      } else variant = 'error';
    }
      const reason = stringField(response.hangup_reason);
      return {
        label: providerStatus,
        variant,
        tooltip: reason ? `${providerStatus} · ${reason}` : providerStatus,
        icon:
          variant === 'success'
            ? CheckCircle2
            : variant === 'warning'
              ? AlertTriangle
              : variant === 'error'
                ? XCircle
                : Info,
      };
    }
  if (channel === 'wati') {
    const t = (r.actionType || '').toLowerCase();
    let variant: BadgeVariant = 'info';
    if (t.includes('replied')) variant = 'success';
    else if (t.includes('read')) variant = 'success';
    else if (t.includes('delivered')) variant = 'info';
    else if (t.includes('failed')) variant = 'error';
    return {
      label: r.actionType,
      variant,
      tooltip: r.actionType,
      icon:
        variant === 'success'
          ? CheckCircle2
          : variant === 'error'
            ? XCircle
            : Info,
    };
  }
  if (r.status === 'failed') {
    return {
      label: 'failed',
      variant: 'error',
      tooltip: r.error ?? 'failed',
      icon: XCircle,
    };
  }
  return null;
}

function detail(r: ActionRow): string {
  if (r.error) return r.error.slice(0, 80);
  if (!r.response) return '—';
  try {
    return JSON.stringify(r.response).slice(0, 80);
  } catch {
    return '—';
  }
}

function stringField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number') return String(value);
  return null;
}

export function ActionLogTab({ runId, runStatus }: { runId: string; runStatus: RunStatus }) {
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ActionRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRunActions(runId, { limit: PAGE_SIZE });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isRunActive(runStatus) && !rows.some(isActionAwaitingProviderOutcome)) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, ACTIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh, rows, runStatus]);

  const columns: ColumnDef<ActionRow>[] = [
    {
      key: 'createdAt',
      header: 'Time',
      render: (r) => fmtDate(r.createdAt),
    },
    {
      key: 'recipientId',
      header: 'Recipient',
      render: (r) => (
        <span className="font-mono text-xs text-[var(--text-primary)]">{r.recipientId}</span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      render: (r) => r.channel,
    },
    {
      key: 'actionType',
      header: 'Action',
      render: (r) => r.actionType,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => r.status,
    },
    {
      key: '_outcome',
      header: 'Detail',
      render: (r) => {
        const chip = outcomeChip(r);
        if (!chip) {
          return <span className="text-xs text-[var(--text-secondary)]">{detail(r)}</span>;
        }
        return (
          <span title={chip.tooltip}>
            <Badge variant={chip.variant}>
              <span className="inline-flex items-center gap-1">
                <chip.icon className="h-3 w-3" aria-hidden="true" />
                <span>{chip.label}</span>
              </span>
            </Badge>
          </span>
        );
      },
    },
  ];

  return (
    <div className="p-3">
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyTitle="No actions logged"
        emptyDescription="Actions appear as nodes dispatch them."
        onRowClick={(r) => setSelected(r)}
      />
      <ActionDetailPanel
        action={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
