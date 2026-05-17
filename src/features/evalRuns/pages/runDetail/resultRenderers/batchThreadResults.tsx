import { useMemo, useState } from 'react';
import {
  MetricInfo,
  EvalTable,
  getCellValue,
  DistributionBar,
  StatPill,
} from '@/features/evalRuns/components';
import { useInlineReviewOptional, useReviewTableData } from '@/features/reviews/inline';
import { CORRECTNESS_ORDER, EFFICIENCY_ORDER } from '@/utils/evalColors';
import { getLabelDefinition } from '@/config/labelDefinitions';
import { STATUS_COLORS } from '@/utils/statusColors';
import { pct, formatMetric, normalizeLabel } from '@/utils/evalFormatters';
import type { Run, ThreadEvalRow, EvaluatorDescriptor } from '@/types';
import { RunMetricCards, RunResultsSearch } from '../components';

export interface BatchThreadResultsProps {
  run: Run;
  threadEvals: ThreadEvalRow[];
}

export function BatchThreadResults({ run, threadEvals }: BatchThreadResultsProps) {
  const [search, setSearch] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<Set<string>>(new Set());

  const summaryErrors = (run.summary?.errors as number) ?? 0;
  const summaryTotal = (run.summary?.total_threads as number) ?? 0;
  const summarySkipped = (run.summary?.skipped_previously_processed as number) ?? 0;

  const correctnessDist = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const te of threadEvals) {
      if (te.worst_correctness) {
        const n = normalizeLabel(te.worst_correctness);
        dist[n] = (dist[n] ?? 0) + 1;
      }
    }
    return dist;
  }, [threadEvals]);

  const efficiencyDist = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const te of threadEvals) {
      if (te.efficiency_verdict) {
        const n = normalizeLabel(te.efficiency_verdict);
        dist[n] = (dist[n] ?? 0) + 1;
      }
    }
    return dist;
  }, [threadEvals]);

  const customEvalSummary = useMemo(() => {
    const raw = (run.summary?.custom_evaluations ?? {}) as Record<string, {
      name: string;
      completed: number;
      errors: number;
      distribution?: Record<string, number>;
      average?: number;
    }>;
    return Object.entries(raw).map(([id, v]) => ({ id, ...v }));
  }, [run.summary]);

  const allVerdicts = useMemo(() => {
    const set = new Set<string>();
    for (const te of threadEvals) {
      if (te.worst_correctness) set.add(normalizeLabel(te.worst_correctness));
      if (te.efficiency_verdict) set.add(normalizeLabel(te.efficiency_verdict));

      const result = te.result as unknown as Record<string, unknown> | undefined;
      const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
      for (const [ceId, ce] of Object.entries(customEvals)) {
        if (ce.status !== 'completed' || !ce.output) continue;
        const desc = run.evaluator_descriptors?.find((d) => d.id === ceId);
        if (desc?.primaryField?.format === 'verdict') {
          const output = ce.output as Record<string, unknown>;
          const val = output[desc.primaryField.key];
          if (typeof val === 'string') set.add(normalizeLabel(val));
        }
      }
    }
    return Array.from(set);
  }, [threadEvals, run.evaluator_descriptors]);

  const filteredThreads = useMemo(() => {
    return threadEvals.filter((te) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !te.thread_id.toLowerCase().includes(q) &&
          !normalizeLabel(te.worst_correctness ?? '').toLowerCase().includes(q) &&
          !normalizeLabel(te.efficiency_verdict ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (verdictFilter.size > 0) {
        const builtInMatch = [te.worst_correctness, te.efficiency_verdict]
          .filter(Boolean)
          .some((v) => verdictFilter.has(normalizeLabel(v!)));

        let customMatch = false;
        const result = te.result as unknown as Record<string, unknown> | undefined;
        const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
        for (const [ceId, ce] of Object.entries(customEvals)) {
          if (ce.status !== 'completed' || !ce.output) continue;
          const desc = run.evaluator_descriptors?.find((d) => d.id === ceId);
          if (desc?.primaryField?.format === 'verdict') {
            const output = ce.output as Record<string, unknown>;
            const val = output[desc.primaryField.key];
            if (typeof val === 'string' && verdictFilter.has(normalizeLabel(val))) {
              customMatch = true;
              break;
            }
          }
        }

        if (!builtInMatch && !customMatch) return false;
      }
      return true;
    });
  }, [threadEvals, search, verdictFilter, run.evaluator_descriptors]);

  function toggleVerdictFilter(v: string) {
    setVerdictFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <ReviewAwareSummarySection
          run={run}
          threadEvals={threadEvals}
          summaryTotal={summaryTotal}
          summarySkipped={summarySkipped}
          summaryErrors={summaryErrors}
          correctnessDist={correctnessDist}
          efficiencyDist={efficiencyDist}
          customEvalSummary={customEvalSummary}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <RunResultsSearch
            status={run.status}
            resultCount={threadEvals.length}
            value={search}
            onChange={setSearch}
            placeholder="Search thread ID, verdict…"
            className="w-60 max-w-none"
          />
          <div className="flex gap-1 flex-wrap">
            {allVerdicts.map((v) => {
              const def = getLabelDefinition(v, 'correctness');
              return (
                <button
                  key={v}
                  onClick={() => toggleVerdictFilter(v)}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                    verdictFilter.has(v)
                      ? 'bg-[var(--interactive-primary)] text-white border-[var(--interactive-primary)]'
                      : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                  }`}
                >
                  {def.displayName}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {filteredThreads.length}
            {filteredThreads.length !== threadEvals.length ? ` of ${threadEvals.length}` : ''} threads
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <ReviewAwareEvalTable
          evaluations={filteredThreads}
          evaluatorDescriptors={run.evaluator_descriptors}
          runId={run.run_id}
        />
      </div>
    </div>
  );
}

/* ── Summary section ─────────────────────────────────────── */

function ReviewAwareSummarySection({
  run,
  threadEvals,
  summaryTotal,
  summarySkipped,
  summaryErrors,
  correctnessDist,
  efficiencyDist,
  customEvalSummary,
}: {
  run: Run;
  threadEvals: ThreadEvalRow[];
  summaryTotal: number;
  summarySkipped: number;
  summaryErrors: number;
  correctnessDist: Record<string, number>;
  efficiencyDist: Record<string, number>;
  customEvalSummary: Array<{
    id: string;
    name: string;
    completed: number;
    errors: number;
    distribution?: Record<string, number>;
    average?: number;
  }>;
}) {
  const review = useInlineReviewOptional();
  const adjustedDistributions = useMemo(() => {
    if (!review) return null;

    const distributions = new Map<string, Record<string, number>>();
    let changed = false;
    const descriptors = run.evaluator_descriptors ?? [];

    for (const descriptor of descriptors) {
      if (descriptor.primaryField?.format !== 'verdict' || !descriptor.primaryField.key) {
        continue;
      }

      const distribution: Record<string, number> = {};
      for (const thread of threadEvals) {
        const { value, state } = getCellValue(thread, descriptor);
        if (state !== 'ok' || typeof value !== 'string') {
          continue;
        }

        const attributeKey = descriptor.type === 'built-in'
          ? descriptor.primaryField.key
          : `custom:${descriptor.id}:${descriptor.primaryField.key}`;
        const edit = review.getEdit(`thread:${thread.thread_id}`, attributeKey);
        const finalValue = edit?.decision === 'correct' && edit.reviewedValue != null
          ? edit.reviewedValue
          : value;

        if (finalValue !== value) {
          changed = true;
        }

        const normalized = normalizeLabel(finalValue);
        distribution[normalized] = (distribution[normalized] ?? 0) + 1;
      }

      distributions.set(descriptor.id, distribution);
    }

    if (!changed) {
      return null;
    }

    return distributions;
  }, [review, run.evaluator_descriptors, threadEvals]);

  const incompleteCount = threadEvals.filter((e) => normalizeLabel(e.efficiency_verdict ?? '') === 'INCOMPLETE').length;
  const evaluable = threadEvals.length - incompleteCount;
  const completedCount = threadEvals.filter((e) => e.success_status).length;
  const avgIntentAccuracy = (() => {
    const valid = threadEvals.filter((e) => e.intent_accuracy != null);
    return valid.length > 0 ? pct(valid.reduce((sum, thread) => sum + thread.intent_accuracy!, 0) / valid.length) : 'N/A';
  })();

  const hasExtraDescriptorMetrics = (run.evaluator_descriptors ?? []).some(
    (d) => d.type === 'built-in'
      && (d.aggregation?.average != null || d.primaryField?.format === 'percentage'),
  );

  return (
    <>
      <RunMetricCards
        columnsClassName={hasExtraDescriptorMetrics
          ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6'
          : 'grid-cols-2 md:grid-cols-4'}
      >
        <StatPill
          label="Threads"
          metricKey="total_threads"
          value={summaryTotal > 0 ? `${threadEvals.length} / ${summaryTotal}` : threadEvals.length}
        />
        {summarySkipped > 0 && <StatPill label="Skipped" value={summarySkipped} color="var(--text-muted)" />}
        {(run.evaluator_descriptors ?? [])
          .filter((d) => d.type === 'built-in' && (d.aggregation?.average != null || d.primaryField?.format === 'percentage'))
          .slice(0, 2)
          .map((d) => (
            <StatPill
              key={d.id}
              label={d.name}
              metricKey={d.id}
              value={d.aggregation?.average != null ? formatMetric(d.aggregation.average, d.primaryField?.format) : avgIntentAccuracy}
            />
          ))}
        {!(run.evaluator_descriptors?.length) && (
          <>
            <StatPill label="Avg Judge Intent Acc" metricKey="avg_intent_acc" value={avgIntentAccuracy} />
            <StatPill label="Completion Rate" metricKey="completion_rate" value={evaluable > 0 ? pct(completedCount / evaluable) : 'N/A'} />
            {incompleteCount > 0 && <StatPill label="Incomplete" value={incompleteCount} color="var(--text-muted)" />}
          </>
        )}
        {summaryErrors > 0 ? (
          <StatPill label="Errors" value={`${summaryErrors} / ${summaryTotal}`} color="var(--color-error)" />
        ) : (
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2">
            <div className="flex items-center gap-1">
              <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">Completed</p>
              <MetricInfo metricKey="completed" />
            </div>
            <p className="text-lg font-bold mt-0.5 leading-tight text-[var(--text-primary)]">{completedCount} / {evaluable}</p>
            {incompleteCount > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{incompleteCount} thread{incompleteCount > 1 ? 's' : ''} excluded (incomplete)</p>
            )}
          </div>
        )}
        <ReviewedStatPill />
      </RunMetricCards>

      <div className="flex gap-4 flex-wrap">
        {run.evaluator_descriptors
          ? run.evaluator_descriptors
              .filter((d) => d.type === 'built-in' && d.primaryField?.format === 'verdict' && d.aggregation?.distribution && Object.keys(d.aggregation.distribution).length > 0)
              .map((d) => {
                const adjustedDistribution = adjustedDistributions?.get(d.id);
                const hasChanged = adjustedDistribution && JSON.stringify(adjustedDistribution) !== JSON.stringify(d.aggregation!.distribution!);
                return (
                  <div key={d.id} className="flex-1 min-w-[260px]">
                    <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">{d.name}</h3>
                    <DistributionBar
                      distribution={hasChanged ? adjustedDistribution! : d.aggregation!.distribution!}
                      aiDistribution={hasChanged ? d.aggregation!.distribution! : undefined}
                      order={d.primaryField!.verdictOrder}
                    />
                  </div>
                );
              })
          : (
            <>
              {Object.keys(correctnessDist).length > 0 && (
                <div className="flex-1 min-w-[260px]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Correctness</h3>
                  <DistributionBar
                    distribution={adjustedDistributions?.get('correctness') ?? correctnessDist}
                    aiDistribution={adjustedDistributions?.get('correctness') ? correctnessDist : undefined}
                    order={CORRECTNESS_ORDER}
                  />
                </div>
              )}
              {Object.keys(efficiencyDist).length > 0 && (
                <div className="flex-1 min-w-[260px]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Efficiency</h3>
                  <DistributionBar
                    distribution={adjustedDistributions?.get('efficiency') ?? efficiencyDist}
                    aiDistribution={adjustedDistributions?.get('efficiency') ? efficiencyDist : undefined}
                    order={EFFICIENCY_ORDER}
                  />
                </div>
              )}
            </>
          )}
      </div>

      {customEvalSummary.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Custom Evaluators</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {customEvalSummary.map(({ id, name, completed, errors, distribution, average }) => {
              const adjustedDistribution = adjustedDistributions?.get(id);
              const hasChanged = adjustedDistribution && distribution && JSON.stringify(adjustedDistribution) !== JSON.stringify(distribution);
              return (
                <div
                  key={id}
                  className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2"
                  style={{ borderLeftWidth: 3, borderLeftColor: errors > 0 ? STATUS_COLORS.hardFail : STATUS_COLORS.pass }}
                >
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{name}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{completed} completed{errors > 0 ? `, ${errors} failed` : ''}</p>
                  {average != null && (
                    <p className="text-xs font-medium mt-1 text-[var(--text-primary)]">Avg: {formatMetric(average, run.evaluator_descriptors?.find((d) => d.id === id)?.primaryField?.format)}</p>
                  )}
                  {distribution && Object.keys(distribution).length > 0 && (
                    <div className="mt-1.5">
                      <DistributionBar
                        distribution={hasChanged ? adjustedDistribution! : distribution}
                        aiDistribution={hasChanged ? distribution : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function ReviewAwareEvalTable({ evaluations, evaluatorDescriptors, runId }: {
  evaluations: ThreadEvalRow[];
  evaluatorDescriptors?: EvaluatorDescriptor[];
  runId: string;
}) {
  const { reviewableItems, reviewedIds, humanVerdicts } = useReviewTableData(runId, { itemType: 'thread' });
  return (
    <EvalTable
      evaluations={evaluations}
      evaluatorDescriptors={evaluatorDescriptors}
      reviewedThreadIds={reviewedIds}
      humanVerdicts={humanVerdicts}
      reviewableItems={reviewableItems}
    />
  );
}

function ReviewedStatPill() {
  const review = useInlineReviewOptional();
  if (!review?.context) return null;
  const totalItems = review.context.items.length;
  if (totalItems === 0) return null;
  const reviewedCount = review.context.items.filter((item) =>
    item.attributes.some((attr) => {
      const edit = review.getEdit(item.itemKey, attr.key);
      return edit && edit.decision !== '';
    }),
  ).length;
  return (
    <StatPill
      label="Reviewed"
      metricKey="reviewed_items"
      value={`${reviewedCount} / ${totalItems}`}
      color="var(--text-brand)"
    />
  );
}
