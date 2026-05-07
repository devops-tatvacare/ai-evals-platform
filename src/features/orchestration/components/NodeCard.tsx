import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { getCategoryDef } from '@/features/orchestration/config/categories';
import { cn } from '@/utils';

export type NodeCardVariant = 'canvas' | 'palette';

interface NodeCardProps {
  label: string;
  /** Short blurb shown under the title in `canvas` variant. Surfaced as a
   *  tooltip in `palette` variant to keep the rail dense. */
  description?: string;
  /** Mono subtitle shown when `description` is empty (canvas only). */
  fallbackSubtitle?: string;
  category: string;
  /** `canvas` (default): full category bar + label + description. Used
   *  on the React Flow canvas. `palette`: dense single-line tile with a
   *  category-colored left rail + inline icon + label. Used in the
   *  builder's left rail. Both share the same category tokens — see
   *  `categories.ts`. */
  variant?: NodeCardVariant;
  selected?: boolean;
  /** Right-aligned slot inside the canvas-variant category bar. Used by
   *  the run canvas to render an inline status pill. */
  barTrailing?: ReactNode;
  /** Slot rendered below the description (canvas only). Used by the run
   *  canvas to render a cohort-size badge. */
  footer?: ReactNode;
  /** Layout for React Flow handles. Only set on the canvas — palette
   *  tiles pass nothing. */
  handles?: ReactNode;
  /** When set, renders a small X button in the top-right of the canvas
   *  card. Wires through to `useWorkflowBuilderStore.removeNode` from
   *  the call site (`CustomNode`). Palette tiles never set this. */
  onDelete?: () => void;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  title?: string;
  className?: string;
}

/** Single source of truth for node-card visuals. Both the on-canvas node
 *  and the palette tile compose this primitive — never restyle node
 *  visuals at the call site. To change a category color, update
 *  `categories.ts`; to change layout, update this file. */
export function NodeCard({
  label,
  description,
  fallbackSubtitle,
  category,
  variant = 'canvas',
  selected = false,
  barTrailing,
  footer,
  handles,
  onDelete,
  onClick,
  draggable,
  onDragStart,
  title,
  className,
}: NodeCardProps) {
  const cat = getCategoryDef(category);
  const Icon = cat.icon;

  if (variant === 'palette') {
    // Soft category-surface fill + small icon square + two-line stack
    // (label + truncated description). No heavy border. ~46px tall —
    // legible without crowding the rail.
    return (
      <div
        onClick={onClick}
        draggable={draggable}
        onDragStart={onDragStart}
        title={title ?? description}
        className={cn(
          'group relative flex cursor-grab items-start gap-2 overflow-hidden',
          'rounded-[var(--radius-default)] border border-transparent',
          'px-2.5 py-1.5 transition-colors hover:border-[var(--border-subtle)]',
          className,
        )}
        style={{ backgroundColor: cat.surfaceVar }}
      >
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px]"
          style={{ backgroundColor: cat.iconBgVar }}
        >
          <Icon className="h-3 w-3" style={{ color: 'var(--text-on-color)' }} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium leading-tight text-[var(--text-primary)]">
            {label}
          </span>
          {description ? (
            <span className="truncate text-[11px] leading-snug text-[var(--text-secondary)]">
              {description}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      title={title}
      className={cn(
        'group relative min-w-[220px] max-w-[280px] overflow-visible rounded-[var(--radius-default)] border-2',
        'bg-[var(--bg-elevated)] shadow-sm transition-shadow',
        selected ? 'ring-2 ring-[var(--color-brand-accent)]/30' : 'hover:shadow-md',
        className,
      )}
      style={{ borderColor: selected ? 'var(--color-brand-accent)' : cat.accentVar }}
    >
      {handles}

      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Remove node from canvas"
          className="absolute right-1 top-1 z-10 rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}

      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ backgroundColor: cat.surfaceVar }}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ backgroundColor: cat.iconBgVar }}
        >
          <Icon className="h-3 w-3" style={{ color: 'var(--text-on-color)' }} />
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: cat.accentVar }}
        >
          {cat.label}
        </span>
        {barTrailing ? (
          <span className="ml-auto flex items-center">{barTrailing}</span>
        ) : null}
      </div>

      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold leading-tight text-[var(--text-primary)]">
          {label}
        </p>
        {description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">
            {description}
          </p>
        ) : fallbackSubtitle ? (
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-muted)]">
            {fallbackSubtitle}
          </p>
        ) : null}
        {footer}
      </div>
    </div>
  );
}
