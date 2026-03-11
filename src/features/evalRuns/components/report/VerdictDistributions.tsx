import { useRef } from 'react';
import type { VerdictDistributions as VerdictDistributionsType, AdversarialBreakdown as AdversarialBreakdownType } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import SegmentedBar from './shared/SegmentedBar';
import type { BarSegment } from './shared/SegmentedBar';
import { VERDICT_COLORS, DIFFICULTY_COLORS, verdictLabel } from './shared/colors';
import { VERDICT_DISTRIBUTIONS_INFO } from './sectionInfo';

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
        infoTooltip={<VERDICT_DISTRIBUTIONS_INFO isAdversarial={isAdversarial} />}
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
            {adversarialBreakdown?.byGoal && adversarialBreakdown.byGoal.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                  By Goal
                </h3>
                <SegmentedBar
                  segments={adversarialBreakdown.byGoal.map((g) => ({
                    label: g.goal,
                    value: g.passed,
                    color: VERDICT_COLORS['PASS'] ?? '#16a34a',
                  }))}
                />
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                  {adversarialBreakdown.byGoal.map((g) => (
                    <span key={g.goal} className="text-[10px] text-[var(--text-muted)]">
                      {g.goal}: {g.passed}/{g.total}
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

    </section>
  );
}
