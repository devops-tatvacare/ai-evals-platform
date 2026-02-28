import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { IntentEvaluation } from '@/types/evalRuns';
import { cn } from '@/utils';
import { truncate, pct } from '@/utils/evalFormatters';

type Filter = 'ALL' | 'CORRECT' | 'INCORRECT';

interface Props {
  evaluations: IntentEvaluation[];
  activeTurnIndex: number | null;
  onRowClick: (turnIndex: number) => void;
  failed?: string;
  skipped?: boolean;
}

export default function IntentTab({ evaluations, activeTurnIndex, onRowClick, failed, skipped }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (failed) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]">
        <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-[var(--text-primary)]">Judge Intent:</span>{' '}
          <span className="text-[var(--text-secondary)]">{failed}</span>
        </div>
      </div>
    );
  }

  if (skipped) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-4 text-center">
        Judge Intent evaluation was skipped for this run.
      </p>
    );
  }

  if (evaluations.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-4 text-center">
        No Judge Intent evaluations available.
      </p>
    );
  }

  const correctCount = evaluations.filter(e => e.is_correct_intent).length;
  const incorrectCount = evaluations.length - correctCount;

  const filtered = filter === 'ALL'
    ? evaluations
    : filter === 'CORRECT'
      ? evaluations.filter(e => e.is_correct_intent)
      : evaluations.filter(e => !e.is_correct_intent);

  return (
    <div className="flex flex-col h-full min-h-0 px-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 pb-3 shrink-0">
        {[
          { key: 'ALL' as Filter, label: 'All', count: evaluations.length },
          { key: 'CORRECT' as Filter, label: 'Correct', count: correctCount },
          { key: 'INCORRECT' as Filter, label: 'Incorrect', count: incorrectCount },
        ].map(f => (
          f.count === 0 && f.key !== 'ALL' ? null : (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-2 py-0.5 text-xs rounded-full border transition-colors',
                filter === f.key
                  ? 'border-[var(--border-brand)] bg-[var(--surface-info)] text-[var(--text-brand)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              )}
            >
              {f.label} ({f.count})
            </button>
          )
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--bg-primary)] z-10">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-8">#</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">User Query</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-28">Kaira Intent</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-28">Judge Intent</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-24">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ie, i) => {
              const origIdx = evaluations.indexOf(ie);
              const isActive = activeTurnIndex === origIdx;
              const isExpanded = expandedIdx === origIdx;

              return (
                <IntentRow
                  key={i}
                  ie={ie}
                  turnIndex={origIdx}
                  isActive={isActive}
                  isExpanded={isExpanded}
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

function IntentRow({
  ie,
  turnIndex,
  isActive,
  isExpanded,
  onRowClick,
  onToggleExpand,
}: {
  ie: IntentEvaluation;
  turnIndex: number;
  isActive: boolean;
  isExpanded: boolean;
  onRowClick: () => void;
  onToggleExpand: () => void;
}) {
  const confidence = ie.confidence != null ? ie.confidence : null;

  return (
    <>
      <tr
        id={`eval-row-intent-${turnIndex}`}
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
            <span
              className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[0.6rem] font-bold text-white ${
                ie.is_correct_intent ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
              }`}
            >
              {ie.is_correct_intent ? '\u2713' : '\u2717'}
            </span>
            <span className="truncate">{truncate(ie.message?.query_text ?? '', 50)}</span>
          </div>
        </td>
        <td className="py-1.5 px-2 text-[var(--text-secondary)] text-xs">
          {ie.message?.intent_detected ?? '\u2014'}
        </td>
        <td className="py-1.5 px-2 text-[var(--text-secondary)] text-xs">
          {ie.predicted_intent ?? '\u2014'}
        </td>
        <td className="py-1.5 px-2">
          {confidence != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-[var(--text-primary)]">{pct(confidence)}</span>
              <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full max-w-[50px]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, confidence * 100)}%`,
                    backgroundColor: confidence >= 0.7 ? 'var(--color-success)' : confidence >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)',
                  }}
                />
              </div>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr className="border-b border-[var(--border-subtle)]">
          <td colSpan={5} className="px-4 py-3 bg-[var(--bg-secondary)]">
            <div className="space-y-2">
              {/* F6: Show query_type evaluation results */}
              {ie.predicted_query_type && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider">Query Type</span>
                  <span className="text-[var(--text-secondary)]">
                    Ground truth: <span className="font-mono">{ie.message?.intent_query_type || '\u2014'}</span>
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    Predicted: <span className="font-mono">{ie.predicted_query_type}</span>
                  </span>
                  {ie.is_correct_query_type === true && (
                    <span className="text-[var(--color-success)] font-semibold">{'\u2713'} Match</span>
                  )}
                  {ie.is_correct_query_type === false && (
                    <span className="text-[var(--color-error)] font-semibold">{'\u2717'} Mismatch</span>
                  )}
                  {ie.is_correct_query_type == null && ie.message?.intent_query_type === '' && (
                    <span className="text-[var(--text-muted)]">No ground truth</span>
                  )}
                </div>
              )}
              {ie.reasoning && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">Reasoning</p>
                  <p className="text-sm text-[var(--text-secondary)]">{ie.reasoning}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
