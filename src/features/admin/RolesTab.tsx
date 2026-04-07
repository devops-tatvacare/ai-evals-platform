import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Crown, ShieldAlert } from 'lucide-react';
import { Button, Badge, Spinner, ConfirmDialog, EmptyState } from '@/components/ui';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';
import { useAuthStore } from '@/stores/authStore';
import { notificationService } from '@/services/notifications';
import { RoleEditorPanel } from './RoleEditorPanel';

export function RolesTab() {
  const currentUser = useAuthStore((s) => s.user);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleResponse | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [appNames, setAppNames] = useState<Record<string, string>>({});

  const loadRoles = useCallback(async () => {
    try {
      const data = await rolesApi.listRoles();
      setRoles(data);
    } catch {
      notificationService.error('Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    rolesApi.listApps()
      .then((apps) => {
        setAppNames(
          apps.reduce<Record<string, string>>((entries, app) => {
            entries[app.slug] = app.displayName;
            return entries;
          }, {}),
        );
      })
      .catch(() => {});
  }, []);

  const handleDelete = async () => {
    if (!deletingRole) return;
    setIsDeleting(true);
    try {
      await rolesApi.deleteRole(deletingRole.id);
      notificationService.success('Role deleted');
      setDeletingRole(null);
      await loadRoles();
    } catch {
      notificationService.error('Failed to delete role');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const isOwner = currentUser?.isOwner;

  return (
    <>
      {/* Table or empty state */}
      {roles.filter((r) => !r.isSystem).length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No custom roles yet"
          description="Create roles to define fine-grained access for your team"
          compact
          className="mt-4"
          action={isOwner ? { label: 'Create Role', onClick: () => setIsCreateOpen(true) } : undefined}
        />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">
                {roles.length} role{roles.length !== 1 ? 's' : ''} defined
              </p>
              {!isOwner && (
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  You can view role assignments, but only tenant owners can create, edit, or delete custom roles.
                </p>
              )}
            </div>
            {isOwner ? (
              <Button size="md" onClick={() => setIsCreateOpen(true)} icon={Plus}>
                Create Role
              </Button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Description</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">App Access</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Permissions</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Users</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {roles.map((role) => (
                  <tr key={role.id} className="transition-colors hover:bg-[var(--bg-secondary)]/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">{role.name}</span>
                        {role.isSystem && (
                          <Badge variant="warning" size="sm" icon={Crown}>System</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                      {role.description
                        ? role.description.length > 60
                          ? `${role.description.slice(0, 60)}…`
                          : role.description
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {role.appAccess.length === 0 ? (
                        <span className="text-[13px] text-[var(--text-muted)]">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {role.appAccess.map((app) => (
                            <Badge key={app} variant="info" size="sm">{appNames[app] ?? app}</Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="neutral" size="sm">{role.permissions.length}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-[var(--text-secondary)]">
                      {role.userCount}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-grid grid-cols-2 gap-1 w-[64px]">
                        {!role.isSystem && isOwner ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Pencil}
                              iconOnly
                              title="Edit role"
                              onClick={() => setEditingRole(role)}
                            />
                            <Button
                              variant="danger"
                              size="sm"
                              icon={Trash2}
                              iconOnly
                              title={role.userCount > 0 ? 'Cannot delete — role has users' : 'Delete role'}
                              disabled={role.userCount > 0}
                              onClick={() => setDeletingRole(role)}
                            />
                          </>
                        ) : (
                          <>
                            <span />
                            <span />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Role Editor Panel (slide-over) */}
      {(isCreateOpen || !!editingRole) && (
        <RoleEditorPanel
          role={editingRole}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingRole(null);
          }}
          onSaved={loadRoles}
        />
      )}
      <ConfirmDialog
        isOpen={!!deletingRole}
        title="Delete Role"
        description={`Are you sure you want to delete "${deletingRole?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleDelete}
        onClose={() => setDeletingRole(null)}
      />
    </>
  );
}
