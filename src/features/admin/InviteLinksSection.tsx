import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link2, Copy, Check, Ban, Plus, SearchX } from 'lucide-react';
import {
  Button,
  Badge,
  LoadingState,
  ConfirmDialog,
  TableToolbar,
  DataTable,
  FilterPills,
  type ColumnDef,
} from '@/components/ui';
import { adminApi } from '@/services/api/adminApi';
import type {
  InviteLink,
  InviteLinkStatus,
  InviteListStatus,
  CreateInviteLinkResponse,
} from '@/services/api/adminApi';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';
import { notificationService } from '@/services/notifications';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { InviteUsesPanel } from './InviteUsesPanel';
import { CreateInviteSlideOver } from './inviteLinks/CreateInviteSlideOver';
import { inviteLinksCopy } from './inviteLinks/inviteLinks.copy';

const DEFAULT_PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS: { id: InviteListStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'all', label: 'All' },
];

// Server is the authority on status — render its label/variant directly.
const STATUS_BADGE: Record<InviteLinkStatus, { label: string; variant: 'success' | 'neutral' | 'warning' }> = {
  active: { label: 'Active', variant: 'success' },
  revoked: { label: 'Revoked', variant: 'neutral' },
  expired: { label: 'Expired', variant: 'neutral' },
  exhausted: { label: 'Exhausted', variant: 'warning' },
};

