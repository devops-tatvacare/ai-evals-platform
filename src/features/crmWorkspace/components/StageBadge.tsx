import { cn } from '@/utils';

const STAGE_COLORS: Record<string, string> = {
  'new lead': 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
  'call back': 'bg-amber-500/15 text-amber-400',
  'rnr': 'bg-orange-500/15 text-orange-400',
  'interested in future plan': 'bg-blue-500/15 text-blue-400',
  'not interested': 'bg-red-500/15 text-red-400',
  'converted': 'bg-emerald-500/15 text-emerald-400',
  'invalid / junk': 'bg-[var(--bg-secondary)] text-[var(--text-muted)]',
  're-enquired': 'bg-purple-500/15 text-purple-400',
};

/** Pill badge showing a lead's CRM stage. */
export function StageBadge({ stage, truncate = true }: { stage: string; truncate?: boolean }) {
  const key = stage.toLowerCase();
  const colorClass = STAGE_COLORS[key] ?? 'bg-[var(--bg-secondary)] text-[var(--text-muted)]';
  // Shorten "Interested In Future Plan" → "Interested" in compact contexts
  const label = truncate ? (stage.replace(/in future plan/i, '').trim() || stage) : stage;
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', colorClass)}>
      {label}
    </span>
  );
}
