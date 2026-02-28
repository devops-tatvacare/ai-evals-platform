import { useRef } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { VerdictDistributions as VerdictDistributionsType, AdversarialBreakdown as AdversarialBreakdownType } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import MetricCard from './shared/MetricCard';
import SegmentedBar from './shared/SegmentedBar';
import type { BarSegment } from './shared/SegmentedBar';
import { VERDICT_COLORS, METRIC_HEX, DIFFICULTY_COLORS, verdictLabel } from './shared/colors';
import { useResolvedColor } from '@/hooks/useResolvedColor';

interface Props {
  distributions: VerdictDistributionsType;
  isAdversarial?: boolean;
  adversarialBreakdown?: AdversarialBreakdownType | null;
}

// ── Ordering constants ─────────────────────────────────────────

const CORRECTNESS_ORDER = ['PASS', 'NOT APPLICABLE', 'SOFT FAIL', 'HARD FAIL', 'CRITICAL'];
const EFFICIENCY_ORDER = ['EFFICIENT', 'ACCEPTABLE', 'INCOMPLETE', 'FRICTION', 'BROKEN'];

function toOrderedSegments(
  data: Record<string, number>,
  order: string[],
): BarSegment[] {
  const known = order.filter((key) => (data[key] ?? 0) > 0);
  const unknown = Object.keys(data).filter((key) => data[key] > 0 && !order.includes(key));
  return [...known, ...unknown].map((key) => ({
    label: verdictLabel(key),
    value: data[key],
    color: VERDICT_COLORS[key] ?? '#6b7280',
  }));
}

/** Group intent histogram buckets into High / Medium / Low tiers. */
function bucketIntentHistogram(histogram: { buckets: string[]; counts: number[] }): BarSegment[] {
  let high = 0, medium = 0, low = 0;

  histogram.buckets.forEach((bucket, i) => {
    const start = parseInt(bucket);
    if (isNaN(start)) return;
    if (start >= 80) high += histogram.counts[i];
    else if (start >= 50) medium += histogram.counts[i];
    else low += histogram.counts[i];
  });

  return [
    { label: 'High (\u226580%)', value: high, color: '#16a34a' },
    { label: 'Medium (50\u201379%)', value: medium, color: '#ca8a04' },
    { label: 'Low (<50%)', value: low, color: '#dc2626' },
  ];
}

// ── Main component ─────────────────────────────────────────────

