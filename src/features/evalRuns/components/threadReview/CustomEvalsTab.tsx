import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CustomEvaluationResult, EvaluatorDescriptor } from '@/types/evalRuns';
import { FieldValue } from '../OutputFieldRenderer';
import { cn } from '@/utils';
import { humanize } from '@/utils/evalFormatters';

interface Props {
  customEvaluations: Record<string, CustomEvaluationResult>;
  evaluatorDescriptors?: EvaluatorDescriptor[];
}

export default function CustomEvalsTab({ customEvaluations, evaluatorDescriptors }: Props) {
  const entries = Object.entries(customEvaluations);
  const [activeEvalId, setActiveEvalId] = useState<string | null>(entries[0]?.[1]?.evaluator_id ?? null);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-sm text-[var(--text-muted)]">
          No custom evaluations available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full px-4 pb-4">
      {/* Sub-nav pills if multiple evaluators */}
      {entries.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {entries.map(([, ce]) => (
            <button
              key={ce.evaluator_id}
              onClick={() => setActiveEvalId(ce.evaluator_id)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-full border transition-colors',
                activeEvalId === ce.evaluator_id
                  ? 'border-[var(--border-brand)] bg-[var(--surface-info)] text-[var(--text-brand)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              )}
            >
              {ce.evaluator_name}
            </button>
          ))}
        </div>
      )}

      {/* Render active evaluator */}
      {entries.map(([key, ce]) => {
        if (entries.length > 1 && ce.evaluator_id !== activeEvalId) return null;

        const descriptor = evaluatorDescriptors?.find(d => d.id === ce.evaluator_id);

        if (ce.status === 'failed') {
          return (
            <div key={key} className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]">
              <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-[var(--text-primary)]">{ce.evaluator_name}:</span>{' '}
                <span className="text-[var(--text-secondary)]">{ce.error ?? 'Unknown error'}</span>
              </div>
            </div>
          );
        }

        if (!ce.output) return null;

        const schema = descriptor?.outputSchema?.filter(f => {
          if (f.role) return f.role !== 'reasoning';
          return f.displayMode !== 'hidden';
        });
        const hasDescriptions = schema?.some(f => f.description);

        return (
          <div key={key} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              {ce.evaluator_name}
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">Metric</th>
                    <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-20">Value</th>
                    {hasDescriptions && (
                      <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">Description</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {schema?.length ? (
                    schema.map(f => (
                      <tr key={f.key} className="border-b border-[var(--border-subtle)]">
                        <td className="py-1.5 px-2 font-medium text-[var(--text-primary)]">
                          {f.label || humanize(f.key)}
                        </td>
                        <td className="py-1.5 px-2">
                          <FieldValue field={f} value={ce.output![f.key]} />
                        </td>
                        {hasDescriptions && (
                          <td className="py-1.5 px-2 text-xs text-[var(--text-muted)]">
                            {f.description || ''}
                          </td>
                        )}
                      </tr>
                    ))
                  ) : (
                    Object.entries(ce.output).map(([k, v]) => (
                      <tr key={k} className="border-b border-[var(--border-subtle)]">
                        <td className="py-1.5 px-2 font-medium text-[var(--text-primary)]">
                          {humanize(k)}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--text-secondary)] break-words">
                          {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v ?? '\u2014')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
