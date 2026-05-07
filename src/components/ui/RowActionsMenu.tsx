import { MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export interface RowAction {
  /** Stable id used as the React key. */
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Render the row in danger color (e.g. Archive / Delete). */
  danger?: boolean;
  /** Optional native title attribute for the row — used to surface
   *  why an action is disabled (permission gate, missing prereq). */
  title?: string;
  /** When true the action is omitted entirely. Useful for
   *  permission-gated actions where the slot disappears instead of
   *  disabling. */
  hidden?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible label for the trigger button. */
  triggerLabel?: string;
  /** Disable the trigger entirely (e.g. when the row has no permitted
   *  actions). When all actions are `hidden`, the menu renders nothing
   *  to keep the cell vertically aligned with rows that do show one. */
  disabled?: boolean;
}

/**
 * Compact 3-dot row-actions popover used inside `<DataTable>` rows.
 * Reuses the platform `<Popover>` primitive and matches the row-menu
 * shape established by the eval runs list (icon + label row,
 * `bg-[var(--bg-elevated)]`, `min-w-[180px]`). Each `RowAction` is a
 * single click target — keep destructive actions together at the bottom
 * by ordering the array, not by special-casing here.
 */
export function RowActionsMenu({
  actions,
  open,
  onOpenChange,
  triggerLabel = 'Row actions',
  disabled = false,
}: RowActionsMenuProps) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={triggerLabel}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="w-fit min-w-[180px] rounded-[8px] bg-[var(--bg-elevated)] py-1"
        >
          {visible.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                disabled={a.disabled}
                title={a.title}
                onClick={() => {
                  if (a.disabled) return;
                  a.onClick();
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--interactive-secondary)] disabled:cursor-not-allowed disabled:opacity-50',
                  a.danger
                    ? 'text-[var(--color-error)]'
                    : 'text-[var(--text-primary)]',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{a.label}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}
