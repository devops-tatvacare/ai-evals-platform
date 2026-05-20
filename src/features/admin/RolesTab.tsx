import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Crown, ShieldAlert, SearchX } from 'lucide-react';
import {
  Button,
  Badge,
  LoadingState,
  ConfirmDialog,
  TableToolbar,
  DataTable,
  RowActionsMenu,
  type ColumnDef,
  type RowAction,
} from '@/components/ui';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';
import { useAuthStore } from '@/stores/authStore';
import { notificationService } from '@/services/notifications';
import { RoleEditorPanel } from './RoleEditorPanel';

const DEFAULT_PAGE_SIZE = 25;

export function RolesTab() {
  const currentUser = useAuthStore((s) => s.user);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleResponse | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleResponse | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

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

  useEffect(() => { setPage(1); }, [search]);

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

  const isOwner = currentUser?.isOwner;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((role) => {
      if (role.name.toLowerCase().includes(q)) return true;
      if ((role.description ?? '').toLowerCase().includes(q)) return true;
      return role.appAccess.some((app) =>
        (appNames[app] ?? app).toLowerCase().includes(q),
      );
    });
  }, [roles, search, appNames]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const columns = useMemo((): ColumnDef<RoleResponse>[] => [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[180px]',
      render: (role) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{role.name}</span>
          {role.isSystem && <Badge variant="warning" size="sm" icon={Crown}>System</Badge>}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (role) =>
        role.description ? (
          <span className="text-[var(--text-secondary)]">
            {role.description.length > 80 ? `${role.description.slice(0, 80)}…` : role.description}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'appAccess',
      header: 'App Access',
      width: 'min-w-[220px]',
      render: (role) =>
        role.appAccess.length === 0 ? (
          <span className="text-[var(--text-muted)]">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {role.appAccess.map((app) => (
              <Badge key={app} variant="info" size="sm">{appNames[app] ?? app}</Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'permissions',
      header: 'Permissions',
      width: 'w-[120px]',
      render: (role) => <Badge variant="neutral" size="sm">{role.permissions.length}</Badge>,
    },
    {
      key: 'users',
      header: 'Users',
      width: 'w-[80px]',
      render: (role) => (
        <span className="tabular-nums text-[var(--text-secondary)]">{role.userCount}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[88px]',
      cellClassName: 'text-right',
      headerClassName: 'text-right',
      render: (role) => {
        if (role.isSystem || !isOwner) return null;
        const actions: RowAction[] = [
          {
            id: 'edit',
            icon: Pencil,
            label: 'Edit role',
            onClick: () => setEditingRole(role),
          },
          {
            id: 'delete',
            icon: Trash2,
            label: 'Delete role',
            danger: true,
            disabled: role.userCount > 0,
            title: role.userCount > 0 ? 'Cannot delete — role has users' : undefined,
            onClick: () => setDeletingRole(role),
          },
        ];
        return (
          <RowActionsMenu
            actions={actions}
            open={openMenuId === role.id}
            onOpenChange={(next) => setOpenMenuId(next ? role.id : null)}
          />
        );
      },
    },
  ], [appNames, isOwner, openMenuId]);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Search roles…',
            label: 'Search roles',
          }}
          actions={
            isOwner ? (
              <Button size="sm" onClick={() => setIsCreateOpen(true)} icon={Plus}>
                Create Role
              </Button>
            ) : null
          }
        />
        <DataTable
          columns={columns}
          data={paginated}
          keyExtractor={(role) => role.id}
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
          emptyIcon={search ? SearchX : ShieldAlert}
          emptyTitle={search ? 'No matching roles' : 'No roles yet'}
          emptyDescription={
            search
              ? `No roles match "${search}"`
              : 'Create roles to define fine-grained access for your team'
          }
        />
      </div>

      <RoleEditorPanel
        isOpen={isCreateOpen || !!editingRole}
        role={editingRole}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingRole(null);
        }}
        onSaved={loadRoles}
      />
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
