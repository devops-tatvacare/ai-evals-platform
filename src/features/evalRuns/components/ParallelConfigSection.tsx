import { cn } from '@/utils';

interface ParallelConfigSectionProps {
  parallel: boolean;
  workers: number;
  onParallelChange: (v: boolean) => void;
  onWorkersChange: (v: number) => void;
  label: string;
  description: string;
}

export function ParallelConfigSection({
  parallel,
  workers,
  onParallelChange,
  onWorkersChange,
  label,
  description,
}: ParallelConfigSectionProps) {
  return (
    <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
        <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          {label}
        </h3>
      </div>
      <div className="px-4 py-3 space-y-3">
        <label className="flex items-center justify-between">
          <div className="flex-1 min-w-0 mr-3">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Enable Parallelism
            </span>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {description}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={parallel}
            onClick={() => onParallelChange(!parallel)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
              parallel ? 'bg-[var(--interactive-primary)]' : 'bg-[var(--border-default)]',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
                parallel ? 'translate-x-[18px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </label>

        {parallel && (
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--text-secondary)] shrink-0">Workers</span>
            <input
              type="range"
              min={2}
              max={10}
              value={workers}
              onChange={(e) => onWorkersChange(Number(e.target.value))}
              className="flex-1 h-1.5 accent-[var(--interactive-primary)]"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)] w-6 text-center tabular-nums">
              {workers}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
