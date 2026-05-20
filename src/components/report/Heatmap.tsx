import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { EmptyState } from '@/components/ui';

export type HeatmapTier = 'critical' | 'low' | 'mid' | 'good' | 'great' | 'neutral';

export interface HeatmapColumn {
  id: string;
  label: string;
  sublabel?: string | null;
}

export interface HeatmapCell {
  value: number | null;
  /** Optional explicit tier — overrides the value-derived tier. */
  tier?: HeatmapTier | null;
  /** Optional display label that replaces the formatted numeric value. */
  display?: string | null;
  subtitle?: string | null;
}

export interface HeatmapRow {
  id: string;
  label: string;
  sublabel?: string | null;
  cells: HeatmapCell[];
  /** Optional trailing cell (e.g. row average). When omitted, no trailing column renders. */
  trailing?: HeatmapCell | null;
}

export interface HeatmapProps {
  columns: HeatmapColumn[];
  rows: HeatmapRow[];
  /** Header label for the row-name column (left, sticky). */
  rowHeaderLabel?: string;
  /** Header label for the optional trailing column (right). Only used when at least one row has `trailing`. */
  trailingLabel?: string;
  /** Default numeric formatter when a cell has `value` but no `display`. */
  format?: (value: number) => string;
  /** Convert a value into a tier when `cell.tier` is not provided. Defaults to a 0..1 rate scale matching the platform palette. */
  tierForValue?: (value: number) => HeatmapTier;
  onColumnClick?: (id: string) => void;
  onRowClick?: (id: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

const TIER_BG: Record<HeatmapTier, string> = {
  critical: 'var(--heatmap-critical-bg)',
  low: 'var(--heatmap-low-bg)',
  mid: 'var(--heatmap-mid-bg)',
  good: 'var(--heatmap-good-bg)',
  great: 'var(--heatmap-great-bg)',
  neutral: 'var(--heatmap-null-bg)',
};

const TIER_TEXT: Record<HeatmapTier, string> = {
  critical: 'var(--heatmap-critical-text)',
  low: 'var(--heatmap-low-text)',
  mid: 'var(--heatmap-mid-text)',
  good: 'var(--heatmap-good-text)',
  great: 'var(--heatmap-great-text)',
  neutral: 'var(--heatmap-null-text)',
};

function defaultTierForValue(value: number): HeatmapTier {
  // Default scale assumes a 0..1 rate (the legacy cross-run usage). Values
  // expressed on a 0..100 scale are normalised below.
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.85) return 'great';
  if (v >= 0.7) return 'good';
  if (v >= 0.5) return 'mid';
  if (v >= 0.3) return 'low';
  return 'critical';
}

function defaultFormat(value: number): string {
  if (Number.isFinite(value) && Math.abs(value) <= 1) return `${Math.round(value * 100)}%`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function tierFor(cell: HeatmapCell, tierForValue: (v: number) => HeatmapTier): HeatmapTier {
  if (cell.tier) return cell.tier;
  if (cell.value == null) return 'neutral';
  return tierForValue(cell.value);
}

function displayFor(cell: HeatmapCell, format: (v: number) => string): string {
  if (cell.display !== null && cell.display !== undefined) return cell.display;
  if (cell.value == null) return '—';
  return format(cell.value);
}

export function Heatmap({
  columns,
  rows,
  rowHeaderLabel = 'Row',
  trailingLabel = 'Avg',
  format = defaultFormat,
  tierForValue = defaultTierForValue,
  onColumnClick,
  onRowClick,
  emptyTitle = 'No data',
  emptyDescription = 'No values were available for this heatmap.',
  className,
}: HeatmapProps) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  if (rows.length === 0 || columns.length === 0) {
    return <EmptyState icon={BarChart3} title={emptyTitle} description={emptyDescription} compact />;
  }

  const hasTrailing = rows.some((row) => row.trailing);
  const rotateHeaders = columns.length > 8;
  const trailingColTemplate = hasTrailing ? ' 72px' : '';

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]', className)}>
      <div
        className="min-w-fit text-[var(--text-primary)]"
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(160px, 200px) repeat(${columns.length}, minmax(56px, 1fr))${trailingColTemplate}`,
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="sticky left-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {rowHeaderLabel}
        </div>
        {columns.map((col, colIdx) => {
          const isHoveredCol = hover?.col === colIdx;
          return (
            <button
              key={col.id}
              type="button"
              onClick={onColumnClick ? () => onColumnClick(col.id) : undefined}
              title={col.sublabel ? `${col.label} · ${col.sublabel}` : col.label}
              className={cn(
                'border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-2 text-center transition-colors',
                onColumnClick && 'cursor-pointer hover:bg-[var(--bg-tertiary)]',
                isHoveredCol && 'bg-[var(--bg-tertiary)]',
              )}
            >
              <div
                className={cn('truncate text-[10px] font-medium text-[var(--text-secondary)]', rotateHeaders && 'inline-block')}
                style={rotateHeaders ? { writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: 80 } : undefined}
              >
                {col.label}
              </div>
              {col.sublabel && !rotateHeaders ? (
                <div className="truncate text-[9px] text-[var(--text-muted)]">{col.sublabel}</div>
              ) : null}
            </button>
          );
        })}
        {hasTrailing ? (
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {trailingLabel}
          </div>
        ) : null}

        {rows.map((row, rowIdx) => {
          const isHoveredRow = hover?.row === rowIdx;
          return (
            <HeatmapRowFragment
              key={row.id}
              row={row}
              rowIdx={rowIdx}
              columns={columns}
              format={format}
              tierForValue={tierForValue}
              isHoveredRow={isHoveredRow}
              hover={hover}
              onHover={setHover}
              onRowClick={onRowClick}
              hasTrailing={hasTrailing}
            />
          );
        })}
      </div>
    </div>
  );
}

interface HeatmapRowFragmentProps {
  row: HeatmapRow;
  rowIdx: number;
  columns: HeatmapColumn[];
  format: (value: number) => string;
  tierForValue: (value: number) => HeatmapTier;
  isHoveredRow: boolean;
  hover: { row: number; col: number } | null;
  onHover: (next: { row: number; col: number } | null) => void;
  onRowClick?: (id: string) => void;
  hasTrailing: boolean;
}

function HeatmapRowFragment({
  row,
  rowIdx,
  columns,
  format,
  tierForValue,
  isHoveredRow,
  hover,
  onHover,
  onRowClick,
  hasTrailing,
}: HeatmapRowFragmentProps) {
  return (
    <>
      <button
        type="button"
        onClick={onRowClick ? () => onRowClick(row.id) : undefined}
        title={row.sublabel ? `${row.label} · ${row.sublabel}` : row.label}
        className={cn(
          'sticky left-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-left transition-colors',
          onRowClick && 'cursor-pointer hover:bg-[var(--bg-tertiary)]',
          isHoveredRow && 'bg-[var(--bg-tertiary)]',
        )}
      >
        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{row.label}</div>
        {row.sublabel ? <div className="truncate text-[10px] text-[var(--text-muted)]">{row.sublabel}</div> : null}
      </button>

      {row.cells.slice(0, columns.length).map((cell, colIdx) => {
        const tier = tierFor(cell, tierForValue);
        const isHovered = hover?.row === rowIdx && hover?.col === colIdx;
        return (
          <div
            key={colIdx}
            className={cn(
              'relative flex items-center justify-center border-b border-[var(--border-subtle)] px-2 py-2 transition-shadow',
              isHovered && 'shadow-[inset_0_0_0_2px_var(--color-brand-accent)] z-20',
            )}
            style={{ backgroundColor: TIER_BG[tier] }}
            onMouseEnter={() => onHover({ row: rowIdx, col: colIdx })}
            title={cell.subtitle ?? undefined}
          >
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: TIER_TEXT[tier] }}>
              {displayFor(cell, format)}
            </span>
          </div>
        );
      })}

      {hasTrailing ? (
        <div className="flex items-center justify-center border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
          {row.trailing ? (
            <span
              className="text-[11px] font-bold tabular-nums"
              style={{ color: TIER_TEXT[tierFor(row.trailing, tierForValue)] }}
            >
              {displayFor(row.trailing, format)}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">—</span>
          )}
        </div>
      ) : null}
    </>
  );
}

export default Heatmap;