export default function VerdictDistributions({ distributions, isAdversarial, adversarialBreakdown }: Props) {
  const correctnessRef = useRef<HTMLDivElement>(null);
  const efficiencyRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef<HTMLDivElement>(null);

  const tooltipBg = useResolvedColor('var(--bg-elevated)');
  const tooltipBorder = useResolvedColor('var(--border-default)');

  const hasCorrectness = Object.keys(distributions.correctness).length > 0;
  const hasEfficiency = Object.keys(distributions.efficiency).length > 0;
  const hasIntent = distributions.intentHistogram.counts.some((c) => c > 0);
  const hasAdversarial = distributions.adversarial && Object.keys(distributions.adversarial).length > 0;

  const correctnessSegments = toOrderedSegments(distributions.correctness, CORRECTNESS_ORDER);
  const efficiencySegments = toOrderedSegments(distributions.efficiency, EFFICIENCY_ORDER);
  const intentSegments = bucketIntentHistogram(distributions.intentHistogram);
  const adversarialSegments = hasAdversarial
    ? toOrderedSegments(distributions.adversarial!, ['PASS', 'SOFT FAIL', 'FAIL', 'HARD FAIL'])
    : [];

  return (
    <section>
      <SectionHeader
        title="Verdict Distributions"
        description={isAdversarial
          ? 'How test cases were classified by adversarial verdict'
          : 'How threads were classified across correctness, efficiency, and intent accuracy'
        }
      />

      {/* Adversarial-only: show adversarial verdict bar prominently + category/difficulty */}
      {isAdversarial && hasAdversarial && (
        <div className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Adversarial Verdicts
              </h3>
              <SegmentedBar segments={adversarialSegments} />
            </div>
            {adversarialBreakdown?.byCategory && adversarialBreakdown.byCategory.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                  By Category
                </h3>
                <SegmentedBar
                  segments={adversarialBreakdown.byCategory.map((cat) => ({
                    label: cat.category,
                    value: cat.passed,
                    color: VERDICT_COLORS['PASS'] ?? '#16a34a',
                  }))}
                />
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  {adversarialBreakdown.byCategory.map((cat) => (
                    <span key={cat.category} className="text-[10px] text-[var(--text-muted)]">
                      {cat.category}: {cat.passed}/{cat.total}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {adversarialBreakdown?.byDifficulty && adversarialBreakdown.byDifficulty.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                  By Difficulty
                </h3>
                <SegmentedBar
                  segments={adversarialBreakdown.byDifficulty.map((d) => ({
                    label: d.difficulty,
                    value: d.passed,
                    color: DIFFICULTY_COLORS[d.difficulty] ?? '#6b7280',
                  }))}
                />
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  {adversarialBreakdown.byDifficulty.map((d) => (
                    <span key={d.difficulty} className="text-[10px] text-[var(--text-muted)]">
                      {d.difficulty}: {d.passed}/{d.total}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thread-based bars (hidden when all empty for adversarial) */}
      {(hasCorrectness || hasEfficiency || hasIntent) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {hasCorrectness && (
            <div ref={correctnessRef}>
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Correctness
              </h3>
              <SegmentedBar segments={correctnessSegments} />
            </div>
          )}
          {hasEfficiency && (
            <div ref={efficiencyRef}>
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Efficiency
              </h3>
              <SegmentedBar segments={efficiencySegments} />
            </div>
          )}
          {hasIntent && (
            <div ref={intentRef}>
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Intent Accuracy
              </h3>
              <SegmentedBar segments={intentSegments} />
            </div>
          )}
        </div>
      )}

      {/* Non-adversarial adversarial bar (mixed eval types) */}
      {!isAdversarial && hasAdversarial && (
        <div className="mb-6">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Adversarial Verdicts
          </h3>
          <SegmentedBar segments={adversarialSegments} />
        </div>
      )}

      {Object.keys(distributions.customEvaluations).length > 0 && (
        <CustomEvals
          customEvaluations={distributions.customEvaluations}
          tooltipBg={tooltipBg}
          tooltipBorder={tooltipBorder}
        />
      )}
    </section>
  );
}

// ── Custom evaluations (keeps Recharts for text-distribution pies) ──

function CustomEvals({ customEvaluations, tooltipBg, tooltipBorder }: {
  customEvaluations: Record<string, { name: string; type: string; average: number | null; distribution: Record<string, number> | null }>;
  tooltipBg: string;
  tooltipBorder: string;
}) {
  const entries = Object.entries(customEvaluations);

  return (
    <div className="mt-6">
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
        Custom Evaluations
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {entries.map(([id, eval_]) => (
          <div key={id} className="bg-[var(--bg-primary)] rounded border border-[var(--border-subtle)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{eval_.name}</p>
            {eval_.type === 'numeric' && eval_.average != null && (
              <MetricCard
                label="Average"
                value={eval_.average.toFixed(1)}
                color={METRIC_HEX(eval_.average)}
                progressValue={eval_.average}
              />
            )}
            {eval_.type === 'text' && eval_.distribution && (
              <PieChartSection distribution={eval_.distribution} tooltipBg={tooltipBg} tooltipBorder={tooltipBorder} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChartSection({ distribution, tooltipBg, tooltipBorder }: {
  distribution: Record<string, number>;
  tooltipBg: string;
  tooltipBorder: string;
}) {
  const pieData = Object.entries(distribution).map(([name, value]) => ({
    name,
    value,
    fill: VERDICT_COLORS[name] ?? FALLBACK_COLORS[Math.abs(hashCode(name)) % FALLBACK_COLORS.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={60}
          label={renderPieLabel}
          labelLine={false}
        >
          {pieData.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ fontSize: 12, backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}` }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function renderPieLabel(props: { name?: string; percent?: number }): string {
  return `${props.name ?? ''}: ${((props.percent ?? 0) * 100).toFixed(0)}%`;
}

const FALLBACK_COLORS = ['#3b82f6', '#10B981', '#F59E0B', '#EF4444', '#8b5cf6', '#06b6d4', '#f97316'];

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}
