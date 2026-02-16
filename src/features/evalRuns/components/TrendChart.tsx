import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TrendEntry } from "@/types";
import { CORRECTNESS_ORDER } from "@/utils/evalColors";
import { getVerdictColor } from "@/config/labelDefinitions";
import { normalizeLabel } from "@/utils/evalFormatters";
import { useResolvedColor } from "@/hooks/useResolvedColor";
import { resolveColor } from "@/utils/statusColors";

interface Props {
  data: TrendEntry[];
}

export default function TrendChart({ data }: Props) {
  const gridColor = useResolvedColor("var(--border-subtle)");
  const textColor = useResolvedColor("var(--text-muted)");

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 bg-[var(--bg-primary)] rounded border border-[var(--border-subtle)] text-[0.8rem] text-[var(--text-muted)]">
        No trend data available yet. Run some evaluations first.
      </div>
    );
  }

  const byDay = new Map<string, Record<string, number>>();
  for (const entry of data) {
    if (!byDay.has(entry.day)) {
      byDay.set(entry.day, {});
    }
    const dayData = byDay.get(entry.day)!;
    const normalized = normalizeLabel(entry.worst_correctness);
    dayData[normalized] = (dayData[normalized] ?? 0) + entry.cnt;
  }

  const chartData = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({ day, ...counts }));

  const activeVerdicts = CORRECTNESS_ORDER.filter((v) =>
    chartData.some((d) => (d as Record<string, unknown>)[v] != null),
  );

  return (
    <div className="bg-[var(--bg-primary)] rounded border border-[var(--border-subtle)] p-3">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: textColor }}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis tick={{ fontSize: 10, fill: textColor }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {activeVerdicts.map((verdict) => (
            <Line
              key={verdict}
              type="monotone"
              dataKey={verdict}
              stroke={resolveColor(getVerdictColor(verdict))}
              strokeWidth={1.5}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
