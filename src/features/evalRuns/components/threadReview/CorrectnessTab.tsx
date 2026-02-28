import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { CorrectnessEvaluation, CorrectnessVerdict } from '@/types/evalRuns';
import VerdictBadge from '../VerdictBadge';
import RuleComplianceInline from '../RuleComplianceInline';
import { cn } from '@/utils';
import { normalizeLabel, truncate } from '@/utils/evalFormatters';

type Filter = 'ALL' | CorrectnessVerdict;

interface Props {
  evaluations: CorrectnessEvaluation[];
  activeTurnIndex: number | null;
  onRowClick: (turnIndex: number) => void;
  failed?: string;
  skipped?: boolean;
}

const VERDICT_FILTERS: Filter[] = ['ALL', 'PASS', 'SOFT FAIL', 'HARD FAIL', 'CRITICAL'];

export default function CorrectnessTab({ evaluations, activeTurnIndex, onRowClick, failed, skipped }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (failed) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]">
        <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-[var(--text-primary)]">Correctness:</span>{' '}
          <span className="text-[var(--text-secondary)]">{failed}</span>
        </div>
      </div>
    );
  }

  if (skipped) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-4 text-center">
        Correctness evaluation was skipped for this run.
      </p>
    );
  }

  // Filter out NOT APPLICABLE by default
  const applicable = evaluations.filter(
    (c) => normalizeLabel(c.verdict ?? '').trim() !== 'NOT APPLICABLE',
  );

  if (applicable.length === 0) {
    const totalEvaluations = evaluations.length;
    const notApplicableCount = evaluations.filter(
      (c) => normalizeLabel(c.verdict ?? '').trim() === 'NOT APPLICABLE',
    ).length;

    return (
      <div className="text-sm text-[var(--text-muted)] py-4 text-center space-y-1">
        <p>No applicable correctness evaluations.</p>
        {notApplicableCount > 0 && (
          <p className="text-xs">
            {notApplicableCount} of {totalEvaluations} messages were evaluated but contained no meal summaries.
          </p>
        )}
        {notApplicableCount === 0 && totalEvaluations === 0 && (
          <p className="text-xs">
            No messages were processed by the correctness evaluator.
          </p>
        )}
      </div>
    );
  }

  // Count by verdict
  const counts: Record<string, number> = { ALL: applicable.length };
  for (const ce of applicable) {
    const v = normalizeLabel(ce.verdict);
    counts[v] = (counts[v] ?? 0) + 1;
  }

  const filtered = filter === 'ALL'
    ? applicable
    : applicable.filter(ce => normalizeLabel(ce.verdict) === filter);

  return (
    <div className="flex flex-col h-full min-h-0 px-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 pb-3 shrink-0">
        {VERDICT_FILTERS.map(f => {
          const count = counts[f] ?? 0;
          if (f !== 'ALL' && count === 0) return null;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-0.5 text-xs rounded-full border transition-colors',
                filter === f
                  ? 'border-[var(--border-brand)] bg-[var(--surface-info)] text-[var(--text-brand)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              )}
            >
              {f === 'ALL' ? 'All' : f} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-primary)] z-10">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-8">#</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">User Query</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-20">Verdict</th>
              <th className="text-center text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-10">IMG</th>
              <th className="text-center text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-12">Rules</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ce, i) => {
              // Find the original turn index by matching query_text across all evaluations
              const origIdx = evaluations.indexOf(ce);
              const isActive = activeTurnIndex === origIdx;
              const isExpanded = expandedIdx === origIdx;
              const violations = ce.rule_compliance?.filter(r => !r.followed) ?? [];

              return (
                <CorrectnessRow
                  key={i}
                  ce={ce}
                  turnIndex={origIdx}
                  isActive={isActive}
                  isExpanded={isExpanded}
                  violations={violations.length}
                  onRowClick={() => onRowClick(origIdx)}
                  onToggleExpand={() => setExpandedIdx(isExpanded ? null : origIdx)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CorrectnessRow({
  ce,
  turnIndex,
  isActive,
  isExpanded,
  violations,
  onRowClick,
  onToggleExpand,
}: {
  ce: CorrectnessEvaluation;
  turnIndex: number;
  isActive: boolean;
  isExpanded: boolean;
  violations: number;
  onRowClick: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <>
      <tr
        id={`eval-row-correctness-${turnIndex}`}
        className={cn(
          'border-b border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors',
          isActive && 'ring-2 ring-inset ring-[var(--border-brand)] bg-[var(--surface-info)]',
        )}
        onClick={onRowClick}
      >
        <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono text-xs">{turnIndex + 1}</td>
        <td className="py-1.5 px-2 text-[var(--text-primary)]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
              className="shrink-0 p-0.5 hover:bg-[var(--bg-tertiary)] rounded"
            >
              {isExpanded
                ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" />
                : <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
              }
            </button>
            <span className="truncate">{truncate(ce.message?.query_text ?? '', 60)}</span>
          </div>
        </td>
        <td className="py-1.5 px-2">
          <VerdictBadge verdict={ce.verdict} category="correctness" />
        </td>
        <td className="py-1.5 px-2 text-center">
          {ce.has_image_context && (
            <span className="inline-block px-1.5 py-px rounded text-[10px] font-semibold bg-[var(--color-accent-purple)] text-white">
              IMG
            </span>
          )}
        </td>
        <td className="py-1.5 px-2 text-center">
          {violations > 0 && (
            <span className="inline-block px-1.5 py-px rounded-full text-[10px] font-semibold bg-[var(--color-error)] text-white">
              {violations}
            </span>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr className="border-b border-[var(--border-subtle)]">
          <td colSpan={5} className="px-4 py-3 bg-[var(--bg-secondary)]">
            <div className="space-y-2">
              {ce.reasoning && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">Reasoning</p>
                  <p className="text-sm text-[var(--text-secondary)]">{ce.reasoning}</p>
                </div>
              )}
              {ce.rule_compliance?.length > 0 && <RuleComplianceInline rules={ce.rule_compliance} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
