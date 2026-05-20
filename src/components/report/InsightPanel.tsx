import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import {
  PRIORITY_STYLES,
  PRIORITY_DOT_COLORS,
  type ImpactSegment,
} from '@/features/evalRuns/components/report/shared/colors';

export interface InsightPanelItem {
  text: string;
  impacts?: ImpactSegment[];
}

export interface InsightPanelStat {
  label: string;
  value: string;
  success?: boolean;
}

export interface InsightPanelData {
  area: string;
  priority: string;
  runCount: number;
  items: InsightPanelItem[];
  stats?: InsightPanelStat[];
  footerImpacts?: ImpactSegment[];
}

interface Props extends InsightPanelData {
  /** Max items shown before collapse toggle. @default 3 */
  maxCollapsed?: number;
}

export default function InsightPanel({
  area,
  priority,
  runCount,
  items,
  stats,
  footerImpacts,
  maxCollapsed = 3,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = items.length > maxCollapsed;
  const visible = expanded ? items : items.slice(0, maxCollapsed);
  const hiddenCount = items.length - maxCollapsed;

  const accentColor = PRIORITY_DOT_COLORS[priority] ?? 'var(--text-muted)';
  const pStyle = PRIORITY_STYLES[priority];

  return (
    <div className="rounded-[var(--radius-default)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="h-0.5" style={{ backgroundColor: accentColor }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
        <span className="text-[13px] font-bold text-[var(--text-primary)] mr-auto truncate">
          {area}
        </span>

        {stats?.map((s, i) => (
          <span key={i} className="text-[11px] text-[var(--text-muted)] whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }}>
            <strong
              className={cn(
                'font-bold',
                s.success ? 'text-[var(--color-success)]' : 'text-[var(--text-secondary)]',
              )}
            >
              {s.value}
            </strong>{' '}{s.label}
          </span>
        ))}

        {pStyle && (
          <span
            className={cn(
              'text-[11px] font-medium px-1.5 py-px rounded-full border whitespace-nowrap',
              pStyle.bg, pStyle.border, pStyle.text,
            )}
          >
            {priority}
          </span>
        )}

        <span className="text-[11px] font-medium px-1.5 py-px rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] whitespace-nowrap">
          {runCount} {runCount === 1 ? 'run' : 'runs'}
        </span>
      </div>

      <div className="px-3">
        {visible.map((item, i) => (
          <div
            key={i}
            className={cn('py-[7px]', i < visible.length - 1 && 'border-b border-[var(--border-subtle)]')}
          >
            <div className="flex items-start gap-1.5">
              <span
                className="text-[10px] font-semibold text-[var(--text-muted)] min-w-[16px] shrink-0 leading-[1.55]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-[12px] text-[var(--text-secondary)] leading-[1.55]">
                {item.text}
              </span>
            </div>
            {item.impacts && item.impacts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 pl-[22px]">
                {item.impacts.map((seg, j) => (
                  <ImpactChip key={j} segment={seg} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 px-3 py-1 pb-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {expanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />
          }
          {expanded ? 'Show less' : `${hiddenCount} more`}
        </button>
      )}

      {footerImpacts && footerImpacts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)]">
          <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mr-0.5">
            Net impact
          </span>
          {footerImpacts.map((seg, j) => (
            <ImpactChip key={j} segment={seg} />
          ))}
        </div>
      )}
    </div>
  );
}

function ImpactChip({ segment }: { segment: ImpactSegment }) {
  const isDown = segment.arrow === '↓';
  const isUp = segment.arrow === '↑';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded-[var(--radius-sm)] whitespace-nowrap',
        isDown && 'bg-[var(--surface-success)] text-[var(--color-success)]',
        isUp && 'bg-[var(--surface-error)] text-[var(--color-error)]',
        !isDown && !isUp && 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
      )}
    >
      {segment.arrow && <span>{segment.arrow}{segment.count} </span>}
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{segment.label}</code>
    </span>
  );
}
