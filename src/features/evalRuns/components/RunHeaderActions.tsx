/**
 * RunHeaderActions — shared Logs / Cancel / Delete button group for run detail pages.
 * Used by RunDetail (Kaira) and InsideSalesRunDetail.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Ban, Trash2, Loader2 } from 'lucide-react';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { Tooltip } from '@/components/ui';
import { cn } from '@/utils';

const actionBtnBase =
  'inline-flex h-7 w-7 items-center justify-center rounded-[6px] border transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]';

interface RunHeaderActionsProps {
  logsHref: string;
  isActive: boolean;
  cancelling: boolean;
  deleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
  leadingContent?: ReactNode;
}

export function RunHeaderActions({
  logsHref,
  isActive,
  cancelling,
  deleting,
  onCancel,
  onDelete,
  leadingContent,
}: RunHeaderActionsProps) {
  return (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
      {leadingContent}

      <Tooltip content="Logs">
        <Link
          to={logsHref}
          aria-label="Logs"
          title="Logs"
          className={cn(actionBtnBase, 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]')}
        >
          <FileText className="h-3.5 w-3.5" />
        </Link>
      </Tooltip>

      {isActive && (
        <PermissionGate action="evaluation:cancel">
          <Tooltip content={cancelling ? 'Cancelling…' : 'Cancel run'}>
            <button
              onClick={onCancel}
              disabled={cancelling}
              aria-label={cancelling ? 'Cancelling run' : 'Cancel run'}
              title={cancelling ? 'Cancelling…' : 'Cancel run'}
              className={cn(actionBtnBase, 'text-[var(--color-warning)] bg-[var(--surface-warning)] border-[var(--border-warning)] hover:opacity-80')}
            >
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
        </PermissionGate>
      )}

      <PermissionGate action="evaluation:delete">
        <Tooltip content={isActive ? 'Cannot delete a running evaluation. Cancel it first.' : deleting ? 'Deleting…' : 'Delete run'}>
          <button
            onClick={onDelete}
            disabled={deleting || isActive}
            title={isActive ? 'Cannot delete a running evaluation. Cancel it first.' : deleting ? 'Deleting…' : 'Delete run'}
            aria-label={deleting ? 'Deleting run' : 'Delete run'}
            className={cn(actionBtnBase, 'text-[var(--color-error)] bg-[var(--surface-error)] border-[var(--border-error)] hover:opacity-80')}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
      </PermissionGate>
    </div>
  );
}
