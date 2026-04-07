import { cn } from '@/utils/cn';

interface Dimension {
  key: string;
  label: string;
  avg: number;
  maxPossible: number;
  greenThreshold: number;
  yellowThreshold: number;
}

interface Props {
  dimensions: Dimension[];
  className?: string;
}

function getBarColor(avg: number, green: number, yellow: number): string {
  if (avg >= green) return 'var(--color-success)';
  if (avg >= yellow) return 'var(--color-warning)';
  return 'var(--color-error)';
}

export function DimensionBreakdownChart({ dimensions, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {dimensions.map((d) => (
        <div key={d.key} className="flex items-center gap-3">
          <span className="text-sm w-48 flex-shrink-0 truncate" title={d.label}>
            {d.label}
          </span>
          <div className="flex-1 h-6 bg-[var(--bg-secondary)] rounded-md overflow-hidden">
            <div
              className="h-full rounded-md transition-all"
              style={{
                width: `${(d.avg / d.maxPossible) * 100}%`,
                backgroundColor: getBarColor(d.avg, d.greenThreshold, d.yellowThreshold),
              }}
            />
          </div>
          <span className="text-sm font-semibold w-14 text-right">
            {d.avg} / {d.maxPossible}
          </span>
        </div>
      ))}
    </div>
  );
}
