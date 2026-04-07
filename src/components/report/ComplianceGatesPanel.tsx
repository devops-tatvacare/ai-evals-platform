import { cn } from '@/utils/cn';

interface Gate {
  key: string;
  label: string;
  passed: number;
  failed: number;
  total: number;
}

interface Props {
  gates: Gate[];
  className?: string;
}

function gateColor(rate: number): string {
  if (rate >= 95) return 'var(--color-success)';
  if (rate >= 85) return 'var(--color-warning)';
  return 'var(--color-error)';
}

export function ComplianceGatesPanel({ gates, className }: Props) {
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {gates.map((g) => {
        const rate = g.total > 0 ? (g.passed / g.total) * 100 : 100;
        const color = gateColor(rate);
        return (
          <div key={g.key} className="bg-[var(--bg-primary)] p-3.5 rounded-lg border border-[var(--border)]">
            <div className="flex justify-between items-center">
              <span className="text-sm">{g.label}</span>
              <span className="text-sm font-bold" style={{ color }}>{rate.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full mt-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${rate}%`, backgroundColor: color }}
              />
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-1">
              {g.passed}/{g.total} passed · {g.failed} violations
            </div>
          </div>
        );
      })}
    </div>
  );
}
