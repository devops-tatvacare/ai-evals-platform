import { useMemo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DataTable, type ColumnDef } from '@/components/ui';
import {
  useInlineReviewOptional,
  InlineReviewBadge,
  InlineReviewControls,
  VerdictChip,
  useReviewOverrides,
} from '@/features/reviews/inline';
import DistributionBar from '@/features/evalRuns/components/DistributionBar';
import { pct } from '@/utils/evalFormatters';
import type {
  EvalRun,
  AIEvaluation,
  FieldCritique,
  ReviewableItem,
  ReviewableAttribute,
} from '@/types';
import { RunMetricCards } from '../components';
import { SeverityBadge, formatCritiqueValue } from '../utils';

export function FullEvaluationResults({ run }: { run: EvalRun }) {
  const result = run.result as AIEvaluation | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const review = useInlineReviewOptional();

  const adjusted = useMemo(() => {
    if (!result?.critique || !review) return null;

    const items: Array<{ aiSeverity: string; key: string }> = [];
    if (result.flowType === 'upload' && result.critique.segments) {
      result.critique.segments.forEach((seg, i) => {
        const segIdx = String((seg as Record<string, unknown>).segmentIndex ?? i);
        items.push({ aiSeverity: ((seg as Record<string, unknown>).severity as string) ?? 'NONE', key: segIdx });
      });
    } else if (result.flowType === 'api' && result.critique.fieldCritiques) {
      result.critique.fieldCritiques.forEach((fc) => {
        items.push({ aiSeverity: fc.severity ?? 'NONE', key: fc.fieldPath });
      });
    }

    if (items.length === 0) return null;

    let critical = 0;
    let moderate = 0;
    let noneCount = 0;
    const dist: Record<string, number> = {};

    for (const { aiSeverity, key } of items) {
      const itemKey = result.flowType === 'upload' ? `segment:${key}` : `field:${key}`;
      const edit = review.getEdit(itemKey, 'severity');
      const sev = (edit?.decision === 'correct' && edit.reviewedValue != null)
        ? edit.reviewedValue.toUpperCase()
        : aiSeverity.toUpperCase();
      if (sev === 'CRITICAL') critical++;
      if (sev === 'MODERATE') moderate++;
      if (sev === 'NONE') noneCount++;
      dist[sev] = (dist[sev] ?? 0) + 1;
    }

    const accuracy = items.length > 0 ? noneCount / items.length : 0;
    return { critical, moderate, accuracy, distribution: dist };
  }, [result, review]);

  if (!result?.critique) {
    return <p className="text-sm text-[var(--text-muted)] italic">No evaluation data.</p>;
  }

  const flowType = result.flowType;
  const warnings = (result as unknown as Record<string, unknown>)?.warnings as string[] | undefined;

  const aiCritical = summary?.critical_errors as number | undefined;
  const aiModerate = summary?.moderate_errors as number | undefined;
  const aiAccuracy = summary?.overall_accuracy as number | undefined;
  const aiDistribution = summary?.severity_distribution as Record<string, number> | undefined;

  const adjCritical = adjusted?.critical;
  const adjModerate = adjusted?.moderate;
  const adjAccuracy = adjusted?.accuracy;
  const adjDistribution = adjusted?.distribution;

  const distChanged = adjDistribution && aiDistribution &&
    JSON.stringify(adjDistribution) !== JSON.stringify(aiDistribution);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        {warnings && warnings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2.5 text-xs text-amber-600 dark:text-amber-400">
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Warnings
            </div>
            {warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}
        {summary != null && (
          <RunMetricCards columnsClassName="grid-cols-2 md:grid-cols-5">
            {aiAccuracy != null && (
              <StatCard
                label="Overall Accuracy"
                value={pct(adjAccuracy ?? aiAccuracy)}
                beforeValue={adjAccuracy != null ? pct(aiAccuracy) : undefined}
              />
            )}
            {summary.total_items != null && (
              <StatCard
                label={summary.flow_type === 'api' ? 'Total Fields' : 'Total Segments'}
                value={summary.total_items as number}
              />
            )}
            {aiCritical != null && (
              <StatCard
                label="Critical Errors"
                value={adjCritical ?? aiCritical}
                beforeValue={adjCritical != null ? aiCritical : undefined}
                color={(adjCritical ?? aiCritical) > 0 ? 'var(--color-error)' : undefined}
              />
            )}
            {aiModerate != null && (
              <StatCard
                label="Moderate Errors"
                value={adjModerate ?? aiModerate}
                beforeValue={adjModerate != null ? aiModerate : undefined}
                color={(adjModerate ?? aiModerate) > 0 ? 'var(--color-warning)' : undefined}
              />
            )}
            <ReviewedStatPill
              totalItems={
                flowType === 'upload'
                  ? (result.critique.segments?.length ?? 0)
                  : (result.critique.fieldCritiques?.length ?? 0)
              }
            />
          </RunMetricCards>
        )}

        {aiDistribution != null && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
              Severity Distribution
            </h3>
            <DistributionBar
              distribution={distChanged ? adjDistribution! : aiDistribution}
              aiDistribution={distChanged ? aiDistribution : undefined}
              order={['NONE', 'MINOR', 'MODERATE', 'CRITICAL']}
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 flex-col">
        {flowType === 'upload' && result.critique.segments ? (
          <SegmentTable segments={result.critique.segments} runId={run.id} />
        ) : flowType === 'api' && result.critique.fieldCritiques ? (
          <FieldCritiqueTable
            fieldCritiques={result.critique.fieldCritiques}
            overallAssessment={result.critique.overallAssessment}
            runId={run.id}
          />
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic">No detail data.</p>
        )}
      </div>
    </div>
  );
}

/* ── SegmentTable (upload flow) ──────────────────────────── */

interface SegmentRow {
  seg: Record<string, unknown>;
  pos: number;
}

/**
 * Highlights the single-quoted transcript snippets inside a discrepancy
 * explanation so the eye lands on *what* differs, not a wall of text.
 * Opening quote must follow start/whitespace and the closing quote must be
 * followed by punctuation/whitespace/end — so contractions ("judge's") are
 * never mistaken for snippet quotes.
 */
function renderDiscrepancyText(text: string | undefined): ReactNode {
  if (!text || !text.trim()) return '—';
  const nodes: ReactNode[] = [];
  const re = /(^|\s)'([^']+)'(?=[\s.,;:!?)\]]|$)/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[1]) nodes.push(m[1]);
    nodes.push(
      <span
        key={key++}
        className="rounded bg-[var(--surface-info)] px-1 font-medium text-[var(--text-primary)]"
      >
        {m[2]}
      </span>,
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function SegmentTable({ segments, runId }: { segments: Array<Record<string, unknown>>; runId: string }) {
  const review = useInlineReviewOptional();
  const isEditing = review?.isEditing ?? false;
  const { getOverride } = useReviewOverrides(runId);

  const rows: SegmentRow[] = segments.map((seg, pos) => ({ seg, pos }));

  const reviewableFor = (row: SegmentRow) => {
    const segIdx = String((row.seg.segmentIndex as number) ?? row.pos);
    const itemKey = `segment:${segIdx}`;
    const item: ReviewableItem = {
      itemKey, itemType: 'segment', title: '', subtitle: null,
      badges: [], evidence: [], attributes: [],
    };
    const attr: ReviewableAttribute = {
      key: 'severity', label: 'Severity',
      originalValue: (row.seg.severity as string) ?? null,
      allowedValues: ['NONE', 'MINOR', 'MODERATE', 'CRITICAL'],
    };
    return { itemKey, item, attr };
  };

  const columns: ColumnDef<SegmentRow>[] = [
    {
      key: 'index',
      header: '#',
      width: 'w-12',
      cellClassName: 'text-[var(--text-muted)]',
      render: (row) => (row.seg.segmentIndex as number) ?? row.pos + 1,
    },
    {
      key: 'original',
      header: 'Original',
      width: 'w-[26%]',
      textBehavior: 'wrap',
      render: (row) => (row.seg.originalText as string) || '—',
    },
    {
      key: 'judge',
      header: 'AI Transcript',
      width: 'w-[26%]',
      textBehavior: 'wrap',
      render: (row) => (row.seg.judgeText as string) || '—',
    },
    {
      key: 'severity',
      header: 'Severity',
      width: 'w-28',
      render: (row) => {
        const { itemKey } = reviewableFor(row);
        const override = getOverride(itemKey, 'severity');
        return (
          <VerdictChip
            aiVerdict={(row.seg.severity as string) ?? 'NONE'}
            humanVerdict={override?.reviewedValue}
            category="correctness"
            renderBadge={(v) => <SeverityBadge severity={v ?? 'NONE'} />}
          />
        );
      },
    },
    {
      key: 'discrepancy',
      header: 'Discrepancy',
      width: 'w-[34%]',
      textBehavior: 'wrap',
      cellVariant: 'prose',
      render: (row) => renderDiscrepancyText(row.seg.discrepancy as string | undefined),
    },
  ];

  if (review) {
    columns.push({
      key: 'review',
      header: 'Review',
      width: 'w-24',
      render: (row) => {
        const { itemKey } = reviewableFor(row);
        return (
          <InlineReviewBadge
            decision={review.getEdit(itemKey, 'severity')?.decision}
            isDraft={review.selectedReview?.status === 'draft'}
          />
        );
      },
    });
  }

  if (isEditing && review) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      width: 'w-24',
      render: (row) => {
        const { itemKey, item, attr } = reviewableFor(row);
        const edit = review.getEdit(itemKey, 'severity');
        return (
          <InlineReviewControls
            decision={edit?.decision}
            note={edit?.note}
            originalValue={(row.seg.severity as string) ?? 'NONE'}
            reviewedValue={edit?.reviewedValue}
            allowedValues={attr.allowedValues}
            onReject={() => review.acceptAttribute(item, attr)}
            onClear={() => review.clearAttribute(item, attr)}
            onOverride={(nextSeverity) => review.correctAttribute(item, attr, nextSeverity)}
            onNote={(nextNote) => review.setAttributeNote(item, attr, nextNote)}
          />
        );
      },
    });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      <h3 className="shrink-0 text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        Segment Comparison ({segments.length} segments)
      </h3>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => String((row.seg.segmentIndex as number) ?? row.pos)}
        emptyTitle="No segments"
      />
    </div>
  );
}

