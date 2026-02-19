import { Link } from 'react-router-dom';
import { Trash2, Square, Clock } from 'lucide-react';
import { ModelBadge } from '@/components/ui';
import type { RunType } from '../types';
import { RUN_TYPE_CONFIG } from '../types';

export interface MetadataItem {
  icon?: React.ReactNode;
  text: string;
}

export interface RunRowCardProps {
  to: string;
  status: string;
  title: string;
  titleColor?: string;
  score?: string;
  scoreColor?: string;
  id: string;
  metadata?: MetadataItem[];
  timeAgo: string;
  isRunning?: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  runType?: RunType;
  modelName?: string;
  provider?: string;
  progress?: { current: number; total: number };
}

/* ── Inline sub-components ───────────────────────────────── */

const STATUS_STYLES: Record<string, { color: string; dot: string; pulseClass?: string }> = {
  completed:   { color: 'var(--color-success)', dot: 'var(--color-success)' },
  success:     { color: 'var(--color-success)', dot: 'var(--color-success)' },
  partial:     { color: 'var(--color-warning)', dot: 'var(--color-warning)' },
  completed_with_errors: { color: 'var(--color-warning)', dot: 'var(--color-warning)' },
  cancelled:   { color: 'var(--color-warning)', dot: 'var(--color-warning)' },
  failed:      { color: 'var(--color-error)',   dot: 'var(--color-error)' },
  error:       { color: 'var(--color-error)',   dot: 'var(--color-error)' },
  running:     { color: 'var(--color-info)',    dot: 'var(--color-info)', pulseClass: 'animate-pulse' },
  pending:     { color: 'var(--text-muted)',    dot: 'var(--text-muted)' },
};

function StatusOutlineBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.pending;
  const label = key === 'completed_with_errors' ? 'Partial' : key.charAt(0).toUpperCase() + key.slice(1);

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
      style={{ borderColor: style.color, color: style.color }}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${style.pulseClass ?? ''}`}
        style={{ backgroundColor: style.dot }}
      />
      {label}
    </span>
  );
}

function TypeBadge({ runType }: { runType: RunType }) {
  const config = RUN_TYPE_CONFIG[runType];
  return (
    <span
      className="inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-white whitespace-nowrap"
      style={{ backgroundColor: config.color }}
    >
      {config.label}
    </span>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 rounded-full mt-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: 'var(--color-info)' }}
      />
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export default function RunRowCard({
  to,
  status,
  title,
  titleColor,
  score,
  scoreColor,
  id,
  metadata = [],
  timeAgo: timeAgoStr,
  isRunning,
  onCancel,
  cancelDisabled,
  onDelete,
  deleteDisabled,
  runType,
  modelName,
  provider,
  progress,
}: RunRowCardProps) {
  const accentColor = runType ? RUN_TYPE_CONFIG[runType].color : 'var(--border-subtle)';

  return (
    <div className="group relative">
      <Link
        to={to}
        className="relative block overflow-hidden bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg pl-4 pr-4 py-3 hover:border-[var(--border-focus)] transition-colors"
      >
        {/* Left accent stripe */}
        <span
          className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-lg"
          style={{ backgroundColor: accentColor }}
        />

        {/* Two-column layout: badges (left, fixed width) | content (right) */}
        <div className="flex gap-4">
          {/* Left column: fixed-width stacked badges */}
          <div className="flex flex-col items-start gap-1.5 shrink-0 w-[120px] pt-0.5">
            {runType && <TypeBadge runType={runType} />}
            <StatusOutlineBadge status={status} />
          </div>

          {/* Right column: title, ID, separator, metadata */}
          <div className="flex-1 min-w-0">
            {/* Line 1: Title + score ... time-ago */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 pt-0.5">
                {titleColor ? (
                  <span
                    className="font-semibold text-[14px] truncate"
                    style={{ color: titleColor }}
                  >
                    {title}
                  </span>
                ) : (
                  <span className="font-semibold text-[14px] text-[var(--text-primary)] truncate">
                    {title}
                  </span>
                )}
                {score && (
                  <span
                    className="text-[13px] font-semibold whitespace-nowrap"
                    style={{ color: scoreColor || 'var(--text-muted)' }}
                  >
                    {score}
                  </span>
                )}
              </div>
              <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] whitespace-nowrap shrink-0 pt-0.5">
                <Clock className="h-3 w-3" />
                {timeAgoStr}
              </span>
            </div>

            {/* Line 2: ID hash */}
            <div className="mt-0.5">
              <span className="font-mono text-[11px] text-[var(--text-muted)]">{id}</span>
            </div>

            {/* Separator */}
            <div className="border-t border-[var(--border-subtle)] my-2" />

            {/* Line 3: Metadata + actions at far right */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] min-w-0">
                {metadata.map((item, i) => (
                  <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                    {item.icon}
                    {item.text}
                  </span>
                ))}
                {modelName && (
                  <ModelBadge
                    modelName={modelName}
                    provider={provider as any}
                    variant="inline"
                  />
                )}
              </div>

              {/* Bottom-right actions: cancel + delete */}
              <div className="flex items-center gap-1 shrink-0">
                {isRunning && onCancel && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
                    disabled={cancelDisabled}
                    className="h-6 w-6 p-0 flex items-center justify-center text-[var(--color-error)] bg-[var(--color-error)]/10 hover:bg-[var(--color-error)]/20 rounded transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    title="Stop run"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
                    disabled={deleteDisabled || isRunning}
                    className="p-1 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    title={isRunning ? 'Stop the run before deleting' : 'Delete run'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar (running jobs only) — full width at bottom */}
        {isRunning && progress && (
          <ProgressBar current={progress.current} total={progress.total} />
        )}
      </Link>
    </div>
  );
}
