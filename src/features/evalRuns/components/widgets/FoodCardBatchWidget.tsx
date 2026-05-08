/**
 * FoodCardBatchWidget — read-only render of a multi-meal batch food card.
 * Upstream payload shape: { isBatch: true, sessions: FoodCard[] }
 * Stacks one FoodCardMessage per session and shows a single "Yes log all
 * meals" footer pill matching production Goodflip UI.
 */

import { FoodCardMessage } from '@/features/kaira/components/FoodCardMessage';
import type { FoodCard } from '@/types';
import { cn } from '@/utils';

interface Props {
  data: { isBatch?: boolean; sessions?: FoodCard[] } & Record<string, unknown>;
}

export function FoodCardBatchWidget({ data }: Props) {
  const sessions: FoodCard[] = Array.isArray(data.sessions) ? data.sessions : [];

  if (sessions.length === 0) {
    return (
      <div className="mt-3 max-w-md rounded-xl border bg-[var(--bg-primary)] p-3 text-[12px] text-[var(--text-muted)] border-[var(--border-subtle)]">
        Empty meal batch — no sessions to render.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-2">
        Meal batch · {sessions.length} sessions
      </div>
      {sessions.map((session, i) => (
        <FoodCardMessage
          key={`batch-${i}`}
          foodCard={session}
          status={undefined}
          onConfirm={() => undefined}
          onEdit={() => undefined}
          readOnly
        />
      ))}
      <div className="max-w-md flex gap-2 border-t border-[var(--border-subtle)] px-3 py-3 mt-1 rounded-xl border bg-[var(--bg-primary)]">
        <button
          type="button"
          disabled
          className={cn(
            'flex flex-1 items-center justify-center rounded-md px-3 py-2 text-[12px] font-semibold',
            'bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
            'cursor-not-allowed opacity-60',
          )}
        >
          Yes log all meals
        </button>
      </div>
    </div>
  );
}
