import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import { resolveColor } from '@/utils/statusColors';

// 8-color palette using CSS variables for theme safety
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

interface ChartRendererProps {
  type: 'bar' | 'horizontal_bar' | 'line' | 'pie' | 'stacked_bar';
  data: Record<string, unknown>[];
  xKey: string;
  yKey?: string;
  seriesKeys?: string[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  /** When true, uses compact layout for narrow containers (chat widget). */
  compact?: boolean;
}

/** Truncate long axis labels for narrow containers. */
function truncateLabel(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 1) + '…';
}

export function ChartRenderer({
  type, data, xKey, yKey, seriesKeys = [], xLabel, yLabel, height = 300, compact = false,
}: ChartRendererProps) {
  const colors = useMemo(
    () => CHART_PALETTE.map((v) => resolveColor(`var(${v})`)),
    [],
  );

  if (!data.length) {
    return <div className="text-xs text-[var(--text-muted)] py-4 text-center">No data</div>;
  }

  const labelMaxLen = compact ? 18 : 40;
  const tickFontSize = compact ? 9 : 10;
  const commonProps = {
    data,
    margin: compact
      ? { top: 4, right: 8, bottom: xLabel ? 20 : 4, left: yLabel ? 28 : 4 }
      : { top: 8, right: 16, bottom: xLabel ? 24 : 8, left: yLabel ? 32 : 8 },
  };

  if (type === 'pie') {
    const outerRadius = compact ? Math.min(height / 3, 80) : height / 3;
    const innerRadius = compact ? outerRadius * 0.5 : 0; // donut in compact mode

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
            label={compact
              ? undefined // no inline labels in compact — rely on tooltip + legend
              : ({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={compact
              ? { fontSize: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }
              : undefined
            }
            formatter={(value: number | undefined) => (value ?? 0).toLocaleString()}
          />
          <Legend
            layout={compact ? 'vertical' : 'horizontal'}
            align={compact ? 'right' : 'center'}
            verticalAlign={compact ? 'middle' : 'bottom'}
            wrapperStyle={compact ? { fontSize: 10, maxHeight: height - 16, overflowY: 'auto', paddingLeft: 8 } : undefined}
            formatter={(value: string) => truncateLabel(value, labelMaxLen)}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const tooltipStyle = { fontSize: compact ? 10 : 11, background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' };
  const xTickFormatter = compact ? (v: string) => truncateLabel(String(v), labelMaxLen) : undefined;
  const yAxisWidth = compact ? 90 : 120;

  if (type === 'line') {
    const keys = seriesKeys.length ? seriesKeys : yKey ? [yKey] : [];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: tickFontSize + 1 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} />
          {!compact && <Legend />}
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: compact ? 2 : 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'horizontal_bar') {
    const barHeight = compact ? 24 : 32;
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * barHeight)}>
        <BarChart {...commonProps} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis type="number" tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: tickFontSize }} width={yAxisWidth} tickFormatter={(v: string) => truncateLabel(String(v), compact ? 14 : 20)} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey={yKey || 'value'} fill={colors[0]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'stacked_bar') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} />
          <YAxis tick={{ fontSize: tickFontSize }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={compact ? { fontSize: 10 } : undefined} />
          {seriesKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="stack" fill={colors[i % colors.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Default: vertical bar
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart {...commonProps}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey={xKey} tick={{ fontSize: tickFontSize }} tickFormatter={xTickFormatter} label={xLabel ? { value: xLabel, position: 'bottom', fontSize: tickFontSize + 1 } : undefined} />
        <YAxis tick={{ fontSize: tickFontSize }} label={yLabel ? { value: yLabel, position: 'insideLeft', angle: -90, fontSize: tickFontSize + 1 } : undefined} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey={yKey || 'value'} fill={colors[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
