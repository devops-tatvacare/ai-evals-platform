/**
 * Action Buttons Component
 * Renders action buttons parsed from API responses
 */

import { useCallback } from 'react';
import { cn } from '@/utils';
import type { ActionButton } from '@/services/actions';

interface ActionButtonsProps {
  actions: ActionButton[];
  onAction?: (buttonId: string, buttonLabel: string) => void;
  disabled?: boolean;
}

/**
 * Render a single action button
 */
function Button({
  action,
  onClick,
  disabled = false,
}: {
  action: ActionButton;
  onClick?: (id: string, label: string) => void;
  disabled?: boolean;
}) {
  const handleClick = useCallback(() => {
    if (disabled) return;
    onClick?.(action.id, action.label);
  }, [action.id, action.label, onClick, disabled]);

  const isPrimary = action.variant === 'primary';
  const isSecondary = action.variant === 'secondary';

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-brand-accent)]',
        !disabled && 'hover:shadow-sm active:scale-[0.98]',
        disabled && 'cursor-not-allowed opacity-40',
        isPrimary && !disabled && [
          'bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
          'hover:bg-[var(--interactive-primary-hover)]',
          'active:bg-[var(--interactive-primary-active)]',
        ],
        isPrimary && disabled && [
          'bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
        ],
        isSecondary && !disabled && [
          'bg-[var(--bg-primary)] text-[var(--interactive-primary)]',
          'border border-[var(--interactive-primary)]',
          'hover:bg-[var(--interactive-primary)]/10',
          'active:bg-[var(--interactive-primary)]/20',
        ],
        isSecondary && disabled && [
          'bg-[var(--bg-primary)] text-[var(--interactive-primary)]',
          'border border-[var(--interactive-primary)]',
        ],
        !isPrimary && !isSecondary && !disabled && [
          'bg-[var(--interactive-secondary)] text-[var(--text-primary)] border border-[var(--border-default)]',
          'hover:bg-[var(--interactive-secondary-hover)] hover:border-[var(--border-focus)]',
        ],
        !isPrimary && !isSecondary && disabled && [
          'bg-[var(--interactive-secondary)] text-[var(--text-primary)] border border-[var(--border-default)]',
        ]
      )}
    >
      {action.label}
    </button>
  );
}

/**
 * Render action buttons
 */
export function ActionButtons({ actions, onAction, disabled = false }: ActionButtonsProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {actions.map((action) => (
        <Button
          key={action.id}
          action={action}
          onClick={onAction}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
