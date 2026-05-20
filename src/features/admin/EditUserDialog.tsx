import { useState, useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { Button, Input, Select, RightSlideOverShell } from '@/components/ui';
import type { AdminUser, UpdateUserRequest } from '@/services/api/adminApi';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';
import { usePermission } from '@/utils/permissions';

interface EditUserDialogProps {
  isOpen: boolean;
  user: AdminUser | null;
  currentUserId: string;
  onClose: () => void;
  onSubmit: (userId: string, data: UpdateUserRequest) => Promise<void>;
}

export function EditUserDialog({
  isOpen,
  user,
  currentUserId,
  onClose,
  onSubmit,
}: EditUserDialogProps) {
  const titleId = useId();
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canAssignRole = usePermission('role:assign');

  useEffect(() => {
    rolesApi.listRoles().then((all) => {
      setRoles(all.filter((r) => !r.isSystem));
    });
  }, []);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setRoleId(user.roleId);
      setIsActive(user.isActive);
      setError('');
    }
  }, [user]);

  const isSelf = !!user && user.id === currentUserId;
  const isOwnerUser = !!user?.isOwner;
  const canChangeRole = canAssignRole && !isSelf && !isOwnerUser;
  const canToggleActive = !isSelf && !isOwnerUser;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }

    const updates: UpdateUserRequest = {};
    if (displayName.trim() !== user.displayName) {
      updates.displayName = displayName.trim();
    }
    if (canChangeRole && roleId !== user.roleId) {
      updates.roleId = roleId;
    }
    if (canToggleActive && isActive !== user.isActive) {
      updates.isActive = isActive;
    }

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit(user.id, updates);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          Edit User
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
      >
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Email
          </label>
          <Input value={user?.email ?? ''} disabled />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Display Name
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Role
          </label>
          {isOwnerUser ? (
            <Input value={user?.roleName ?? ''} disabled />
          ) : (
            <Select
              value={roleId}
              onChange={setRoleId}
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              disabled={!canChangeRole}
            />
          )}
          {isSelf && (
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              You cannot change your own role
            </p>
          )}
        </div>
        {canToggleActive && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="user-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-default)] text-[var(--color-brand-accent)] focus:ring-[var(--color-brand-accent)]"
            />
            <label
              htmlFor="user-active"
              className="text-[13px] font-medium text-[var(--text-secondary)]"
            >
              Account active
            </label>
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[var(--color-error)]">{error}</p>
        )}
      </form>

      <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button size="md" isLoading={isSubmitting} onClick={() => handleSubmit()}>
          Save Changes
        </Button>
      </div>
    </RightSlideOverShell>
  );
}
