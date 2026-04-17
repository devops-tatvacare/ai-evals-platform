import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Pencil, UserX, KeyRound, Search, Users, Trash2 } from 'lucide-react';
import {
  Button,
  Badge,
  Spinner,
  ConfirmDialog,
  Tabs,
  FilterButton,
  FilterPanel,
  type FilterFieldConfig,
} from '@/components/ui';
import { DataTable, type ColumnDef, type SortState } from '@/components/ui/DataTable';
import { adminApi } from '@/services/api/adminApi';
import type { AdminUser, UpdateUserRequest } from '@/services/api/adminApi';
import { useAuthStore } from '@/stores/authStore';
import { notificationService } from '@/services/notifications';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { CreateUserDialog } from './CreateUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { InviteLinksSection } from './InviteLinksSection';
import { RolesTab } from './RolesTab';
import { AuditLogTab } from './AuditLogTab';

const DEFAULT_PAGE_SIZE = 25;

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'q',
    label: 'Search',
    control: 'text',
    placeholder: 'Search by name, email, or role',
  },
];

function compareUsers(a: AdminUser, b: AdminUser, key: string): number {
  switch (key) {
    case 'displayName':
      return a.displayName.localeCompare(b.displayName);
    case 'email':
      return a.email.localeCompare(b.email);
    case 'roleName':
      return a.roleName.localeCompare(b.roleName);
    case 'isActive':
      return (a.isActive ? 0 : 1) - (b.isActive ? 0 : 1);
    default:
      return 0;
  }
}

