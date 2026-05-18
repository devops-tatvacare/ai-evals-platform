import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useResolvedColor } from '@/hooks/useResolvedColor';
import { resolveColor } from '@/utils/statusColors';

export interface TrendPoint {
  /** Bucket / label shown on the x-axis (e.g. "Mar 14" or "Run-A"). */
  bucket: string;
  /** Tooltip hover label — usually a more verbose form than `bucket`. */
  hoverLabel?: string;
  /** Primary series value. */
  primary: number;
  /** Per-breakdown-key values. Keys MUST match `breakdownKeys`. */
  breakdown?: Record<string, number>;
}

interface Props {
  points: TrendPoint[];
  /** Display label for the primary line (e.g. "Health Score"). */
  primaryLabel: string;
  /** CSS variable for the primary line's stroke. @default 'var(--color-info)' */
  primaryColor?: string;
  /** Optional secondary lines: list of breakdown keys + display labels. */
  breakdowns?: { key: string; label: string }[];
  /** Y-axis domain. @default [0, 100] */
  yDomain?: [number, number];
  /** Optional horizontal reference line value. */
  referenceValue?: number;
  /** Label rendered on the reference line. */
  referenceLabel?: string;
  /** Chart height in pixels. @default 280 */
  height?: number;
}

const BREAKDOWN_COLOR_VARS = [
  'var(--color-accent-indigo)',
  'var(--color-accent-amber)',
  'var(--color-accent-teal)',
  'var(--color-accent-rose)',
  'var(--color-accent-purple)',
  'var(--color-accent-pink)',
  'var(--color-accent-cyan)',
];

export default function TrendChart({
  points,
  primaryLabel,
  primaryColor = 'var(--color-info)',
  breakdowns = [],
  yDomain = [0, 100],
  referenceValue,
  referenceLabel,
  height = 280,
}: Props) {
  const gridColor = useResolvedColor('var(--border-subtle)');
  const textColor = useResolvedColor('var(--text-muted)');
  const primaryHex = useResolvedColor(primaryColor);

  const chartData = useMemo(
    () =>
      points.map((pt) => {
        const entry: Record<string, string | number> = {
          bucket: pt.bucket,
          hoverLabel: pt.hoverLabel ?? pt.bucket,
          [primaryLabel]: pt.primary,
        };
        for (const { key, label } of breakdowns) {
          entry[label] = pt.breakdown?.[key] ?? 0;
        }
        return entry;
      }),
    [points, primaryLabel, breakdowns],
  );

  if (points.length === 0) return null;

  return (
    <div className="bg-[var(--bg-primary)] rounded border border-[var(--border-subtle)] p-3">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: textColor }} />
          <YAxis domain={yDomain} tick={{ fontSize: 10, fill: textColor }} />
          <RechartsTooltip
            contentStyle={{
              fontSize: 12,
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
            labelFormatter={(_label, payload) => {
              if (payload?.[0]?.payload) {
                return String((payload[0].payload as { hoverLabel?: string }).hoverLabel ?? '');
              }
              return '';
            }}
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {referenceValue != null && (
            <ReferenceLine
              y={referenceValue}
              stroke={gridColor}
              strokeDasharray="6 3"
              label={referenceLabel ? { value: referenceLabel, position: 'insideTopRight', fontSize: 9, fill: textColor } : undefined}
            />
          )}

          <Line
            type="monotone"
            dataKey={primaryLabel}
            stroke={primaryHex}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />

          {breakdowns.map(({ label }, idx) => (
            <Line
              key={label}
              type="monotone"
              dataKey={label}
              stroke={resolveColor(BREAKDOWN_COLOR_VARS[idx % BREAKDOWN_COLOR_VARS.length])}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
