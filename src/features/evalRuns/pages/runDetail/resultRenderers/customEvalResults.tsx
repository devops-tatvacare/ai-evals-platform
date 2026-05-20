import { ChevronRight } from 'lucide-react';
import { OutputFieldRenderer } from '@/features/evalRuns/components';
import type { EvalRun, OutputFieldDef } from '@/types';
import { formatScore, getScoreColor } from '../utils';

export function CustomEvalResults({ run }: { run: EvalRun }) {
  const result = run.result as Record<string, unknown> | undefined;
  const config = run.config as Record<string, unknown> | undefined;
  const output = (result?.output ?? {}) as Record<string, unknown>;
  const outputSchema = (config?.output_schema ?? []) as OutputFieldDef[];
  const summary = run.summary as Record<string, unknown> | undefined;
  const hasSchemaOutput = Object.keys(output).length > 0 && outputSchema.length > 0;
  const hasRawOutput = Object.keys(output).length > 0 && !hasSchemaOutput;

  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
        {summary?.overall_score != null && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-muted)] uppercase font-semibold">Score</span>
            <span className="text-2xl font-bold" style={{ color: getScoreColor(summary.overall_score as number) }}>
              {formatScore(summary.overall_score as number)}
            </span>
          </div>
        )}

        {hasSchemaOutput && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
              Evaluator Output
            </h3>
            <OutputFieldRenderer schema={outputSchema} output={output} mode="card" />
          </div>
        )}

        {hasRawOutput && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
              Evaluator Output
            </h3>
            <div className="space-y-1.5">
              {Object.entries(output).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <span className="text-[var(--text-muted)] shrink-0 font-medium">{key}:</span>
                  <span className="text-[var(--text-primary)] break-words">
                    {typeof value === 'object' && value !== null
                      ? JSON.stringify(value, null, 2)
                      : String(value ?? '—')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasSchemaOutput && !hasRawOutput && summary?.breakdown != null && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Score Breakdown
            </h3>
            <div className="space-y-1">
              {Object.entries(summary.breakdown as Record<string, unknown>).map(([key, val]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">{key}</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {typeof summary?.reasoning === 'string' && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Reasoning
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{summary.reasoning}</p>
        </div>
      )}

      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
        <details className="group">
          <summary className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Raw Request &amp; Response
          </summary>
          <div className="px-4 pb-3 space-y-3 border-t border-[var(--border-subtle)]">
            {typeof result?.rawRequest === 'string' && (
              <div className="pt-3">
                <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Prompt</p>
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {result.rawRequest}
                </pre>
              </div>
            )}
            {typeof result?.rawResponse === 'string' && (
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Response</p>
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {result.rawResponse}
                </pre>
              </div>
            )}
            {typeof result?.rawRequest !== 'string' && typeof result?.rawResponse !== 'string' && (
              <div className="pt-3">
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