function UsersTab() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deactivatingUser, setDeactivatingUser] = useState<AdminUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState('');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [sortState, setSortState] = useState<SortState>({ key: 'displayName', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminApi.listUsers();
      setUsers(data);
    } catch {
      notificationService.error('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.roleName.toLowerCase().includes(q),
    );
  }, [users, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = compareUsers(a, b, sortState.key);
      return sortState.order === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortState]);

  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search]);

  const handleCreateUser = async (data: {
    email: string;
    displayName: string;
    password: string;
    roleId: string;
  }) => {
    await adminApi.createUser(data);
    notificationService.success('User created');
    await loadUsers();
  };

  const handleUpdateUser = async (userId: string, data: UpdateUserRequest) => {
    await adminApi.updateUser(userId, data);
    notificationService.success('User updated');
    await loadUsers();
  };

  const handleDeactivateUser = () => {
    if (!deactivatingUser) return;
    adminApi.deactivateUser(deactivatingUser.id).then(() => {
      notificationService.success('User deactivated');
      setDeactivatingUser(null);
      loadUsers();
    }).catch(() => {
      notificationService.error('Failed to deactivate user');
    });
  };

  const handleDeleteUser = () => {
    if (!deletingUser) return;
    adminApi.deleteUser(deletingUser.id).then(() => {
      notificationService.success('User deleted permanently');
      setDeletingUser(null);
      loadUsers();
    }).catch(() => {
      notificationService.error('Failed to delete user');
    });
  };

  const isOwner = currentUser?.isOwner;
  const activeFilterCount = search.trim().length > 0 ? 1 : 0;

  const columns = useMemo((): ColumnDef<AdminUser>[] => [
    {
      key: 'displayName',
      header: 'Name',
      sortable: true,
      width: 'min-w-[240px]',
      render: (user) => {
        const isSelf = user.id === currentUser?.id;
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/20 text-[10px] font-semibold text-[var(--text-brand)]">
              {user.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {user.displayName}
              {isSelf && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">(you)</span>}
            </span>
          </div>
        );
      },
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      width: 'min-w-[200px]',
      render: (user) => (
        <span className="text-[13px] text-[var(--text-secondary)]">{user.email}</span>
      ),
    },
    {
      key: 'roleName',
      header: 'Role',
      sortable: true,
      width: 'w-[140px]',
      render: (user) => (
        <Badge variant={user.isOwner ? 'warning' : 'info'} size="sm">{user.roleName}</Badge>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      sortable: true,
      width: 'w-[100px]',
      render: (user) => (
        <Badge
          variant={user.isActive ? 'success' : 'neutral'}
          dot={user.isActive ? 'success' : 'neutral'}
          size="sm"
        >
          {user.isActive ? 'Active' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-[160px]',
      cellClassName: 'text-right',
      render: (user) => {
        const isSelf = user.id === currentUser?.id;
        return (
          <div className="inline-grid grid-cols-4 gap-1 w-[128px]" onClick={(e) => e.stopPropagation()}>
            <PermissionGate action="user:edit">
              <Button variant="secondary" size="sm" icon={Pencil} iconOnly title="Edit user" onClick={() => setEditingUser(user)} />
            </PermissionGate>
            {!isSelf && user.isActive ? (
              <PermissionGate action="user:reset_password">
                <Button variant="secondary" size="sm" icon={KeyRound} iconOnly title="Reset password" onClick={() => setResetPasswordUser(user)} />
              </PermissionGate>
            ) : <span />}
            {isOwner && !isSelf && !user.isOwner && user.isActive ? (
              <PermissionGate action="user:deactivate">
                <Button variant="secondary" size="sm" icon={UserX} iconOnly title="Deactivate user" onClick={() => setDeactivatingUser(user)} />
              </PermissionGate>
            ) : <span />}
            {!isSelf && !user.isOwner ? (
              <PermissionGate action="user:delete">
                <Button variant="danger" size="sm" icon={Trash2} iconOnly title="Delete user" onClick={() => setDeletingUser(user)} />
              </PermissionGate>
            ) : <span />}
          </div>
        );
      },
    },
  ], [currentUser?.id, isOwner]);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      <FilterButton activeCount={activeFilterCount} onClick={() => setFilterPanelOpen(true)} />
      <div className="flex-1" />
      <PermissionGate action="user:create">
        <Button size="sm" onClick={() => setIsCreateOpen(true)} icon={Plus}>
          Add User
        </Button>
      </PermissionGate>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {toolbar}

      <DataTable
        columns={columns}
        data={paged}
        keyExtractor={(row) => row.id}
        sortState={sortState}
        onSortChange={(next) => {
          setSortState(next);
          setPage(1);
        }}
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
        emptyIcon={search ? Search : Users}
        emptyTitle={search ? 'No results found' : 'No users yet'}
        emptyDescription={
          search
            ? `No users match "${search}"`
            : 'Add your first team member to get started'
        }
      />

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        fields={FILTER_FIELDS}
        values={{ q: search }}
        onChange={(patch) => {
          if (typeof patch.q === 'string') setSearch(patch.q);
        }}
        onClear={() => setSearch('')}
      />

      {/* Dialogs */}
      <CreateUserDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateUser}
      />
      <EditUserDialog
        isOpen={!!editingUser}
        user={editingUser}
        currentUserId={currentUser?.id ?? ''}
        onClose={() => setEditingUser(null)}
        onSubmit={handleUpdateUser}
      />
      <ConfirmDialog
        isOpen={!!deactivatingUser}
        title="Deactivate User"
        description={`Are you sure you want to deactivate ${deactivatingUser?.displayName}? They will no longer be able to log in.`}
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={handleDeactivateUser}
        onClose={() => setDeactivatingUser(null)}
      />
      <ConfirmDialog
        isOpen={!!deletingUser}
        title="Delete User Permanently"
        description={`Are you sure you want to permanently delete ${deletingUser?.displayName} (${deletingUser?.email})? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteUser}
        onClose={() => setDeletingUser(null)}
      />
      <ResetPasswordDialog
        isOpen={!!resetPasswordUser}
        user={resetPasswordUser}
        onClose={() => setResetPasswordUser(null)}
        onSuccess={() => notificationService.success('Password reset successfully')}
      />
    </div>
  );
}

export function AdminUsersPage() {
  const tabs = [
    {
      id: 'users',
      label: 'Users',
      content: <UsersTab />,
    },
    {
      id: 'invites',
      label: 'Invite Links',
      content: <InviteLinksSection />,
    },
    {
      id: 'roles',
      label: 'Roles',
      content: <RolesTab />,
    },
    {
      id: 'audit-log',
      label: 'Audit Log',
      content: <AuditLogTab />,
    },
  ];

  return (
    <div className="pb-20">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Admin
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Manage users, access, and security for your organization
        </p>
      </div>
      <Tabs tabs={tabs} defaultTab="users" />
    </div>
  );
}
