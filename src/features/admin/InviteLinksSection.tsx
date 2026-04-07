import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link2, Copy, Check, Trash2, Plus, Search, SearchX, X } from 'lucide-react';
import { Button, Badge, Spinner, ConfirmDialog, EmptyState, SingleSelect } from '@/components/ui';
import type { SingleSelectOption } from '@/components/ui';
import { adminApi } from '@/services/api/adminApi';
import type { InviteLink, CreateInviteLinkRequest, CreateInviteLinkResponse } from '@/services/api/adminApi';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils';
import { PermissionGate } from '@/components/auth/PermissionGate';

const ROWS_PER_PAGE = 20;

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
];

export function InviteLinksSection() {
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingLink, setRevokingLink] = useState<InviteLink | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [label, setLabel] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [maxUses, setMaxUses] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(168);

  // One-time URL display
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const data = await adminApi.listInviteLinks();
      setLinks(data);
    } catch {
      notificationService.error('Failed to load invite links');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => {
    rolesApi.listRoles().then((all) => {
      const filtered = all.filter((r) => !r.isSystem);
      setRoles(filtered);
      if (filtered.length > 0) setRoleId(filtered[0].id);
    });
  }, []);

  const isExpired = (link: InviteLink) => new Date(link.expiresAt) < new Date();
  const isExhausted = (link: InviteLink) => link.maxUses !== null && link.usesCount >= link.maxUses;

  const roleOptions = useMemo<SingleSelectOption[]>(
    () => roles.map((role) => ({ value: role.id, label: role.name })),
    [roles],
  );

  const expiryOptions = useMemo<SingleSelectOption[]>(
    () => EXPIRY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
    [],
  );

  const linkStatus = (link: InviteLink): { label: string; variant: 'success' | 'neutral' | 'warning' } => {
    if (!link.isActive) return { label: 'Revoked', variant: 'neutral' };
    if (isExpired(link)) return { label: 'Expired', variant: 'neutral' };
    if (isExhausted(link)) return { label: 'Exhausted', variant: 'warning' };
    return { label: 'Active', variant: 'success' };
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return links;
    const q = search.toLowerCase();
    return links.filter(
      (l) =>
        (l.label ?? '').toLowerCase().includes(q) ||
        l.roleId.toLowerCase().includes(q) ||
        l.createdByEmail.toLowerCase().includes(q) ||
        linkStatus(l).label.toLowerCase().includes(q),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const body: CreateInviteLinkRequest = { roleId, expiresInHours };
      if (label.trim()) body.label = label.trim();
      if (maxUses.trim()) body.maxUses = parseInt(maxUses, 10);

      const result: CreateInviteLinkResponse = await adminApi.createInviteLink(body);
      setGeneratedUrl(result.inviteUrl);
      setCopied(false);
      setShowCreateForm(false);
      setLabel('');
      setMaxUses('');
      setRoleId(roles.length > 0 ? roles[0].id : '');
      setExpiresInHours(168);
      await loadLinks();
    } catch {
      notificationService.error('Failed to create invite link');
    } finally {
      setIsCreating(false);
    }
  };

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

  const inputClass = 'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]';

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      {/* Generated URL banner */}
      {generatedUrl && (
        <div className="mb-4 rounded-lg border border-[var(--color-brand-accent)]/30 bg-[var(--color-brand-accent)]/5 p-3">
          <p className="mb-2 text-[12px] font-medium text-[var(--text-primary)]">
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

      {/* Create form — right overlay panel */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreateForm(false)} />
          <div className="relative w-full max-w-md bg-[var(--bg-primary)] shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Generate Invite Link</h2>
              <button onClick={() => setShowCreateForm(false)} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">Label (optional)</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="e.g. Engineering team" />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">Role</label>
                <SingleSelect
                  value={roleId}
                  onChange={setRoleId}
                  options={roleOptions}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">Max Uses</label>
                <input type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className={inputClass} placeholder="Unlimited" />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">Expires In</label>
                <SingleSelect
                  value={String(expiresInHours)}
                  onChange={(value) => setExpiresInHours(Number(value))}
                  options={expiryOptions}
                  className="w-full"
                />
              </div>
            </div>
            <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="md" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button size="md" onClick={handleCreate} isLoading={isCreating} icon={Link2}>Generate Invite Link</Button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: search + generate (hidden when empty and no search) */}
      <div className={cn('mb-4 flex items-center gap-3', links.length === 0 && !search && 'hidden')}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by label, role, or creator..."
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)] transition-colors"
          />
        </div>
        <PermissionGate action="invite_link:manage">
          <Button size="md" icon={Plus} onClick={() => { setShowCreateForm(true); setGeneratedUrl(null); }}>
            Generate Invite Link
          </Button>
        </PermissionGate>
      </div>

      {/* Links table (hidden when no links at all) */}
      <div className={cn('overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]', filtered.length === 0 && 'hidden')}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Label</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Role</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Uses</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Expires</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Status</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {paginated.map((link) => {
              const status = linkStatus(link);
              const canRevoke = link.isActive && !isExpired(link);
              return (
                <tr key={link.id} className={cn('transition-colors', !link.isActive && 'opacity-50')}>
                  <td className="px-4 py-2.5 text-[13px] text-[var(--text-primary)]">
                    {link.label || <span className="text-[var(--text-muted)] italic">No label</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="neutral" size="sm">{link.roleId}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                    {link.usesCount}{link.maxUses !== null ? ` / ${link.maxUses}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
                    {new Date(link.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={status.variant} dot={status.variant} size="sm">{status.label}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-grid grid-cols-1 gap-1 w-[32px]">
                      {canRevoke ? (
                        <PermissionGate action="invite_link:manage">
                          <Button variant="danger" size="sm" icon={Trash2} iconOnly title="Revoke" onClick={() => setRevokingLink(link)} />
                        </PermissionGate>
                      ) : <span />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && !showCreateForm && (
        <EmptyState
          icon={search ? SearchX : Link2}
          title={search ? 'No results found' : 'No invite links yet'}
          description={search ? `No invite links match "${search}"` : 'Generate an invite link to let team members sign up'}
          compact
          className="mt-4"
          action={!search ? { label: 'Generate Invite Link', onClick: () => { setShowCreateForm(true); setGeneratedUrl(null); } } : undefined}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[12px] text-[var(--text-muted)]">
            Showing {(page - 1) * ROWS_PER_PAGE + 1}–{Math.min(page * ROWS_PER_PAGE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="px-2 text-[12px] text-[var(--text-secondary)]">{page} / {totalPages}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!revokingLink}
        title="Revoke Invite Link"
        description={`Are you sure you want to revoke this invite link${revokingLink?.label ? ` (${revokingLink.label})` : ''}? It will no longer be usable for signups.`}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
        onClose={() => setRevokingLink(null)}
      />
    </>
  );
}
