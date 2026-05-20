import { Mail } from 'lucide-react';
import type { ColumnDef } from '@/components/ui/DataTable';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { emailSettingsCopy } from '../emailSettings.copy';
import type { RecentSendRow } from '../types';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  sent: 'success',
  failed: 'error',
  bounced: 'warning',
  not_configured: 'neutral',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface Props {
  rows: RecentSendRow[];
  loading: boolean;
}

export function RecentSendsTable({ rows, loading }: Props) {
  const columns: ColumnDef<RecentSendRow>[] = [
    {
      key: 'sentAt',
      header: emailSettingsCopy.columns.sentAt,
      width: '200px',
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]">{formatTime(row.sentAt)}</span>
      ),
      textBehavior: 'nowrap',
    },
    {
      key: 'subject',
      header: emailSettingsCopy.columns.subject,
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]" title={row.subject}>
          {row.subject}
        </span>
      ),
      textBehavior: 'truncate',
    },
    {
      key: 'status',
      header: emailSettingsCopy.columns.status,
      width: '160px',
      render: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>
          {emailSettingsCopy.status[row.status] ?? row.status}
        </Badge>
      ),
      textBehavior: 'nowrap',
    },
  ];

  return (
    <DataTable<RecentSendRow>
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      loading={loading}
      emptyIcon={Mail}
      emptyTitle={emailSettingsCopy.noActivity}
      minWidth="640px"
    />
  );
}
