/**
 * Phase 4.6B — width-aware chart layout helper.
 *
 * Pure module that centralizes layout decisions (height, y-axis width,
 * bottom/left margins, legend placement) currently scattered across
 * `ChartRenderer`, `ChatChartCard`, `ChartDetailView`, and `DashboardView`.
 *
 * Treats **surface** and **measured container width** as primary inputs so
 * charts rebalance when a card/tile width changes. Named width buckets
 * replace the old hardcoded 90/120/280/300/500 values.
 *
 * No DOM access here — consumers own measurement and pass `width`. Keeps the
 * module trivially testable with Vitest.
 */

import type { RechartsChartType } from './vegaLiteToRecharts';

export type ChartSurface =
  | 'chat'
  | 'detail'
  | 'dashboard-full'
  | 'dashboard-half';

export type ChartWidthBucket = 'xs' | 'sm' | 'md' | 'lg';

export interface ChartLayoutInput {
  surface: ChartSurface;
  type: RechartsChartType | string;
  /** Number of rows in the result — drives vertical bar height scaling. */
  dataCount: number;
  /**
   * Measured container width in pixels. When omitted, the helper uses a
   * surface-default so tests and non-measuring callers still work.
   */
  width?: number;
  /** Chat surface compact mode — smaller ticks, tighter gutters. */
  compact?: boolean;
}

export interface ChartLayoutOutput {
  /** Height to pass to `<ChartRenderer height={...} />`. */
  height: number;
  /** Width bucket derived from `width` (or surface default). */
  widthBucket: ChartWidthBucket;
  /** Y-axis category-label reserved width (horizontal bars + narrow vertical). */
  yAxisWidth: number;
  /** Legend placement suggestion. */
  legendPosition: 'top' | 'bottom' | 'right' | 'none';
  /** Margins consumed by ChartRenderer's `commonMargin`. */
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Tick font size. */
  tickFontSize: number;
  /** Whether to truncate long x-axis tick labels. */
  truncateXTicks: boolean;
  /** Character cap for x-axis tick truncation. */
  xTickCharCap: number;
  /**
   * Recharts XAxis `interval` value: `0` shows every label; `N` shows every
   * `(N+1)`th label and hides the rest. Derived from measured width + data
   * count so labels sparse out on narrow widgets and fill in as the chart
   * widens.
   */
  xTickInterval: number;
}

// ── Width buckets ────────────────────────────────────────────────────
//
// Bucket boundaries chosen to correspond to how ChartRenderer actually
// behaves: below ~360px a vertical bar chart must rotate labels; below
// ~540px the y-axis label should go; above ~720px we can afford a larger
// left gutter for explicit titles.
const BUCKET_XS = 360;
const BUCKET_SM = 540;
const BUCKET_MD = 720;

export function widthBucketFor(width: number | undefined, surface: ChartSurface): ChartWidthBucket {
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    if (width < BUCKET_XS) return 'xs';
    if (width < BUCKET_SM) return 'sm';
    if (width < BUCKET_MD) return 'md';
    return 'lg';
  }
  // Defaults when no measurement is available.
  switch (surface) {
    case 'chat':
      return 'sm';
    case 'dashboard-half':
      return 'md';
    case 'dashboard-full':
      return 'lg';
    case 'detail':
    default:
      return 'lg';
  }
}

// ── Height ───────────────────────────────────────────────────────────
//
// Each surface has a floor + cap; within the range height scales modestly
// by data density so tiny result sets don't leave half the card blank and
// large vertical-bar lists aren't crushed.
function heightRangeFor(surface: ChartSurface, type: string) {
  switch (surface) {
    case 'chat':
      return type === 'pie' ? { floor: 220, cap: 260 } : { floor: 220, cap: 300 };
    case 'dashboard-half':
      return { floor: 220, cap: 300 };
    case 'dashboard-full':
      return { floor: 260, cap: 360 };
    case 'detail':
    default:
      return { floor: 320, cap: 560 };
  }
}

