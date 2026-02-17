import { Link } from 'react-router-dom';
import { Trash2, Square, Clock } from 'lucide-react';
import VerdictBadge from './VerdictBadge';

export interface MetadataItem {
  icon?: React.ReactNode;
  text: string;
}

export interface RunRowCardProps {
  /** Link destination */
  to: string;
  /** Status string passed to VerdictBadge (e.g. "completed", "running", "success", "error") */
  status: string;
  /** Primary title text */
  title: string;
  /** If set, renders title as a colored tag instead of plain text */
  titleColor?: string;
  /** Optional score display next to title */
  score?: string;
  /** Color for score text */
  scoreColor?: string;
  /** Short ID hash displayed in metadata row */
  id: string;
  /** Metadata items for the second row (icon + text pairs, separated by dots) */
  metadata?: MetadataItem[];
  /** Relative time string shown at far right of metadata row */
  timeAgo: string;
  /** Whether a spinner should be shown */
  isRunning?: boolean;
  /** Cancel/stop handler — shows stop button when provided and isRunning */
  onCancel?: () => void;
  /** Whether the cancel button is disabled */
  cancelDisabled?: boolean;
  /** Delete handler — shows trash icon on hover */
  onDelete?: () => void;
  /** Whether the delete button is disabled */
  deleteDisabled?: boolean;
}

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
}: RunRowCardProps) {
  return (
    <div className="group relative">
      <Link
        to={to}
        className="block bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3.5 py-2.5 hover:border-[var(--border-focus)] transition-colors"
      >
        {/* Row 1: Status + Title + Score + Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <VerdictBadge verdict={status} category="status" />
            {titleColor ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: `color-mix(in srgb, ${titleColor} 15%, transparent)`,
                  color: titleColor,
                }}
              >
                {title}
              </span>
            ) : (
              <span className="font-semibold text-[13px] text-[var(--text-primary)] truncate">
                {title}
              </span>
            )}
            {score && (
              <span
                className="text-[13px] font-semibold"
                style={{ color: scoreColor || 'var(--text-muted)' }}
              >
                {score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isRunning && (
              <>
                <div className="h-6 w-6 flex items-center justify-center">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-info)] border-t-transparent" />
                </div>
                {onCancel && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
                    disabled={cancelDisabled}
                    className="h-6 w-6 p-0 flex items-center justify-center text-[var(--color-error)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    title="Stop run"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                  </button>
                )}
              </>
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

        {/* Row 2: ID + metadata + time */}
        <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-muted)]">
          <span className="font-mono">{id}</span>
          {metadata.map((item, i) => (
            <span key={i} className="flex items-center gap-1">
              {item.icon}
              {item.text}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgoStr}
          </span>
        </div>
      </Link>
    </div>
  );
}
