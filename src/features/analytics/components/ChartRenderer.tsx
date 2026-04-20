import { useMemo } from 'react';
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
}

function truncateLabel(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 1) + '\u2026';
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChartRenderer({
  type, data, xKey, yKey, seriesKeys = [], series, xLabel, yLabel,
  legendPosition, height = 300, compact = false, yAxisWidthOverride,
  marginOverride, tickFontSizeOverride, xTickCharCapOverride,
}: ChartRendererProps) {
  const colors = useMemo(
    () => CHART_PALETTE.map((v) => resolveColor(`var(${v})`)),
    [],
  );

  if (!data.length) {
    return <div className="text-xs text-[var(--text-muted)] py-4 text-center">No data</div>;
  }

  const mapping = CHART_MAP[type] ?? CHART_MAP.bar;
  const tickFontSize = tickFontSizeOverride ?? (compact ? 10 : 11);

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
  const autoRotate = compact ? (maxLabelLen > 10 || data.length > 6) : (maxLabelLen > 20 || data.length > 12);
  const tooltipStyle = { fontSize: compact ? 10 : 11, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' };
  // Reserve extra bottom space when legend sits below the chart.
  const legendBottomPad = shouldShowLegend && legendPos === 'bottom' ? 20 : 0;
  // In compact mode never render the y-axis label — tooltip covers values and
  // the label wastes ~40 px of left space in a narrow widget.
  const baseMargin = marginOverride ?? (
    compact
      ? { top: 8, right: 8, bottom: autoRotate ? 44 : xLabel ? 24 : 8, left: 8 }
      : { top: 8, right: 16, bottom: autoRotate ? 48 : xLabel ? 24 : 8, left: yLabel ? 40 : 12 }
  );
  const commonMargin = {
    ...baseMargin,
    bottom: baseMargin.bottom + legendBottomPad,
  };

  const legendProps = shouldShowLegend ? {
    layout: (legendPos === 'right' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
    align: (legendPos === 'right' ? 'right' : 'center') as 'right' | 'center',
    verticalAlign: (legendPos === 'top' ? 'top' : legendPos === 'right' ? 'middle' : 'bottom') as 'top' | 'middle' | 'bottom',
    wrapperStyle: {
      fontSize: compact ? 10 : 11,
      ...(legendPos === 'right' ? { maxHeight: height - 16, overflowY: 'auto' as const, maxWidth: '35%' } : {}),
    },
    formatter: (value: string) => truncateLabel(humanizeKey(value), compact ? 18 : labelMaxLen),
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
            label={compact ? undefined : ({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number | undefined) => (value ?? 0).toLocaleString()} />
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
          <PolarGrid stroke="var(--border-subtle)" />
          <PolarAngleAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} />
          <PolarRadiusAxis tick={{ fontSize: tickFontSize - 1 }} />
          {keys.map((k, i) => (
            <Radar key={k} dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} />
          ))}
          <Tooltip contentStyle={tooltipStyle} />
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
          <RadialBar dataKey={yKey || 'value'} background={{ fill: 'var(--bg-secondary)' }} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && <Legend {...legendProps} iconType="circle" formatter={(_, entry) => truncateLabel(String((entry as { payload?: Record<string, unknown> }).payload?.[xKey] ?? ''), labelMaxLen)} />}
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
          <Tooltip contentStyle={tooltipStyle} />
          <Funnel dataKey={yKey || 'value'} nameKey={xKey} data={coloredData} />
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
          stroke="var(--bg-primary)"
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} type="number" tick={{ fontSize: tickFontSize }} name={xLabel || xKey} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis dataKey={scatterYKey} type="number" tick={{ fontSize: tickFontSize }} name={yLabel || scatterYKey} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill={colors[0]} />
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={{ fontSize: tickFontSize }} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && <Legend {...legendProps} />}
          {series.map((s, i) => {
            const Visual = visualMap[s.type] ?? Bar;
            const key = s.dataKey;
            const color = colors[i % colors.length];
            if (Visual === Line) return <Line key={key} dataKey={key} stroke={color} strokeWidth={2} dot={{ r: compact ? 2 : 3 }} />;
            if (Visual === Area) return <Area key={key} dataKey={key} stroke={color} fill={color} fillOpacity={0.3} />;
            if (Visual === Scatter) return <Scatter key={key} dataKey={key} fill={color} />;
            return <Bar key={key} dataKey={key} fill={color} stackId={s.stackId} radius={[4, 4, 0, 0]} />;
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={{ fontSize: tickFontSize }} label={yLabel && !compact ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          {legendProps && !compact && <Legend {...legendProps} />}
          {keys.map((k, i) => (
            type === 'area'
              ? <Area key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} stackId={mapping.stacked ? 'stack' : undefined} />
              : <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: compact ? 2 : 3 }} />
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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        {isVerticalLayout ? (
          <>
            <XAxis type="number" tick={{ fontSize: tickFontSize }} label={resolvedXLabel ? { value: resolvedXLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis type="category" dataKey={resolvedCategoryKey} tick={{ fontSize: tickFontSize }} width={yAxisWidth} tickFormatter={(v: string) => truncateLabel(String(v), compact ? 14 : 20)} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} angle={autoRotate ? -45 : 0} textAnchor={autoRotate ? 'end' : 'middle'} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
            <YAxis tick={{ fontSize: tickFontSize }} label={yLabel && !compact ? { value: yLabel, position: 'insideLeft', angle: -90, fontSize: tickFontSize + 1 } : undefined} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} />
        {legendProps && barKeys.length > 1 && <Legend {...legendProps} />}
        {barKeys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={colors[i % colors.length]} stackId={mapping.stacked ? 'stack' : undefined} radius={isVerticalLayout ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
