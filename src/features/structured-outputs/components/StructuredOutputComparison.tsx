import { useState, useMemo } from 'react';
import { Card, Button } from '@/components/ui';
import { CheckCircle, AlertTriangle, Plus, Minus, X } from 'lucide-react';
import { compareJson, calculateMetrics, formatValue } from '@/services/structured-outputs';
import type { JsonDiff, ComparisonMetrics } from '@/services/structured-outputs';
import type { StructuredOutputReference, StructuredOutput } from '@/types';

interface StructuredOutputComparisonProps {
  reference: StructuredOutputReference;
  llmOutput: StructuredOutput;
  onClose: () => void;
}

type DiffFilter = 'all' | 'changed' | 'added' | 'removed' | 'unchanged';

/**
 * Row for displaying a single field comparison
 */
function DiffRow({ diff }: { diff: JsonDiff }) {
  const icon = {
    unchanged: <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />,
    changed: <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />,
    added: <Plus className="h-4 w-4 text-[var(--color-info)]" />,
    removed: <Minus className="h-4 w-4 text-[var(--color-error)]" />,
  }[diff.type];

  const bgColor = {
    unchanged: '',
    changed: 'bg-[var(--color-warning-light)]/20',
    added: 'bg-[var(--color-info-light)]/20',
    removed: 'bg-[var(--color-error-light)]/20',
  }[diff.type];

  return (
    <div className={`grid grid-cols-[40px_1fr_1fr] gap-3 px-4 py-3 border-b border-[var(--border-subtle)] ${bgColor}`}>
      {/* Icon */}
      <div className="flex items-start pt-1">
        {icon}
      </div>

      {/* Field path */}
      <div>
        <code className="text-[11px] font-mono text-[var(--text-primary)] break-all">
          {diff.path}
        </code>
      </div>

      {/* Values comparison */}
      <div className="space-y-1">
        {diff.type === 'removed' ? (
          <div>
            <span className="text-[9px] text-[var(--text-muted)] uppercase">Reference</span>
            <p className="text-[12px] text-[var(--text-secondary)] break-all">
              {formatValue(diff.referenceValue)}
            </p>
            <span className="text-[9px] text-[var(--color-error)] italic">Removed in LLM output</span>
          </div>
        ) : diff.type === 'added' ? (
          <div>
            <span className="text-[9px] text-[var(--color-info)] italic">Added in LLM output</span>
            <p className="text-[12px] text-[var(--text-secondary)] break-all">
              {formatValue(diff.llmValue)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <span className="text-[9px] text-[var(--text-muted)] uppercase">Reference</span>
              <p className="text-[12px] text-[var(--text-secondary)] break-all">
                {formatValue(diff.referenceValue)}
              </p>
            </div>
            <div>
              <span className="text-[9px] text-[var(--text-muted)] uppercase">LLM Output</span>
              <p className={`text-[12px] break-all ${diff.type === 'changed' ? 'text-[var(--color-warning)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                {formatValue(diff.llmValue)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Metrics summary bar
 */
function MetricsSummary({ metrics }: { metrics: ComparisonMetrics }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-muted)]">Match Score:</span>
        <span className={`font-semibold ${
          metrics.matchPercentage >= 90 ? 'text-[var(--color-success)]' :
          metrics.matchPercentage >= 70 ? 'text-[var(--color-warning)]' :
          'text-[var(--color-error)]'
        }`}>
          {metrics.matchPercentage}%
        </span>
      </div>
      
      <span className="text-[var(--text-muted)]">•</span>
      
      <span className="flex items-center gap-1 text-[var(--color-success)]">
        <CheckCircle className="h-3 w-3" />
        {metrics.matchingFields} match
      </span>

      {metrics.changedFields > 0 && (
        <span className="text-[var(--color-warning)]">
          {metrics.changedFields} changed
        </span>
      )}
      
      {metrics.addedFields > 0 && (
        <span className="text-[var(--color-info)]">
          {metrics.addedFields} added
        </span>
      )}
      
      {metrics.removedFields > 0 && (
        <span className="text-[var(--color-error)]">
          {metrics.removedFields} removed
        </span>
      )}
    </div>
  );
}

/**
 * Main comparison component
 */
export function StructuredOutputComparison({
  reference,
  llmOutput,
  onClose,
}: StructuredOutputComparisonProps) {
  const [filter, setFilter] = useState<DiffFilter>('all');

  // Compute diffs
  const diffs = useMemo(() => {
    if (!llmOutput.result) return [];
    return compareJson(reference.content, llmOutput.result);
  }, [reference.content, llmOutput.result]);

  // Compute metrics
  const metrics = useMemo(() => calculateMetrics(diffs), [diffs]);

  // Filter diffs
  const filteredDiffs = useMemo(() => {
    if (filter === 'all') return diffs;
    return diffs.filter(d => d.type === filter);
  }, [diffs, filter]);

  // Count by type for filter badges
  const counts = useMemo(() => {
    return {
      all: diffs.length,
      unchanged: diffs.filter(d => d.type === 'unchanged').length,
      changed: diffs.filter(d => d.type === 'changed').length,
      added: diffs.filter(d => d.type === 'added').length,
      removed: diffs.filter(d => d.type === 'removed').length,
    };
  }, [diffs]);

  if (!llmOutput.result) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[var(--text-muted)]">
          LLM output has no result to compare
        </p>
        <Button variant="ghost" onClick={onClose} className="mt-4">
          Close
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <div>
          <h4 className="font-medium text-[var(--text-primary)]">
            Field-by-Field Comparison
          </h4>
          <p className="text-[11px] text-[var(--text-muted)]">
            Reference: {reference.description || reference.uploadedFile?.name || 'Unnamed'}
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Metrics summary */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2">
        <MetricsSummary metrics={metrics} />
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            filter === 'all'
              ? 'bg-[var(--color-brand-primary)] text-[var(--text-on-color)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
          }`}
        >
          All ({counts.all})
        </button>

        {counts.changed > 0 && (
          <button
            onClick={() => setFilter('changed')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              filter === 'changed'
                ? 'bg-[var(--color-warning)] text-[var(--text-on-color)]'
                : 'bg-[var(--color-warning-light)] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20'
            }`}
          >
            Changed ({counts.changed})
          </button>
        )}

        {counts.added > 0 && (
          <button
            onClick={() => setFilter('added')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              filter === 'added'
                ? 'bg-[var(--color-info)] text-[var(--text-on-color)]'
                : 'bg-[var(--color-info-light)] text-[var(--color-info)] hover:bg-[var(--color-info)]/20'
            }`}
          >
            Added ({counts.added})
          </button>
        )}

        {counts.removed > 0 && (
          <button
            onClick={() => setFilter('removed')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              filter === 'removed'
                ? 'bg-[var(--color-error)] text-[var(--text-on-color)]'
                : 'bg-[var(--color-error-light)] text-[var(--color-error)] hover:bg-[var(--color-error)]/20'
            }`}
          >
            Removed ({counts.removed})
          </button>
        )}

        <button
          onClick={() => setFilter('unchanged')}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            filter === 'unchanged'
              ? 'bg-[var(--color-success)] text-[var(--text-on-color)]'
              : 'bg-[var(--color-success-light)] text-[var(--color-success)] hover:bg-[var(--color-success)]/20'
          }`}
        >
          Match ({counts.unchanged})
        </button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[40px_1fr_1fr] gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
        <span /> {/* Icon space */}
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Field Path</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Values</span>
      </div>

      {/* Diff rows */}
      <div className="max-h-[calc(100vh-400px)] min-h-[300px] overflow-auto">
        {filteredDiffs.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[13px]">
            No fields match the selected filter
          </div>
        ) : (
          filteredDiffs.map((diff, index) => (
            <DiffRow key={`${diff.path}-${index}`} diff={diff} />
          ))
        )}
      </div>
    </Card>
  );
}
