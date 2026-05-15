/**
 * Surfaces a failed run's `errorMessage` + per-stage selection diagnostics.
 *
 * Generic by name and shape — any eval flow that finalises a run as `failed`
 * with `config.selection_diagnostics` (the snapshot persisted by the eval
 * runner shell) renders here. Not coupled to any specific app.
 */

import type { EvalRun } from '@/types';

type Stage = {
  label: string;
  count: number;
};

type Diagnostics = {
  universe_total?: number;
  after_universe_predicates?: number;
  after_skip_evaluated?: number;
  selected?: number;
  predicate_summary?: Record<string, unknown>;
};

function readDiagnostics(run: EvalRun): Diagnostics | null {
  const cfg = (run.config ?? {}) as Record<string, unknown>;
  const raw = cfg.selection_diagnostics;
  if (!raw || typeof raw !== 'object') return null;
  return raw as Diagnostics;
}

function readSelectionError(run: EvalRun): { kind: string; missing_ids?: string[] } | null {
  const cfg = (run.config ?? {}) as Record<string, unknown>;
  const raw = cfg.selection_error;
  if (!raw || typeof raw !== 'object') return null;
  return raw as { kind: string; missing_ids?: string[] };
}

export function SelectionDiagnosticsPanel({ run }: { run: EvalRun }) {
  if (run.status !== 'failed') return null;

  const diag = readDiagnostics(run);
  const selError = readSelectionError(run);

  const stages: Stage[] = diag
    ? [
        { label: 'Universe', count: diag.universe_total ?? 0 },
        { label: 'After filters', count: diag.after_universe_predicates ?? 0 },
        { label: 'After skip-evaluated', count: diag.after_skip_evaluated ?? 0 },
        { label: 'Selected', count: diag.selected ?? 0 },
      ]
    : [];

  return (
    <div className="rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] p-4 text-[13px]">
      <div className="font-semibold text-[var(--color-error)] mb-2">Run failed</div>
      {run.errorMessage ? (
        <div className="text-[var(--text-primary)] mb-3">{run.errorMessage}</div>
      ) : null}

      {selError?.kind === 'specific_selection_missing' && selError.missing_ids?.length ? (
        <div className="mb-3">
          <div className="text-[var(--text-secondary)] mb-1">Missing record IDs:</div>
          <ul className="list-disc list-inside text-[var(--text-primary)] font-mono text-[12px] space-y-0.5">
            {selError.missing_ids.slice(0, 10).map((id) => (
              <li key={id}>{id}</li>
            ))}
            {selError.missing_ids.length > 10 && (
              <li>… and {selError.missing_ids.length - 10} more</li>
            )}
          </ul>
        </div>
      ) : null}

      {stages.length > 0 && (
        <div>
          <div className="text-[var(--text-secondary)] mb-1.5">Selection pipeline:</div>
          <div className="grid grid-cols-4 gap-2">
            {stages.map((s) => (
              <div
                key={s.label}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5"
              >
                <div className="text-[11px] uppercase text-[var(--text-muted)]">{s.label}</div>
                <div className="text-[15px] font-semibold text-[var(--text-primary)]">{s.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {diag?.predicate_summary && Object.keys(diag.predicate_summary).length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[var(--text-secondary)] text-[12px]">
            Active predicates
          </summary>
          <pre className="mt-1.5 text-[11px] bg-[var(--bg-primary)] rounded p-2 overflow-x-auto text-[var(--text-primary)]">
            {JSON.stringify(diag.predicate_summary, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
