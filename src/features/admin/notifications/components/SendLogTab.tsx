import { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import type { ColumnDef } from '@/components/ui/DataTable';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FilterButton, FilterPanel, useTabsHeaderActions, type FilterFieldConfig } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { decodeApiError, summarizeApiErrorBody } from '@/features/orchestration/contracts/errorDecoder';
import { emailSettingsCopy } from '@/features/accountSettings/email/emailSettings.copy';
import { adminNotificationsCopy } from '../adminNotifications.copy';
import { adminNotificationsApi, type SendLogListQuery } from '../api';
import { useAdminSendLog } from '../queries';
import type { AdminMailSendRow } from '../types';
import { SendLogPreviewOverlay } from './SendLogPreviewOverlay';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  sent: 'success',
  failed: 'error',
  bounced: 'warning',
  not_configured: 'neutral',
};

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'status',
    label: adminNotificationsCopy.sendLog.filters.status,
    control: 'select',
    placeholder: adminNotificationsCopy.sendLog.filters.allStatuses,
    options: [
      { value: 'sent', label: emailSettingsCopy.status.sent },
      { value: 'failed', label: emailSettingsCopy.status.failed },
      { value: 'bounced', label: emailSettingsCopy.status.bounced },
      { value: 'not_configured', label: emailSettingsCopy.status.not_configured },
    ],
  },
  {
    key: 'callSite',
    label: adminNotificationsCopy.sendLog.filters.event,
    control: 'select',
    placeholder: adminNotificationsCopy.sendLog.filters.allEvents,
    options: [
      { value: 'mail.signup_invite', label: 'Signup invite' },
      ...Object.keys(emailSettingsCopy.events).map((eventType) => ({
        value: `mail.${eventType.replace('.', '_')}`,
        label: emailSettingsCopy.events[eventType] ?? eventType,
      })),
    ],
  },
  {
    key: 'recipient',
    label: adminNotificationsCopy.sendLog.filters.recipient,
    control: 'text',
    placeholder: 'alice@…',
  },
  {
    key: 'date',
    label: `${adminNotificationsCopy.sendLog.filters.fromDate} / ${adminNotificationsCopy.sendLog.filters.toDate}`,
    control: 'date-range',
    fields: ['fromDate', 'toDate'],
  },
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SendLogTab() {
  const [status, setStatus] = useState('');
  const [callSite, setCallSite] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const sharedFilters: SendLogListQuery = {
    status: status || undefined,
    callSite: callSite || undefined,
    recipient: recipient || undefined,
    fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
    toDate: toDate ? new Date(toDate).toISOString() : undefined,
  };
  const query = useAdminSendLog({
    ...sharedFilters,
    page,
    pageSize: PAGE_SIZE,
  });

  const activeCount = [status, callSite, recipient, fromDate, toDate].filter(Boolean).length;

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await adminNotificationsApi.exportSendLogCsv(sharedFilters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mail-send-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      notificationService.error(
        summarizeApiErrorBody(
          decodeApiError(err),
          adminNotificationsCopy.sendLog.exportFailed,
        ),
      );
    } finally {
      setExporting(false);
    }
  };

  useTabsHeaderActions(
    'sendLog',
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={Download}
        isLoading={exporting}
        disabled={exporting}
        onClick={handleExport}
      >
        {adminNotificationsCopy.sendLog.exportCsv}
      </Button>
      <FilterButton activeCount={activeCount} onClick={() => setFilterOpen(true)} iconOnly />
    </div>,
  );

  const handleFilterChange = (patch: Record<string, unknown>) => {
    if ('status' in patch) setStatus(String(patch.status ?? ''));
    if ('callSite' in patch) setCallSite(String(patch.callSite ?? ''));
    if ('recipient' in patch) setRecipient(String(patch.recipient ?? ''));
    if ('fromDate' in patch) setFromDate(String(patch.fromDate ?? ''));
    if ('toDate' in patch) setToDate(String(patch.toDate ?? ''));
    setPage(1);
  };

  const handleClearFilters = () => {
    setStatus('');
    setCallSite('');
    setRecipient('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const columns: ColumnDef<AdminMailSendRow>[] = [
    {
      key: 'sentAt',
      header: adminNotificationsCopy.sendLog.columns.sentAt,
      width: '180px',
      render: (row) => (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {formatTime(row.sentAt)}
        </span>
      ),
      textBehavior: 'nowrap',
    },
    {
      key: 'recipient',
      header: adminNotificationsCopy.sendLog.columns.recipient,
      width: '220px',
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]" title={row.recipient}>
          {row.recipient}
        </span>
      ),
      textBehavior: 'truncate',
    },
    {
      key: 'subject',
      header: adminNotificationsCopy.sendLog.columns.subject,
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]" title={row.subject}>
          {row.subject}
        </span>
      ),
      textBehavior: 'truncate',
    },
    {
      key: 'status',
      header: adminNotificationsCopy.sendLog.columns.status,
      width: '160px',
      render: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>
          {emailSettingsCopy.status[row.status] ?? row.status}
        </Badge>
      ),
      textBehavior: 'nowrap',
    },
  ];

  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {query.isError ? (
        <p className="text-[13px] text-[var(--color-error)]">
          {adminNotificationsCopy.sendLog.loadFailed}
        </p>
      ) : (
        <DataTable<AdminMailSendRow>
          columns={columns}
          data={query.data?.rows ?? []}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => setPreviewId(row.id)}
          loading={query.isLoading}
          emptyIcon={Mail}
          emptyTitle={adminNotificationsCopy.sendLog.empty}
          pagination={{
            page,
            totalPages,
            totalItems: query.data?.total,
            onPageChange: setPage,
            pageSize: PAGE_SIZE,
            showCount: true,
          }}
        />
      )}

      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        fields={FILTER_FIELDS}
        values={{ status, callSite, recipient, fromDate, toDate }}
        onChange={handleFilterChange}
        onClear={handleClearFilters}
      />

      <SendLogPreviewOverlay
        sendLogId={previewId}
        onClose={() => setPreviewId(null)}
      />
    </div>
  );
}
