import { getVerdictColor, getLabelDefinition } from "@/config/labelDefinitions";
import { normalizeLabel } from "@/utils/evalFormatters";

interface Props {
  distribution: Record<string, number>;
  order?: readonly string[];
}

export default function DistributionBar({ distribution, order }: Props) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="h-6 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-xs)] text-[var(--text-muted)]">
        No data
      </div>
    );
  }

  const normalizedDist = new Map<string, { count: number; raw: string }>();
  for (const [raw, count] of Object.entries(distribution)) {
    if (count <= 0) continue;
    const n = normalizeLabel(raw);
    const existing = normalizedDist.get(n);
    normalizedDist.set(n, {
      count: (existing?.count ?? 0) + count,
      raw: existing?.raw ?? raw,
    });
  }

  const orderedKeys = order
    ? order.map((k) => normalizeLabel(k)).filter((k) => normalizedDist.has(k))
    : Array.from(normalizedDist.keys());

  return (
    <div>
      <div className="flex h-6 rounded overflow-hidden bg-[var(--bg-tertiary)]">
        {orderedKeys.map((key) => {
          const entry = normalizedDist.get(key)!;
          const widthPct = (entry.count / total) * 100;
          return (
            <div
              key={key}
              className="flex items-center justify-center text-[0.64rem] font-semibold text-white min-w-[18px] cursor-default transition-opacity hover:opacity-85"
              style={{
                width: `${widthPct}%`,
                backgroundColor: getVerdictColor(key),
              }}
              title={`${key}: ${entry.count} (${Math.round(widthPct)}%)`}
            >
              {widthPct > 8 ? entry.count : ""}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-1 flex-wrap">
        {orderedKeys.map((key) => {
          const entry = normalizedDist.get(key)!;
          const def = getLabelDefinition(key, "correctness");
          const displayName = def.description !== "Unknown label" ? def.displayName : key;
          return (
            <div key={key} className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--text-secondary)]">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: getVerdictColor(key) }}
              />
              {displayName}: {entry.count}
            </div>
          );
        })}
      </div>
    </div>
  );
}
