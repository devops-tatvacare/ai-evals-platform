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
    if (bucket === 'xs') return 90;
    if (bucket === 'sm') return 110;
    if (bucket === 'md') return 140;
    return 160;
  }
  if (bucket === 'xs') return 56;
  if (bucket === 'sm') return 72;
  if (bucket === 'md') return 90;
  return 108;
}

// ── Legend placement ────────────────────────────────────────────────
//
// Narrow surfaces can't afford a side legend; they push it below. Wide
// surfaces with many series prefer the right side.
function legendPositionFor(bucket: ChartWidthBucket, type: string): ChartLayoutOutput['legendPosition'] {
  if (type === 'pie' || type === 'donut') return bucket === 'xs' ? 'bottom' : 'right';
  if (bucket === 'xs' || bucket === 'sm') return 'bottom';
  return 'bottom';
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
    right: narrow ? 8 : 16,
    bottom: narrow ? 36 : 28,
    left: narrow ? 8 : 12,
  };

  return {
    height,
    widthBucket,
    yAxisWidth,
    legendPosition,
    margin,
    tickFontSize,
    truncateXTicks: true,
    xTickCharCap: compact ? 14 : narrow ? 18 : 24,
  };
}
