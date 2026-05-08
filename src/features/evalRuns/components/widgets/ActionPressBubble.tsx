/**
 * ActionPressBubble — chip/pill rendered on the user side of an adversarial
 * transcript turn when the simulator auto-confirmed via a widget button.
 *
 * Visually distinct from a typed-text bubble so engineering can see at a
 * glance that the simulator clicked a button (matching production Goodflip
 * behavior) rather than free-typing the action grammar.
 */

import { MousePointerClick } from 'lucide-react';
import { cn } from '@/utils';

interface Props {
  label: string;
  kind: string;
}

export function ActionPressBubble({ label, kind }: Props) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold',
          'border-[var(--interactive-primary)] bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
          'shadow-[0_0_0_2px_var(--surface-info)]',
        )}
        title={`Simulator pressed: ${label} (${kind})`}
      >
        <MousePointerClick className="h-3.5 w-3.5" />
        <span>{label}</span>
        <span className="ml-1 rounded bg-[var(--bg-primary)]/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
          tapped
        </span>
      </div>
    </div>
  );
}
