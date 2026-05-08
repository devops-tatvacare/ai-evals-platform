/**
 * Food Card Message
 * Renders a structured food-logging card emitted by the Kaira API
 * (`food_card` SSE chunk) with confirm / edit action buttons.
 *
 * Wire format on confirm:
 *   message = "update_meal & log_meal - <JSON.stringify([foodCard])>"
 */

import { Leaf, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/utils';
import type { FoodCard, FoodCardItem } from '@/types';

interface FoodCardMessageProps {
  foodCard: FoodCard;
  status?: 'pending' | 'logged' | 'failed';
  onConfirm: () => void;
  onEdit: () => void;
  /**
   * Read-only mode for transcript viewers (adversarial detail page). When
   * true, action buttons render but are visually disabled and onConfirm/onEdit
   * are never invoked. Live chat should leave this unset.
   */
  readOnly?: boolean;
}

interface MacroTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

function aggregateMacros(items: FoodCardItem[]): MacroTotals {
  return items.reduce<MacroTotals>(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      protein_g: acc.protein_g + item.protein_g,
      carbs_g: acc.carbs_g + item.carbs_g,
      fat_g: acc.fat_g + item.fat_g,
      fiber_g: acc.fiber_g + item.fiber_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );
}

function formatMacro(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function MacroCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[15px] font-bold text-[var(--text-primary)]">
        {formatMacro(value)}<span className="text-[11px] font-medium text-[var(--text-muted)]">g</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

export function FoodCardMessage({
  foodCard,
  status,
  onConfirm,
  onEdit,
  readOnly = false,
}: FoodCardMessageProps) {
  const totals = aggregateMacros(foodCard.items);
  const headerName =
    foodCard.items.length === 1 ? foodCard.items[0].name : 'Meal';
  const isTerminal = status === 'logged' || status === 'failed';
  const isPending = status === 'pending';
  const buttonsDisabled = isPending || readOnly;
  const handleConfirm = readOnly ? () => undefined : onConfirm;
  const handleEdit = readOnly ? () => undefined : onEdit;

  return (
    <div
      className={cn(
        'mt-3 max-w-md rounded-xl border bg-[var(--bg-primary)] overflow-hidden',
        status === 'logged'
          ? 'border-[var(--color-success)]/40'
          : status === 'failed'
            ? 'border-[var(--color-error)]/40'
            : 'border-[var(--border-subtle)]',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-[var(--text-brand)]" />
          <span className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">
            {headerName}
          </span>
        </div>
        <span className="rounded-full bg-[var(--interactive-primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--text-brand)]">
          {foodCard.consumed_label}
        </span>
      </div>

      {/* Calories */}
      <div className="flex flex-col items-center pt-2 pb-3">
        <div className="text-[40px] font-bold leading-none text-[var(--text-brand)]">
          {formatMacro(totals.kcal)}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
          Calories
        </div>
      </div>

      {/* Macros grid */}
      <div className="grid grid-cols-4 gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
        <MacroCell label="Protein" value={totals.protein_g} />
        <MacroCell label="Carbs" value={totals.carbs_g} />
        <MacroCell label="Fat" value={totals.fat_g} />
        <MacroCell label="Fiber" value={totals.fiber_g} />
      </div>

      {/* Footer: action buttons or terminal-state banner */}
      {isTerminal ? (
        <FoodCardFooter status={status} />
      ) : (
        <div className="flex gap-2 border-t border-[var(--border-subtle)] px-3 py-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={buttonsDisabled}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-brand-accent)]',
              'bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
              !buttonsDisabled && 'hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
              buttonsDisabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? 'Logging…' : 'Yes log this meal'}
          </button>
          <button
            type="button"
            onClick={handleEdit}
            disabled
            title="Edit flow coming soon"
            className={cn(
              'flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors',
              'border-[var(--interactive-primary)] bg-[var(--bg-primary)] text-[var(--interactive-primary)]',
              'cursor-not-allowed opacity-40',
            )}
          >
            No edit this meal
          </button>
        </div>
      )}
    </div>
  );
}

function FoodCardFooter({ status }: { status: 'logged' | 'failed' }) {
  if (status === 'logged') {
    return (
      <div className="flex items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--color-success)]/10 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
        <span className="text-[12px] font-medium text-[var(--color-success)]">
          Meal logged successfully!
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--color-error)]/10 px-3 py-2.5">
      <XCircle className="h-4 w-4 text-[var(--color-error)]" />
      <span className="text-[12px] font-medium text-[var(--color-error)]">
        Failed to log meal
      </span>
    </div>
  );
}