export function deriveChartHeight(
  surface: ChartSurface,
  type: string,
  dataCount: number,
): number {
  const { floor, cap } = heightRangeFor(surface, type);
  const density = Math.max(0, Math.min(1, dataCount / 24));
  return Math.round(floor + density * (cap - floor));
}

// ── Y-axis width ─────────────────────────────────────────────────────
//
// Horizontal bar layouts read y-axis as the category dimension and need a
// wider left gutter for labels. Narrow buckets clip at a smaller width so
// the plot doesn't vanish in small tiles.
function yAxisWidthFor(bucket: ChartWidthBucket, type: string): number {
  const horizontal = type === 'horizontal_bar';
  if (horizontal) {
    if (bucket === 'xs') return 80;
    if (bucket === 'sm') return 96;
    if (bucket === 'md') return 120;
    return 140;
  }
  // Numeric y-axis: 3-4 digits rarely need more than ~44px.
  if (bucket === 'xs') return 36;
  if (bucket === 'sm') return 40;
  if (bucket === 'md') return 48;
  return 56;
}

// ── Legend placement ────────────────────────────────────────────────
//
// Cartesian charts have a busy bottom band (axis line + ticks + optional
// axis title). Stacking a horizontal legend there forces Recharts to
// overlap the legend wrapper with the tick labels — the only escape is
// extra bottom gutter, which wastes vertical space. Place horizontal
// legends at the TOP instead (above the plot, below the card header,
// which lives outside the chart container) so ticks and legend never
// compete for the same strip.
//
// Pies/donuts have no x-axis to collide with; keep right-side (or bottom
// on xs) placement for them.
function legendPositionFor(bucket: ChartWidthBucket, type: string): ChartLayoutOutput['legendPosition'] {
  if (type === 'pie' || type === 'donut') return bucket === 'xs' ? 'bottom' : 'right';
  return 'top';
}

// ── Main helper ──────────────────────────────────────────────────────

export function deriveChartLayout(input: ChartLayoutInput): ChartLayoutOutput {
  const { surface, type, dataCount, width, compact = surface === 'chat' } = input;
  const widthBucket = widthBucketFor(width, surface);
  const heightBase = deriveChartHeight(surface, type, dataCount);
  const heightBump = widthBucket === 'xs' ? 40 : widthBucket === 'sm' ? 20 : 0;
  const height = heightBase + heightBump;
  const yAxisWidth = yAxisWidthFor(widthBucket, type);
  const legendPosition = legendPositionFor(widthBucket, type);

  const narrow = widthBucket === 'xs' || widthBucket === 'sm';
  const tickFontSize = compact ? 10 : narrow ? 10 : 11;

  const margin = {
    top: 8,
    right: narrow ? 4 : 12,
    bottom: narrow ? 20 : 18,
    left: narrow ? 0 : 4,
  };

  const xTickCharCap = compact ? 14 : narrow ? 18 : 24;

  // Width-aware x-tick sparsification. A truncated label occupies roughly
  // ``charCap × fontSize × 0.6`` px horizontally at 0° rotation (conservative
  // char-width heuristic). Any slot tighter than that means labels visually
  // collide, so we skip every Nth tick instead of rotating+truncating.
  // ``-1`` sentinel means "width unknown" — the renderer falls back to
  // Recharts' ``preserveStartEnd`` default, which behaves sensibly for dense
  // wide surfaces that don't measure themselves.
  const estimatedPlotWidth =
    typeof width === 'number' && width > 0
      ? width - yAxisWidth - margin.left - margin.right
      : null;
  const slot =
    estimatedPlotWidth && dataCount > 0 ? estimatedPlotWidth / dataCount : null;
  const labelPx = xTickCharCap * tickFontSize * 0.6;
  const xTickInterval =
    slot === null
      ? -1
      : slot >= labelPx
        ? 0
        : Math.max(1, Math.ceil(labelPx / slot) - 1);

  return {
    height,
    widthBucket,
    yAxisWidth,
    legendPosition,
    margin,
    tickFontSize,
    truncateXTicks: true,
    xTickCharCap,
    xTickInterval,
  };
}