function isInviteListStatus(value: string | null): value is InviteListStatus {
  return value === 'active' || value === 'terminal' || value === 'all';
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InviteLinksSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get('status');
  const statusFilter: InviteListStatus = isInviteListStatus(rawStatus) ? rawStatus : 'active';

  const setStatusFilter = useCallback(
    (next: InviteListStatus) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'active') {
        params.delete('status');
      } else {
        params.set('status', next);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [links, setLinks] = useState<InviteLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokingLink, setRevokingLink] = useState<InviteLink | null>(null);
  const [viewingUsesFor, setViewingUsesFor] = useState<InviteLink | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [allRoles, setAllRoles] = useState<RoleResponse[]>([]);
  const [roles, setRoles] = useState<RoleResponse[]>([]);

  const [showCreateForm, setShowCreateForm] = useState(false);

  // One-time URL display
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.listInviteLinks({
        status: statusFilter,
        include: ['latestSend'],
      });
      setLinks(data);
    } catch {
      notificationService.error('Failed to load invite links');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadLinks(); }, [loadLinks]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => {
    rolesApi.listRoles().then((all) => {
      setAllRoles(all);
      setRoles(all.filter((r) => !r.isSystem));
    });
  }, []);

  const roleNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allRoles) map.set(r.id, r.name);
    return map;
  }, [allRoles]);

  const filtered = useMemo(() => {
    if (!search.trim()) return links;
    const q = search.toLowerCase();
    return links.filter(
      (l) =>
        (l.label ?? '').toLowerCase().includes(q) ||
        l.roleId.toLowerCase().includes(q) ||
        (roleNamesById.get(l.roleId) ?? '').toLowerCase().includes(q) ||
        l.createdByEmail.toLowerCase().includes(q) ||
        STATUS_BADGE[l.status].label.toLowerCase().includes(q),
    );
  }, [links, search, roleNamesById]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleCreated = useCallback(
    async (result: CreateInviteLinkResponse) => {
      setGeneratedUrl(result.inviteUrl);
      setCopied(false);
      await loadLinks();
    },
    [loadLinks],
  );

  const handleRevoke = async () => {
    if (!revokingLink) return;
    try {
      await adminApi.revokeInviteLink(revokingLink.id);
      notificationService.success('Invite link revoked');
      setRevokingLink(null);
      await loadLinks();
    } catch {
      notificationService.error('Failed to revoke invite link');
    }
  };

  const handleCopy = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    notificationService.success('Link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnyLatestSend = useMemo(
    () => links.some((l) => l.latestSendStatus != null || l.latestSendRecipient != null),
    [links],
  );

  const columns = useMemo((): ColumnDef<InviteLink>[] => {
    const baseColumns: ColumnDef<InviteLink>[] = [
    {
      key: 'label',
      header: 'Label',
      width: 'min-w-[220px]',
      render: (link) => (
        <div className="flex flex-col">
          <span>
            {link.label ? link.label : <span className="italic text-[var(--text-muted)]">No label</span>}
          </span>
          {link.status === 'revoked' && link.revokedAt && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Revoked by {link.revokedByEmail ?? 'unknown'} · {formatRelative(link.revokedAt)}
            </span>
          )}
          {link.status === 'expired' && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Expired {formatRelative(link.expiresAt)}
            </span>
          )}
          {link.status === 'exhausted' && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Filled · {link.usesCount}{link.maxUses !== null ? ` / ${link.maxUses}` : ''} used
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 'min-w-[160px]',
      render: (link) => {
        const name = roleNamesById.get(link.roleId);
        return (
          <span title={link.roleId}>
            <Badge variant="neutral" size="sm">
              {name ?? link.roleId.slice(0, 8)}
            </Badge>
          </span>
        );
      },
    },
    {
      key: 'uses',
      header: 'Uses',
      width: 'w-[110px]',
      render: (link) => {
        const text = `${link.usesCount}${link.maxUses !== null ? ` / ${link.maxUses}` : ''}`;
        if (link.usesCount === 0) {
          return <span className="tabular-nums text-[var(--text-muted)]">{text}</span>;
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewingUsesFor(link);
            }}
            className="inline-flex items-center gap-1 tabular-nums text-[var(--color-brand-accent)] hover:underline"
            title="View redemptions"
          >
            {text}
            <Link2 className="h-3 w-3" />
          </button>
        );
      },
    },
    {
      key: 'expires',
      header: 'Expires',
      width: 'w-[170px]',
      render: (link) => (
        <span className="tabular-nums text-[var(--text-muted)]">
          {new Date(link.expiresAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-[110px]',
      render: (link) => {
        const badge = STATUS_BADGE[link.status];
        return <Badge variant={badge.variant} dot={badge.variant} size="sm">{badge.label}</Badge>;
      },
    },
      {
        key: 'actions',
        header: 'Actions',
        width: 'w-[100px]',
        cellClassName: 'text-right',
        headerClassName: 'text-right',
        render: (link) =>
          link.status === 'active' ? (
            <PermissionGate action="invite_link:manage">
              <Button
                variant="danger"
                size="sm"
                icon={Ban}
                iconOnly
                title="Revoke"
                onClick={(e) => {
                  e.stopPropagation();
                  setRevokingLink(link);
                }}
              />
            </PermissionGate>
          ) : null,
      },
    ];

    if (!hasAnyLatestSend) return baseColumns;

    const latestSendColumns: ColumnDef<InviteLink>[] = [
      {
        key: 'latestSendRecipient',
        header: inviteLinksCopy.columns.sentTo,
        width: 'min-w-[200px]',
        render: (link) =>
          link.latestSendRecipient ? (
            <span className="text-[12px] text-[var(--text-secondary)]" title={link.latestSendRecipient}>
              {link.latestSendRecipient}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'latestSendStatus',
        header: inviteLinksCopy.columns.lastSendStatus,
        width: 'w-[120px]',
        render: (link) => {
          if (!link.latestSendStatus) return <span className="text-[var(--text-muted)]">—</span>;
          const isSent = link.latestSendStatus === 'sent';
          return (
            <Badge variant={isSent ? 'success' : 'error'} dot={isSent ? 'success' : 'error'} size="sm">
              {isSent ? 'Sent' : 'Failed'}
            </Badge>
          );
        },
      },
    ];

    // Insert the latest-send pair after Status but before Actions.
    const actionsIndex = baseColumns.findIndex((c) => c.key === 'actions');
    return [
      ...baseColumns.slice(0, actionsIndex),
      ...latestSendColumns,
      ...baseColumns.slice(actionsIndex),
    ];
  }, [roleNamesById, hasAnyLatestSend]);

  if (isLoading && links.length === 0) {
    return <LoadingState />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {generatedUrl && (
        <div className="rounded-lg border border-[var(--color-brand-accent)]/30 bg-[var(--color-brand-accent)]/5 p-3">
          <p className="mb-2 text-[13px] font-medium text-[var(--text-primary)]">
            Invite link generated — copy it now, it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-[var(--bg-primary)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              {generatedUrl}
            </code>
            <Button size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      <FilterPills
        options={STATUS_FILTER_OPTIONS}
        active={statusFilter}
        onChange={(id) => {
          if (isInviteListStatus(id)) setStatusFilter(id);
        }}
      />

      <TableToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search invite links…',
          label: 'Search invite links',
        }}
        actions={
          <PermissionGate action="invite_link:manage">
            <Button size="sm" icon={Plus} onClick={() => { setShowCreateForm(true); setGeneratedUrl(null); }}>
              Generate Invite Link
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        columns={columns}
        data={paginated}
        keyExtractor={(link) => link.id}
        pagination={{
          page: safePage,
          totalPages,
          pageSize,
          totalItems,
          showCount: true,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n);
            setPage(1);
          },
        }}
        emptyIcon={search ? SearchX : Link2}
        emptyTitle={search ? 'No results found' : 'No invite links yet'}
        emptyDescription={
          search
            ? `No invite links match "${search}"`
            : 'Generate an invite link to let team members sign up'
        }
      />

      <CreateInviteSlideOver
        isOpen={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        roles={roles}
        createInvite={adminApi.createInviteLink}
        onCreated={handleCreated}
      />

      <InviteUsesPanel invite={viewingUsesFor} onClose={() => setViewingUsesFor(null)} />

      <ConfirmDialog
        isOpen={!!revokingLink}
        title="Revoke Invite Link"
        description={`Revoke this invite link${revokingLink?.label ? ` (${revokingLink.label})` : ''}? It will become unusable immediately. This action cannot be undone.`}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
        onClose={() => setRevokingLink(null)}
      />
    </div>
  );
}
