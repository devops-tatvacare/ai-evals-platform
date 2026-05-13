/**
 * MQL Signal Score badge — shows N/5 with 5 dots and a hover tooltip
 * listing each signal as met (●) or not (○).
 */
import { cn } from '@/utils';
import { Tooltip } from '@/components/ui';

const SIGNAL_LABELS: Record<string, string> = {
  age: 'Age in range',
  city: 'City',
  condition: 'Condition',
  hba1c: 'HbA1c',
  intent: 'Intent to pay',
};

const SIGNAL_ORDER = ['age', 'city', 'condition', 'hba1c', 'intent'];

interface MqlScoreBadgeProps {
  score: number;
  signals: Record<string, boolean>;
  className?: string;
}

export function MqlScoreBadge({ score, signals, className }: MqlScoreBadgeProps) {
  const isMql = score === 5;
  const isNear = score === 4;

  const badgeColor = isMql
    ? 'text-emerald-400'
    : isNear
    ? 'text-amber-400'
    : 'text-[var(--text-muted)]';

  const tooltipContent = (
    <div className="flex flex-col gap-1">
      {SIGNAL_ORDER.map((key) => {
        const met = signals[key] ?? false;
        return (
          <span key={key} className={cn('text-[11px]', met ? 'text-emerald-400' : 'text-[var(--text-muted)]')}>
            {met ? '●' : '○'} {SIGNAL_LABELS[key] ?? key}
          </span>
        );
      })}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} position="top">
      <span className={cn('inline-flex items-center gap-1 cursor-default', className)}>
        {/* Score text */}
        <span className={cn('text-xs font-semibold tabular-nums', badgeColor)}>
          {score}/5
        </span>

        {/* Dot strip */}
        <span className="inline-flex gap-0.5">
          {SIGNAL_ORDER.map((key) => (
            <span
              key={key}
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                (signals[key] ?? false)
                  ? isMql
                    ? 'bg-emerald-400'
                    : isNear
                    ? 'bg-amber-400'
                    : 'bg-[var(--color-brand-accent)]'
                  : 'bg-[var(--border-default)]'
              )}
            />
          ))}
        </span>
      </span>
    </Tooltip>
  );
}
