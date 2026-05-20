import { Fragment, useId, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, FunnelChart, Funnel, Treemap,
  RadialBarChart, RadialBar, ComposedChart,
} from 'recharts';
import { resolveColor } from '@/utils/statusColors';
import type { SeriesConfig } from '@/features/chat-widget/types';

const CHART_PALETTE = [
  '--color-brand-primary',
  '--color-verdict-pass',
  '--color-level-easy',
  '--color-verdict-soft-fail',
  '--color-level-hard',
  '--color-verdict-fail',
  '--color-level-crack',
  '--color-verdict-critical',
];

// Motion: a short ease-out entrance. Screen-only consumers (chat, analytics,
// cost) — the PDF report path renders through TrendChart, not this component.
const ANIM_EASING = 'ease-out';
const ANIM_DURATION = 650;

interface ChartMapping {
  cartesian?: boolean;
  polar?: boolean;
  layoutVertical?: boolean;
  stacked?: boolean;
  innerRadius?: number;
}

const CHART_MAP: Record<string, ChartMapping> = {
  bar:            { cartesian: true },
  horizontal_bar: { cartesian: true, layoutVertical: true },
  stacked_bar:    { cartesian: true, stacked: true },
  grouped_bar:    { cartesian: true },
  line:           { cartesian: true },
  area:           { cartesian: true },
  stacked_area:   { cartesian: true, stacked: true },
  scatter:        { cartesian: true },
  radar:          { polar: true },
  funnel:         {},
  treemap:        {},
  radial_bar:     { polar: true },
  composed:       { cartesian: true },
  pie:            { polar: true },
  donut:          { polar: true, innerRadius: 0.5 },
};

interface ChartRendererProps {
  type: string;
  data: Record<string, unknown>[];
  xKey: string;
  yKey?: string;
  seriesKeys?: string[];
  series?: SeriesConfig[];
  xLabel?: string;
  yLabel?: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';
  height?: number;
  compact?: boolean;
  /**
   * Phase 4.6B — optional layout overrides derived by ``chartLayout.ts``.
   * When provided, callers have already chosen surface-appropriate y-axis
   * width / horizontal bar y-axis width and the renderer skips its inline
   * magic numbers. When absent, the renderer keeps its original behavior.
   */
  yAxisWidthOverride?: number;
  marginOverride?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  tickFontSizeOverride?: number;
  xTickCharCapOverride?: number;
  /**
   * Recharts ``XAxis.interval`` override. ``0`` shows every tick; ``N`` shows
   * every ``(N+1)``th. Derived from measured width in ``chartLayout`` so
   * labels sparse out on narrow widgets and fill in as the chart widens.
   */
  xTickIntervalOverride?: number;
}

