import { useState } from 'react';
import { Trash2, Lock, Users as UsersIcon } from 'lucide-react';
import type { ColumnDef } from '@/components/ui/DataTable';
import { DataTable } from '@/components/ui/DataTable';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterButton, FilterPanel, useTabsHeaderActions, type FilterFieldConfig } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { decodeApiError, summarizeApiErrorBody } from '@/features/orchestration/contracts/errorDecoder';
import { emailSettingsCopy } from '@/features/accountSettings/email/emailSettings.copy';
import { adminNotificationsCopy } from '../adminNotifications.copy';
import {
  useAdminSubscriptions,
  useDeleteSubscription,
  usePatchSubscription,
} from '../queries';
import type { AdminSubscriptionRow } from '../types';

const PAGE_SIZE = 25;

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'eventType',
    label: adminNotificationsCopy.subscribers.filters.event,
    control: 'select',
    placeholder: adminNotificationsCopy.subscribers.filters.allEvents,
    options: Object.keys(emailSettingsCopy.events).map((eventType) => ({
      value: eventType,
      label: emailSettingsCopy.events[eventType] ?? eventType,
    })),
  },
  {
    key: 'active',
    label: adminNotificationsCopy.subscribers.filters.active,
    control: 'select',
    placeholder: adminNotificationsCopy.subscribers.filters.allStatuses,
    options: [
      { value: 'true', label: adminNotificationsCopy.subscribers.filters.activeYes },
      { value: 'false', label: adminNotificationsCopy.subscribers.filters.activeNo },
    ],
  },
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SubscribersTab() {
  const [eventFilter, setEventFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminSubscriptionRow | null>(null);
  const [pendingRequiredFlip, setPendingRequiredFlip] = useState<AdminSubscriptionRow | null>(null);

  const activeCount = [eventFilter, activeFilter].filter(Boolean).length;

  useTabsHeaderActions(
    'subscribers',
    <FilterButton activeCount={activeCount} onClick={() => setFilterOpen(true)} iconOnly />,
  );

  const isActive =
    activeFilter === 'true' ? true : activeFilter === 'false' ? false : undefined;
  const query = useAdminSubscriptions({
    eventType: eventFilter || undefined,
    isActive,
    page,
    pageSize: PAGE_SIZE,
  });
  const patchMutation = usePatchSubscription();
  const deleteMutation = useDeleteSubscription();

  const handleFilterChange = (patch: Record<string, unknown>) => {
    if ('eventType' in patch) setEventFilter(String(patch.eventType ?? ''));
    if ('active' in patch) setActiveFilter(String(patch.active ?? ''));
    setPage(1);
  };

  const handleClearFilters = () => {
    setEventFilter('');
    setActiveFilter('');
    setPage(1);
  };

  const columns: ColumnDef<AdminSubscriptionRow>[] = [
    {
      key: 'user',
      header: adminNotificationsCopy.subscribers.columns.user,
      width: '220px',
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]">
          {row.userEmail ?? row.recipientEmail}
        </span>
      ),
      textBehavior: 'truncate',
    },
    {
      key: 'event',
      header: adminNotificationsCopy.subscribers.columns.event,
      render: (row) => (
        <span className="text-[13px] text-[var(--text-primary)]">
          {emailSettingsCopy.events[row.eventType] ?? row.eventType}
        </span>
      ),
      textBehavior: 'truncate',
    },
    {
      key: 'active',
      header: adminNotificationsCopy.subscribers.columns.active,
      width: '90px',
      render: (row) => (
        <Switch
          size="sm"
          checked={row.isActive}
          disabled={patchMutation.isPending && patchMutation.variables?.id === row.id}
          onCheckedChange={(next) =>
            patchMutation.mutate(
              { id: row.id, isActive: next },
              {
                onSuccess: () =>
                  notificationService.success(adminNotificationsCopy.toast.subscriptionUpdated),
                onError: (err) =>
                  notificationService.error(
                    summarizeApiErrorBody(
                      decodeApiError(err),
                      adminNotificationsCopy.subscribers.updateFailed,
                    ),
                  ),
              },
            )
          }
        />
      ),
    },
    {
      key: 'required',
      header: adminNotificationsCopy.subscribers.columns.required,
      width: '150px',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            checked={row.isRequired}
            disabled={patchMutation.isPending && patchMutation.variables?.id === row.id}
            onCheckedChange={() => setPendingRequiredFlip(row)}
            aria-label={adminNotificationsCopy.subscribers.action.requiredToggle}
          />
          {row.isRequired ? (
            <Badge variant="primary" icon={Lock}>
              {adminNotificationsCopy.subscribers.requiredBadge}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created',
      header: adminNotificationsCopy.subscribers.columns.created,
      width: '170px',
      render: (row) => (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {formatTime(row.createdAt)}
        </span>
      ),
      textBehavior: 'nowrap',
    },
    {
      key: 'actions',
      header: '',
      width: '60px',
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={Trash2}
          aria-label={adminNotificationsCopy.subscribers.action.delete}
          onClick={() => setPendingDelete(row)}
        />
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {query.isError ? (
        <p className="text-[13px] text-[var(--color-error)]">
          {adminNotificationsCopy.subscribers.loadFailed}
        </p>
      ) : (
        <DataTable<AdminSubscriptionRow>
          columns={columns}
          data={query.data?.rows ?? []}
          keyExtractor={(row) => row.id}
          loading={query.isLoading}
          emptyIcon={UsersIcon}
          emptyTitle={adminNotificationsCopy.subscribers.empty}
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
        values={{ eventType: eventFilter, active: activeFilter }}
        onChange={handleFilterChange}
        onClear={handleClearFilters}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={adminNotificationsCopy.subscribers.action.delete}
        description={adminNotificationsCopy.subscribers.confirmDelete}
        confirmLabel={adminNotificationsCopy.subscribers.action.delete}
        cancelLabel={adminNotificationsCopy.subscribers.action.cancel}
        variant="danger"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const row = pendingDelete;
          deleteMutation.mutate(
            { id: row.id },
            {
              onSuccess: () => {
                notificationService.success(adminNotificationsCopy.toast.subscriptionRemoved);
                setPendingDelete(null);
              },
              onError: (err) => {
                notificationService.error(
                  summarizeApiErrorBody(
                    decodeApiError(err),
                    adminNotificationsCopy.subscribers.removeFailed,
                  ),
                );
              },
            },
          );
        }}
        isLoading={deleteMutation.isPending}
      />

      <ConfirmDialog
        isOpen={pendingRequiredFlip !== null}
        title={
          pendingRequiredFlip?.isRequired
            ? adminNotificationsCopy.subscribers.action.demoteRequiredTitle
            : adminNotificationsCopy.subscribers.action.promoteRequiredTitle
        }
        description={
          pendingRequiredFlip?.isRequired
            ? adminNotificationsCopy.subscribers.action.demoteRequiredBody
            : adminNotificationsCopy.subscribers.action.promoteRequiredBody
        }
        confirmLabel={
          pendingRequiredFlip?.isRequired
            ? adminNotificationsCopy.subscribers.action.demoteRequiredConfirm
            : adminNotificationsCopy.subscribers.action.promoteRequiredConfirm
        }
        cancelLabel={adminNotificationsCopy.subscribers.action.cancel}
        variant={pendingRequiredFlip?.isRequired ? 'warning' : 'primary'}
        onClose={() => setPendingRequiredFlip(null)}
        onConfirm={() => {
          if (!pendingRequiredFlip) return;
          const row = pendingRequiredFlip;
          const next = !row.isRequired;
          patchMutation.mutate(
            { id: row.id, isRequired: next },
            {
              onSuccess: () => {
                notificationService.success(adminNotificationsCopy.toast.subscriptionUpdated);
                setPendingRequiredFlip(null);
              },
              onError: (err) => {
                notificationService.error(
                  summarizeApiErrorBody(
                    decodeApiError(err),
                    adminNotificationsCopy.subscribers.updateFailed,
                  ),
                );
              },
            },
          );
        }}
        isLoading={patchMutation.isPending}
      />
    </div>
  );
}