/* ── FieldCritiqueTable (API flow) ───────────────────────── */

function FieldCritiqueTable({ fieldCritiques, overallAssessment, runId }: {
  fieldCritiques: FieldCritique[];
  overallAssessment: string;
  runId: string;
}) {
  const review = useInlineReviewOptional();
  const { getOverride } = useReviewOverrides(runId);
  const isEditing = review?.isEditing ?? false;

  const reviewableFor = (fc: FieldCritique) => {
    const itemKey = `field:${fc.fieldPath}`;
    const item: ReviewableItem = {
      itemKey, itemType: 'field', title: '', subtitle: null,
      badges: [], evidence: [], attributes: [],
    };
    const attr: ReviewableAttribute = {
      key: 'severity', label: 'Severity',
      originalValue: fc.severity ?? null,
      allowedValues: ['NONE', 'MINOR', 'MODERATE', 'CRITICAL'],
    };
    return { itemKey, item, attr };
  };

  const columns: ColumnDef<FieldCritique>[] = [
    {
      key: 'field',
      header: 'Field',
      width: 'w-[16%]',
      textBehavior: 'wrap',
      cellClassName: 'font-mono text-[var(--text-primary)]',
      render: (fc) => fc.fieldPath,
    },
    {
      key: 'apiValue',
      header: 'API Value',
      width: 'w-[20%]',
      textBehavior: 'wrap',
      cellClassName: 'font-mono text-[var(--text-secondary)]',
      render: (fc) => formatCritiqueValue(fc.apiValue),
    },
    {
      key: 'judgeValue',
      header: 'Judge Value',
      width: 'w-[20%]',
      textBehavior: 'wrap',
      cellClassName: 'font-mono text-[var(--text-secondary)]',
      render: (fc) => formatCritiqueValue(fc.judgeValue),
    },
    {
      key: 'severity',
      header: 'Severity',
      width: 'w-28',
      render: (fc) => {
        const override = getOverride(`field:${fc.fieldPath}`, 'severity');
        return (
          <VerdictChip
            aiVerdict={fc.severity ?? 'NONE'}
            humanVerdict={override?.reviewedValue}
            category="correctness"
            renderBadge={(v) => <SeverityBadge severity={v ?? 'NONE'} />}
          />
        );
      },
    },
    {
      key: 'critique',
      header: 'Critique',
      width: 'w-[30%]',
      textBehavior: 'wrap',
      cellClassName: 'text-[var(--text-secondary)]',
      render: (fc) => fc.critique || '—',
    },
  ];

  if (review) {
    columns.push({
      key: 'review',
      header: 'Review',
      width: 'w-24',
      render: (fc) => (
        <InlineReviewBadge
          decision={review.getEdit(`field:${fc.fieldPath}`, 'severity')?.decision}
          isDraft={review.selectedReview?.status === 'draft'}
        />
      ),
    });
  }

  if (isEditing && review) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      width: 'w-24',
      render: (fc) => {
        const { itemKey, item, attr } = reviewableFor(fc);
        const edit = review.getEdit(itemKey, 'severity');
        return (
          <InlineReviewControls
            decision={edit?.decision}
            note={edit?.note}
            originalValue={fc.severity ?? 'NONE'}
            reviewedValue={edit?.reviewedValue}
            allowedValues={attr.allowedValues}
            onReject={() => review.acceptAttribute(item, attr)}
            onClear={() => review.clearAttribute(item, attr)}
            onOverride={(nextSeverity) => review.correctAttribute(item, attr, nextSeverity)}
            onNote={(nextNote) => review.setAttributeNote(item, attr, nextNote)}
          />
        );
      },
    });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      <h3 className="shrink-0 text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        Field Comparison ({fieldCritiques.length} fields)
      </h3>
      {overallAssessment && (
        <p className="shrink-0 text-xs text-[var(--text-secondary)]">{overallAssessment}</p>
      )}
      <DataTable
        columns={columns}
        data={fieldCritiques}
        keyExtractor={(fc) => fc.fieldPath}
        emptyTitle="No fields"
      />
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function StatCard({ label, value, color, beforeValue }: {
  label: string;
  value: string | number;
  color?: string;
  beforeValue?: string | number;
}) {
  const showDelta = beforeValue != null && String(beforeValue) !== String(value);
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3 py-2">
      <p className="text-xs text-[var(--text-muted)] uppercase font-semibold">{label}</p>
      {showDelta ? (
        <p className="text-lg font-bold mt-0.5 flex items-baseline gap-1">
          <span className="text-sm text-[var(--text-muted)] line-through">{beforeValue}</span>
          <span className="text-xs text-[var(--text-muted)]">→</span>
          <span style={{ color: color ?? 'var(--text-primary)' }}>{value}</span>
        </p>
      ) : (
        <p className="text-lg font-bold mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>
          {value}
        </p>
      )}
    </div>
  );
}

function ReviewedStatPill({ totalItems }: { totalItems: number }) {
  const review = useInlineReviewOptional();
  const reviewedCount = useMemo(() => {
    if (!review) return 0;
    return Object.values(review.edits).filter((e) => e.decision !== '').length;
  }, [review]);

  if (!review || totalItems === 0) return null;

  return (
    <StatCard
      label="Reviewed"
      value={`${reviewedCount} / ${totalItems}`}
      color={reviewedCount > 0 ? 'var(--color-success)' : undefined}
    />
  );
}
