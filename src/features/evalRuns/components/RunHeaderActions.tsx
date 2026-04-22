/**
 * RunHeaderActions — shared action button group for run detail pages.
 * Order: Visibility | Human Review | separator | Logs | Cancel | Delete
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Ban, Trash2, Loader2 } from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { cn } from '@/utils';

/* ── Generic icon button ────────────────────────────────── */

interface ActionIconButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'warning' | 'danger';
  spinning?: boolean;
}

const variantStyles: Record<string, string> = {
  default: 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]',
  warning: 'text-[var(--color-warning)] bg-[var(--surface-warning)] border-[var(--border-warning)] hover:opacity-80',
  danger: 'text-[var(--color-error)] bg-[var(--surface-error)] border-[var(--border-error)] hover:opacity-80',
};

const btnBase =
  'inline-flex h-7 w-7 items-center justify-center rounded-[6px] border transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]';

export function ActionIconButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  disabled,
  variant = 'default',
  spinning,
}: ActionIconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={typeof tooltip === 'string' ? tooltip : label}
      className={cn(btnBase, variantStyles[variant])}
    >
      {spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
    </button>
  );
}

export function ActionIconLink({
  icon: Icon,
  label,
  tooltip,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tooltip?: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={typeof tooltip === 'string' ? tooltip : label}
      className={cn(btnBase, variantStyles.default)}
    >
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ── Header actions bar ─────────────────────────────────── */

interface RunHeaderActionsProps {
  logsHref: string;
  isActive: boolean;
  cancelling: boolean;
  deleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
  visibilityContent?: ReactNode;
  reviewContent?: ReactNode;
  retryContent?: ReactNode;
  hideActions?: boolean;
}

export function RunHeaderActions({
  logsHref,
  isActive,
  cancelling,
  deleting,
  onCancel,
  onDelete,
  visibilityContent,
  reviewContent,
  retryContent,
  hideActions,
}: RunHeaderActionsProps) {
  return (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
      {visibilityContent}
      {reviewContent}
      {retryContent}

      {!hideActions && (
        <>
          <ActionIconLink icon={FileText} label="Logs" tooltip="Logs" to={logsHref} />

          <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

          {isActive && (
            <PermissionGate action="evaluation:cancel">
              <ActionIconButton
                icon={Ban}
                label={cancelling ? 'Cancelling run' : 'Cancel run'}
                tooltip={cancelling ? 'Cancelling…' : 'Cancel run'}
                onClick={onCancel}
                disabled={cancelling}
                variant="warning"
                spinning={cancelling}
              />
            </PermissionGate>
          )}

          <PermissionGate action="evaluation:delete">
            <ActionIconButton
              icon={Trash2}
              label={deleting ? 'Deleting run' : 'Delete run'}
              tooltip={isActive ? 'Cannot delete a running evaluation. Cancel it first.' : deleting ? 'Deleting…' : 'Delete run'}
              onClick={onDelete}
              disabled={deleting || isActive}
              variant="danger"
              spinning={deleting}
            />
          </PermissionGate>
        </>
      )}
    </div>
  );
}
