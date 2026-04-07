import type { EvaluatorSection, FieldAggregation } from '@/types/reports';
import MetricCard from '../shared/MetricCard';
import SegmentedBar from '../shared/SegmentedBar';
import { METRIC_HEX } from '../shared/colors';

interface Props {
  section: EvaluatorSection;
}

/** Color based on threshold-aware scoring (for custom evaluator fields). */
function scoreColor(
  value: number,
  thresholds?: { greenThreshold: number; yellowThreshold?: number | null },
): string {
  if (!thresholds) return METRIC_HEX(value); // fallback for 0-100 scales
  if (value >= thresholds.greenThreshold) return 'var(--color-success)';
  if (thresholds.yellowThreshold != null && value >= thresholds.yellowThreshold) return 'var(--color-warning)';
  return 'var(--color-error)';
}

export default function EvaluatorCard({ section }: Props) {
  const headerFields = section.fields.filter((f) => f.isMainMetric || f.displayMode === 'header');
  const cardFields = section.fields.filter((f) => {
    if (f.isMainMetric) return false; // already in header
    if (f.role) return f.role !== 'reasoning';
    return f.displayMode === 'card';
  });

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{section.evaluatorName}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {section.completed}/{section.totalThreads} threads evaluated
          </p>
        </div>
        {section.errorRate > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
            {(section.errorRate * 100).toFixed(1)}% errors
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Header fields — metric cards grid */}
        {headerFields.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {headerFields.map((field) => (
              <HeaderFieldCard key={field.key} field={field} />
            ))}
          </div>
        )}

        {/* Card fields — detailed rows */}
        {cardFields.length > 0 && (
          <div className="space-y-3">
            {cardFields.map((field) => (
              <CardFieldRow key={field.key} field={field} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderFieldCard({ field }: { field: FieldAggregation }) {
  if (field.fieldType === 'number' && field.average != null) {
    const color = field.thresholdPassRates
      ? scoreColor(field.average, {
          greenThreshold: field.thresholdPassRates.greenThreshold,
          yellowThreshold: field.thresholdPassRates.yellowThreshold,
        })
      : METRIC_HEX(field.average);

    return (
      <MetricCard
        label={field.label}
        value={field.average.toFixed(1)}
        color={color}
        progressValue={field.thresholdPassRates ? (field.average / field.thresholdPassRates.greenThreshold) * 100 : field.average}
      />
    );
  }

  if (field.fieldType === 'boolean' && field.passRate != null) {
    const pct = field.passRate * 100;
    return (
      <MetricCard
        label={field.label}
        value={`${pct.toFixed(0)}%`}
        color={METRIC_HEX(pct)}
        progressValue={pct}
      />
    );
  }

  if (field.fieldType === 'enum' && field.distribution) {
    const entries = Object.entries(field.distribution);
    if (entries.length === 0) return null;
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const topValue = sorted[0][0];
    const topPct = Math.round((sorted[0][1] / field.sampleCount) * 100);

    return (
      <MetricCard
        label={field.label}
        value={topValue}
        suffix={` (${topPct}%)`}
        color="var(--color-info)"
      />
    );
  }

  // text/array
  return (
    <MetricCard
      label={field.label}
      value={`${field.sampleCount}`}
      suffix=" samples"
      color="var(--color-verdict-na)"
    />
  );
}

function CardFieldRow({ field }: { field: FieldAggregation }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{field.label}</span>
        <span className="text-[10px] text-[var(--text-muted)]">{field.sampleCount} samples</span>
      </div>

      {field.fieldType === 'number' && field.thresholdPassRates && (
        <SegmentedBar
          barHeight="h-5"
          segments={[
            { label: `Green (≥${field.thresholdPassRates.greenThreshold})`, value: field.thresholdPassRates.greenPct, color: 'var(--color-success)' },
            ...(field.thresholdPassRates.yellowThreshold != null
              ? [{ label: `Yellow (≥${field.thresholdPassRates.yellowThreshold})`, value: field.thresholdPassRates.yellowPct, color: 'var(--color-warning)' }]
              : []),
            { label: 'Red', value: field.thresholdPassRates.redPct, color: 'var(--color-error)' },
          ]}
          formatValue={(v) => `${v.toFixed(0)}%`}
        />
      )}

      {field.fieldType === 'number' && !field.thresholdPassRates && field.average != null && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: METRIC_HEX(field.average) }}>
            {field.average.toFixed(1)}
          </span>
          <span className="text-xs text-[var(--text-muted)]">avg</span>
        </div>
      )}

      {field.fieldType === 'boolean' && field.trueCount != null && field.falseCount != null && (
        <SegmentedBar
          barHeight="h-5"
          segments={[
            { label: 'Pass', value: field.trueCount, color: 'var(--color-success)' },
            { label: 'Fail', value: field.falseCount, color: 'var(--color-error)' },
          ]}
        />
      )}

      {field.fieldType === 'enum' && field.distribution && (
        <SegmentedBar
          barHeight="h-5"
          segments={Object.entries(field.distribution)
            .sort((a, b) => b[1] - a[1])
            .map((entry, i) => ({
              label: entry[0],
              value: entry[1],
              color: ENUM_COLORS[i % ENUM_COLORS.length],
            }))}
        />
      )}

      {field.fieldType === 'text' && (
        <span className="text-xs text-[var(--text-muted)] italic">Text field — see narrative analysis</span>
      )}

      {field.fieldType === 'array' && (
        <span className="text-xs text-[var(--text-muted)] italic">Array field — see narrative analysis</span>
      )}
    </div>
  );
}

const ENUM_COLORS = [
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-accent-purple)',
  'var(--color-accent-cyan)',
  'var(--color-accent-orange)',
];