function truncateLabel(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 1) + '…';
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTooltipValue(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString();
  if (value === null || value === undefined) return '—';
  return String(value);
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

// Elevated, swatch-led tooltip card — replaces Recharts' default bordered box.
function ChartTooltip({
  active, payload, label,
}: { active?: boolean; payload?: TooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const heading = label !== undefined && label !== '' ? String(label) : null;
  return (
    <div className="min-w-[8rem] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 shadow-[var(--shadow-lg)]">
      {heading ? (
        <div className="mb-1.5 text-[11px] font-medium text-[var(--text-secondary)]">{heading}</div>
      ) : null}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: entry.color ?? 'var(--text-muted)' }}
            />
            <span className="text-[var(--text-muted)]">
              {humanizeKey(String(entry.name ?? ''))}
            </span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-[var(--text-primary)]">
              {formatTooltipValue(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-color gradient stops: brand-led depth for bars (vertical + horizontal)
// and a soft fade for area fills. IDs are scoped to a useId() instance so
// multiple charts on one page never collide.
function GradientDefs({ uid, colors }: { uid: string; colors: string[] }) {
  return (
    <defs>
      {colors.map((c, i) => (
        <Fragment key={i}>
          <linearGradient id={`${uid}-barv-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.95} />
            <stop offset="100%" stopColor={c} stopOpacity={0.58} />
          </linearGradient>
          <linearGradient id={`${uid}-barh-${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c} stopOpacity={0.58} />
            <stop offset="100%" stopColor={c} stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id={`${uid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.32} />
            <stop offset="92%" stopColor={c} stopOpacity={0.02} />
          </linearGradient>
        </Fragment>
      ))}
    </defs>
  );
}

export function ChartRenderer({
  type, data, xKey, yKey, seriesKeys = [], series, xLabel, yLabel,
  legendPosition, height = 300, compact = false, yAxisWidthOverride,
  marginOverride, tickFontSizeOverride, xTickCharCapOverride,
  xTickIntervalOverride,
}: ChartRendererProps) {
  const colors = useMemo(
    () => CHART_PALETTE.map((v) => resolveColor(`var(${v})`)),
    [],
  );
  const uid = useId().replace(/:/g, '');
  const barFill = (i: number) => `url(#${uid}-barv-${i % colors.length})`;
  const barFillH = (i: number) => `url(#${uid}-barh-${i % colors.length})`;
  const areaFill = (i: number) => `url(#${uid}-area-${i % colors.length})`;

  if (!data.length) {
    return <div className="text-xs text-[var(--text-muted)] py-4 text-center">No data</div>;
  }

  const mapping = CHART_MAP[type] ?? CHART_MAP.bar;
  const tickFontSize = tickFontSizeOverride ?? (compact ? 10 : 11);
  const gridStroke = 'var(--border-subtle)';
  const axisTick = { fontSize: tickFontSize, fill: 'var(--text-muted)' };
  const barCursor = { fill: 'var(--surface-brand-subtle)', fillOpacity: 0.6 };
  const activeDot = { r: compact ? 4 : 5, strokeWidth: 2, stroke: 'var(--bg-elevated)' };

  // Derive layout-awareness from the data itself, not hardcoded thresholds.
  const seriesCount = seriesKeys.length || 1;
  const maxLabelLen = data.reduce((max, row) => Math.max(max, String(row[xKey] ?? '').length), 0);
  const labelMaxLen = xTickCharCapOverride
    ?? (compact ? Math.min(18, Math.max(10, Math.floor(40 / Math.max(seriesCount, 1)))) : 40);
  const shouldShowLegend = legendPosition !== 'none' && seriesCount <= 12;
  const legendPos = legendPosition ?? (
    seriesCount > 4 ? 'right' : mapping.polar ? 'right' : 'bottom'
  );
  const xTickFormatter = (v: string) => truncateLabel(String(v), labelMaxLen);
  // Recharts ``XAxis.interval``:
  //   - ``undefined`` / ``-1`` (width unknown): fall back to Recharts'
  //     ``preserveStartEnd`` so dense unmeasured surfaces still auto-skip.
  //   - ``0``: plot width has room for every label — render them all.
  //   - ``>= 1``: caller-derived sparsification; render every ``(N+1)``th.
  const xAxisInterval: number | 'preserveStartEnd' =
    typeof xTickIntervalOverride === 'number' && xTickIntervalOverride >= 0
      ? xTickIntervalOverride
      : 'preserveStartEnd';
  // When ticks are sparsified (interval >= 1) the surviving labels have room
  // to breathe horizontally — no rotation needed.
  const isSparsified = typeof xAxisInterval === 'number' && xAxisInterval >= 1;
  const autoRotate = isSparsified
    ? false
    : compact
      ? (maxLabelLen > 10 || data.length > 6)
      : (maxLabelLen > 20 || data.length > 12);
  // In compact mode never render the y-axis label — tooltip covers values and
  // the label wastes ~40 px of left space in a narrow widget.
  const baseMargin = marginOverride ?? (
    compact
      ? { top: 8, right: 8, bottom: autoRotate ? 44 : xLabel ? 24 : 8, left: 8 }
      : { top: 8, right: 16, bottom: autoRotate ? 48 : xLabel ? 24 : 8, left: yLabel ? 40 : 12 }
  );
  const commonMargin = baseMargin;

  const legendProps = shouldShowLegend ? {
    layout: (legendPos === 'right' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
    align: (legendPos === 'right' ? 'right' : 'center') as 'right' | 'center',
    verticalAlign: (legendPos === 'top' ? 'top' : legendPos === 'right' ? 'middle' : 'bottom') as 'top' | 'middle' | 'bottom',
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: {
      fontSize: compact ? 10 : 11,
      ...(legendPos === 'right' ? { maxHeight: height - 16, overflowY: 'auto' as const, maxWidth: '35%' } : {}),
    },
    formatter: (value: string) => (
      <span className="text-[var(--text-muted)]">{truncateLabel(humanizeKey(value), compact ? 18 : labelMaxLen)}</span>
    ),
  } : undefined;

  // ── Pie / Donut ──────────────────────────────────────────────
  if (type === 'pie' || type === 'donut') {
    const outerRadius = compact ? Math.min(height / 3, 80) : height / 3;
    const innerRadius = mapping.innerRadius ? outerRadius * mapping.innerRadius : 0;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey={yKey || 'value'}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={outerRadius}
            innerRadius={innerRadius}
            paddingAngle={1.5}
            cornerRadius={3}
            stroke="var(--bg-elevated)"
            strokeWidth={2}
            animationEasing={ANIM_EASING}
            animationDuration={ANIM_DURATION}
            label={compact ? undefined : ({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          {legendProps && <Legend {...legendProps} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // ── Radar ────────────────────────────────────────────────────
  if (type === 'radar') {
    const keys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius={compact ? '70%' : '80%'}>
          <PolarGrid stroke={gridStroke} />
          <PolarAngleAxis dataKey={xKey} tick={axisTick} />
          <PolarRadiusAxis tick={{ ...axisTick, fontSize: tickFontSize - 1 }} />
          {keys.map((k, i) => (
            <Radar
              key={k}
              dataKey={k}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fill={colors[i % colors.length]}
              fillOpacity={0.22}
              animationEasing={ANIM_EASING}
              animationDuration={ANIM_DURATION}
            />
          ))}
          <Tooltip content={<ChartTooltip />} />
          {legendProps && <Legend {...legendProps} />}
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  // ── Radial Bar ───────────────────────────────────────────────
  if (type === 'radial_bar') {
    const coloredData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadialBarChart data={coloredData} innerRadius="20%" outerRadius="90%" startAngle={180} endAngle={0}>
          <RadialBar
            dataKey={yKey || 'value'}
            background={{ fill: 'var(--surface-neutral)' }}
            cornerRadius={6}
            animationEasing={ANIM_EASING}
            animationDuration={ANIM_DURATION}
          />
          <Tooltip content={<ChartTooltip />} />
          {legendProps && <Legend {...legendProps} formatter={(_, entry) => (
            <span className="text-[var(--text-muted)]">{truncateLabel(String((entry as { payload?: Record<string, unknown> }).payload?.[xKey] ?? ''), labelMaxLen)}</span>
          )} />}
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  // ── Funnel ───────────────────────────────────────────────────
  if (type === 'funnel') {
    const coloredData = data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <FunnelChart>
          <Tooltip content={<ChartTooltip />} />
          <Funnel
            dataKey={yKey || 'value'}
            nameKey={xKey}
            data={coloredData}
            stroke="var(--bg-elevated)"
            strokeWidth={2}
            animationEasing={ANIM_EASING}
            animationDuration={ANIM_DURATION}
          />
          {legendProps && <Legend {...legendProps} />}
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  // ── Treemap ──────────────────────────────────────────────────
  if (type === 'treemap') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Treemap
          data={data.map((d, i) => ({ name: String(d[xKey] ?? ''), size: Number(d[yKey || 'value'] ?? 0), fill: colors[i % colors.length] }))}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          stroke="var(--bg-elevated)"
          animationEasing={ANIM_EASING}
          animationDuration={ANIM_DURATION}
        />
      </ResponsiveContainer>
    );
  }

  // ── Scatter ──────────────────────────────────────────────────
  if (type === 'scatter') {
    const numericCols = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    const scatterYKey = numericCols[0];
    if (!scatterYKey) return <div className="text-xs text-[var(--text-muted)] py-4 text-center">Scatter needs two numeric columns</div>;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={commonMargin}>
          <CartesianGrid horizontal vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
          <XAxis dataKey={xKey} type="number" tick={axisTick} axisLine={false} tickLine={false} name={xLabel || xKey} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis dataKey={scatterYKey} type="number" tick={axisTick} axisLine={false} tickLine={false} name={yLabel || scatterYKey} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill={colors[0]} fillOpacity={0.7} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  // ── Composed ─────────────────────────────────────────────────
  if (type === 'composed' && series?.length) {
    const visualMap: Record<string, typeof Bar | typeof Line | typeof Area | typeof Scatter> = {
      bar: Bar, line: Line, area: Area, scatter: Scatter,
    };
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={commonMargin}>
          <GradientDefs uid={uid} colors={colors} />
          <CartesianGrid horizontal vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
          <XAxis dataKey={xKey} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={xTickFormatter} interval={xAxisInterval} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={yAxisWidthOverride} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip content={<ChartTooltip />} cursor={barCursor} />
          {legendProps && <Legend {...legendProps} />}
          {series.map((s, i) => {
            const Visual = visualMap[s.type] ?? Bar;
            const key = s.dataKey;
            const color = colors[i % colors.length];
            if (Visual === Line) return <Line key={key} dataKey={key} stroke={color} strokeWidth={2.5} dot={false} activeDot={activeDot} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />;
            if (Visual === Area) return <Area key={key} dataKey={key} stroke={color} strokeWidth={2} fill={areaFill(i)} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />;
            if (Visual === Scatter) return <Scatter key={key} dataKey={key} fill={color} fillOpacity={0.7} />;
            return <Bar key={key} dataKey={key} fill={barFill(i)} stackId={s.stackId} radius={[5, 5, 0, 0]} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // ── Cartesian (bar, horizontal_bar, stacked_bar, grouped_bar, line, area, stacked_area) ──
  const isVerticalLayout = mapping.layoutVertical;
  // When the caller passes a ``yAxisWidthOverride`` (derived from
  // ``chartLayout.deriveChartLayout``), honor it. Otherwise keep the
  // original surface-agnostic default.
  const yAxisWidth = yAxisWidthOverride ?? (compact ? 90 : 120);

  // For horizontal_bar the LLM convention is xKey = value axis, yKey = category axis.
  // Recharts vertical layout needs category on YAxis and value bars from the numeric key.
  // Detect the swap: if xKey values are numeric and yKey values are strings, swap them.
  const needsKeySwap = isVerticalLayout && data.length > 0 &&
    typeof data[0][xKey] === 'number' && typeof data[0][yKey ?? ''] === 'string';
  const resolvedCategoryKey = needsKeySwap ? (yKey ?? xKey) : xKey;
  const resolvedBarKeys = needsKeySwap
    ? (seriesKeys.length ? seriesKeys : [xKey])
    : (seriesKeys.length ? seriesKeys : yKey ? [yKey] : []);
  const resolvedXLabel = needsKeySwap ? yLabel : xLabel;

  if (type === 'line' || type === 'area') {
    const keys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    const ChartContainer = type === 'area' ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={data} margin={commonMargin}>
          <GradientDefs uid={uid} colors={colors} />
          <CartesianGrid horizontal vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
          <XAxis dataKey={xKey} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={xTickFormatter} interval={xAxisInterval} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={yAxisWidthOverride} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-default)', strokeWidth: 1 }} />
          {legendProps && !compact && <Legend {...legendProps} />}
          {keys.map((k, i) => (
            type === 'area'
              ? <Area key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} fill={areaFill(i)} dot={false} activeDot={activeDot} stackId={mapping.stacked ? 'stack' : undefined} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />
              : <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2.5} dot={false} activeDot={activeDot} animationEasing={ANIM_EASING} animationDuration={ANIM_DURATION} />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    );
  }

  // Bar variants (bar, horizontal_bar, stacked_bar, grouped_bar)
  const barKeys = isVerticalLayout ? resolvedBarKeys : (seriesKeys.length ? seriesKeys : yKey ? [yKey] : []);
  const barHeight = compact ? 24 : 32;
  const resolvedHeight = isVerticalLayout ? Math.max(height, data.length * barHeight) : height;

  return (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <BarChart data={data} margin={commonMargin} layout={isVerticalLayout ? 'vertical' : 'horizontal'}>
        <GradientDefs uid={uid} colors={colors} />
        {isVerticalLayout ? (
          <>
            <CartesianGrid horizontal={false} vertical stroke={gridStroke} strokeOpacity={0.6} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} label={resolvedXLabel ? { value: resolvedXLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis type="category" dataKey={resolvedCategoryKey} tick={axisTick} axisLine={false} tickLine={false} width={yAxisWidth} tickFormatter={(v: string) => truncateLabel(String(v), compact ? 14 : 20)} />
          </>
        ) : (
          <>
            <CartesianGrid horizontal vertical={false} stroke={gridStroke} strokeOpacity={0.6} />
            <XAxis dataKey={xKey} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={xTickFormatter} interval={xAxisInterval} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} width={yAxisWidthOverride} label={yLabel && !compact ? { value: yLabel, position: 'insideLeft', angle: -90, fontSize: tickFontSize + 1 } : undefined} />
          </>
        )}
        <Tooltip content={<ChartTooltip />} cursor={barCursor} />
        {legendProps && barKeys.length > 1 && <Legend {...legendProps} />}
        {barKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            fill={isVerticalLayout ? barFillH(i) : barFill(i)}
            stackId={mapping.stacked ? 'stack' : undefined}
            radius={isVerticalLayout ? [0, 5, 5, 0] : [5, 5, 0, 0]}
            maxBarSize={isVerticalLayout ? undefined : 56}
            animationEasing={ANIM_EASING}
            animationDuration={ANIM_DURATION}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
