import { useState, useEffect, useId } from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Input,
  PasswordStrengthIndicator,
  RightSlideOverShell,
  Select,
  validatePasswordStrength,
} from '@/components/ui';
import { rolesApi } from '@/services/api/rolesApi';
import type { RoleResponse } from '@/services/api/rolesApi';

interface CreateUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    email: string;
    displayName: string;
    password: string;
    roleId: string;
  }) => Promise<void>;
}

export function CreateUserDialog({ isOpen, onClose, onSubmit }: CreateUserDialogProps) {
  const titleId = useId();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    rolesApi.listRoles().then((all) => {
      const filtered = all.filter((r) => !r.isSystem);
      setRoles(filtered);
      if (filtered.length > 0) setRoleId(filtered[0].id);
    });
  }, []);

  const resetForm = () => {
    setEmail('');
    setDisplayName('');
    setPassword('');
    setRoleId(roles.length > 0 ? roles[0].id : '');
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const { valid: passwordStrong } = validatePasswordStrength(password);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !displayName.trim() || !password.trim()) {
      setError('All fields are required');
      return;
    }
    if (!passwordStrong) {
      setError('Password does not meet strength requirements');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({ email: email.trim(), displayName: displayName.trim(), password, roleId });
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={handleClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          Add User
        </h2>
        <button
          type="button"
          onClick={handleClose}
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
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Display Name
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Full name"
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Temporary Password
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a strong password"
          />
          <PasswordStrengthIndicator password={password} className="mt-2" />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Role
          </label>
          <Select
            value={roleId}
            onChange={setRoleId}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>

        {error && <p className="text-[13px] text-[var(--color-error)]">{error}</p>}
      </form>

      <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          size="md"
          isLoading={isSubmitting}
          disabled={!passwordStrong}
          onClick={() => handleSubmit()}
        >
          Create User
        </Button>
      </div>
    </RightSlideOverShell>
  );
}
