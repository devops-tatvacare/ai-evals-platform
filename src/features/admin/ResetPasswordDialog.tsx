import { useState, useId } from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Input,
  PasswordStrengthIndicator,
  RightSlideOverShell,
  validatePasswordStrength,
} from '@/components/ui';
import { adminApi } from '@/services/api/adminApi';
import type { AdminUser } from '@/services/api/adminApi';

interface ResetPasswordDialogProps {
  isOpen: boolean;
  user: AdminUser | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetPasswordDialog({ isOpen, user, onClose, onSuccess }: ResetPasswordDialogProps) {
  const titleId = useId();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    onClose();
  };

  const { valid: passwordStrong } = validatePasswordStrength(newPassword);

  const canSubmit = !!user && passwordStrong && newPassword === confirmPassword && !isSubmitting;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSubmit || !user) return;

    setIsSubmitting(true);
    setError('');
    try {
      await adminApi.resetUserPassword(user.id, newPassword);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={handleClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          Reset Password
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
            User
          </label>
          <Input value={user ? `${user.displayName} (${user.email})` : ''} disabled />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            New Password
          </label>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Create a strong password"
            autoFocus
          />
          <PasswordStrengthIndicator password={newPassword} className="mt-2" />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            Confirm Password
          </label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
          />
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <p className="mt-1 text-[11px] text-[var(--color-error)]">Passwords do not match</p>
          )}
        </div>

        <p className="text-[12px] text-[var(--text-muted)]">
          This will immediately invalidate all active sessions for this user.
        </p>

        {error && (
          <p className="text-[13px] text-[var(--color-error)]">{error}</p>
        )}
      </form>

      <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={!canSubmit}
          isLoading={isSubmitting}
          onClick={() => handleSubmit()}
        >
          Reset Password
        </Button>
      </div>
    </RightSlideOverShell>
  );
}
