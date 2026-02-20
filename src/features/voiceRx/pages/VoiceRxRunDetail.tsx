import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, Clock, Calendar, Cpu, ArrowLeft, Trash2, FileText } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import { VerdictBadge, OutputFieldRenderer } from '@/features/evalRuns/components';
import DistributionBar from '@/features/evalRuns/components/DistributionBar';
import { fetchEvalRun, deleteEvalRun } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { routes } from '@/config/routes';
import { formatTimestamp, formatDuration, pct } from '@/utils/evalFormatters';
import type { EvalRun, OutputFieldDef, AIEvaluation, FieldCritique } from '@/types';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'completed_with_errors']);
const POLL_INTERVAL_MS = 4000;

/* ── Page ────────────────────────────────────────────────── */

export function VoiceRxRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollRef = useRef(false);

  // Initial fetch
  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    fetchEvalRun(runId)
      .then(setRun)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  // Poll while run is in-progress
  useEffect(() => {
    if (!runId || !run || TERMINAL_STATUSES.has(run.status)) return;
    if (pollRef.current) return;
    pollRef.current = true;

    const id = setInterval(() => {
      fetchEvalRun(runId)
        .then((updated) => {
          setRun(updated);
          if (TERMINAL_STATUSES.has(updated.status)) {
            clearInterval(id);
            pollRef.current = false;
          }
        })
        .catch(() => { /* polling error — retry next tick */ });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(id);
      pollRef.current = false;
    };
  }, [runId, run?.status]);

  const handleDelete = useCallback(async () => {
    if (!run) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(run.id);
      notificationService.success('Run deleted');
      navigate(routes.voiceRx.runs);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }, [run, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="space-y-3">
        <Link to={routes.voiceRx.runs} className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-brand)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Runs
        </Link>
        <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error || 'Run not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
        <Link to={routes.voiceRx.runs} className="hover:text-[var(--text-brand)]">Runs</Link>
        <span>/</span>
        <span className="font-mono text-[var(--text-secondary)]">{run.id.slice(0, 12)}</span>
      </div>

      {/* Header */}
      <RunHeader run={run} onDelete={() => setDeleteOpen(true)} />

      {/* Route to correct detail renderer */}
      {run.evalType === 'full_evaluation' ? (
        <FullEvaluationDetail run={run} />
      ) : run.evalType === 'custom' ? (
        <CustomEvalDetail run={run} />
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Unknown evaluation type: {run.evalType}
        </p>
      )}

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Run"
        description="Delete this evaluator run? This cannot be undone."
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}

/* ── RunHeader ───────────────────────────────────────────── */

function RunHeader({ run, onDelete }: { run: EvalRun; onDelete: () => void }) {
  const config = run.config as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const evalName =
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    run.evalType ??
    'Evaluation';

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-2.5">
      <div className="flex items-center gap-2">
        <h1 className="text-[13px] font-bold text-[var(--text-primary)] truncate">{evalName}</h1>
        <VerdictBadge verdict={run.status} category="status" />
        <div className="ml-auto flex items-center gap-2">
          <Link
            to={`${routes.voiceRx.logs}?run_id=${run.id}`}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <FileText className="h-3 w-3" />
            Logs
          </Link>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--surface-error)] rounded transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>
      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 text-xs text-[var(--text-muted)]">
        <span className="font-mono">{run.id.slice(0, 12)}</span>
        {run.createdAt && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatTimestamp(run.createdAt)}
          </span>
        )}
        {run.durationMs != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(run.durationMs / 1000)}
          </span>
        )}
        {run.llmModel && (
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {run.llmProvider}/{run.llmModel}
          </span>
        )}
      </div>
      {/* Step-specific error display */}
      {run.status === 'failed' && (
        <div className="mt-2 bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-2.5 text-sm">
          <div className="flex items-center gap-2 text-[var(--color-error)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <strong className="text-xs">
              {(run.result as Record<string, unknown>)?.failedStep
                ? `Failed during ${(run.result as Record<string, unknown>).failedStep}`
                : 'Evaluation failed'}
            </strong>
          </div>
          {run.errorMessage && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{run.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── FullEvaluationDetail ────────────────────────────────── */

function FullEvaluationDetail({ run }: { run: EvalRun }) {
  const result = run.result as AIEvaluation | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;

  if (!result?.critique) {
    return <p className="text-sm text-[var(--text-muted)] italic">No evaluation data.</p>;
  }

  const flowType = result.flowType;
  const warnings = (result as unknown as Record<string, unknown>)?.warnings as string[] | undefined;

  return (
    <div className="space-y-4">
      {/* Normalization warnings */}
      {warnings && warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2.5 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-semibold mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings
          </div>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
      {/* Summary stats */}
      {summary != null && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summary.overall_accuracy != null && (
            <StatCard label="Overall Accuracy" value={pct(summary.overall_accuracy as number)} />
          )}
          {summary.total_items != null && (
            <StatCard
              label={summary.flow_type === 'api' ? 'Total Fields' : 'Total Segments'}
              value={summary.total_items as number}
            />
          )}
          {summary.critical_errors != null && (
            <StatCard
              label="Critical Errors"
              value={summary.critical_errors as number}
              color={(summary.critical_errors as number) > 0 ? 'var(--color-error)' : undefined}
            />
          )}
          {summary.moderate_errors != null && (
            <StatCard
              label="Moderate Errors"
              value={summary.moderate_errors as number}
              color={(summary.moderate_errors as number) > 0 ? 'var(--color-warning)' : undefined}
            />
          )}
        </div>
      )}

      {/* Severity distribution bar */}
      {summary?.severity_distribution != null && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Severity Distribution
          </h3>
          <DistributionBar
            distribution={summary.severity_distribution as Record<string, number>}
            order={['NONE', 'MINOR', 'MODERATE', 'CRITICAL']}
          />
        </div>
      )}

      {/* Flow-specific detail — dispatched by explicit flowType */}
      {flowType === 'upload' && result.critique.segments ? (
        <SegmentTable segments={result.critique.segments} />
      ) : flowType === 'api' && result.critique.fieldCritiques ? (
        <FieldCritiqueTable
          fieldCritiques={result.critique.fieldCritiques}
          overallAssessment={result.critique.overallAssessment}
        />
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">No detail data.</p>
      )}

      {/* Raw data (collapsible) */}
      <details className="group">
        <summary className="text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
          Show raw prompts &amp; responses
        </summary>
        <pre className="mt-2 text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-64 text-[var(--text-secondary)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/* ── SegmentTable (upload flow) ──────────────────────────── */

function SegmentTable({ segments }: { segments: Array<Record<string, unknown>> }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
        Segment Comparison ({segments.length} segments)
      </h3>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Original</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">AI Transcript</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-24">Severity</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Discrepancy</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, i) => (
              <tr key={i} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 text-xs text-[var(--text-muted)] align-top">
                  {(seg.segmentIndex as number) ?? i + 1}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs text-[var(--text-primary)]">
                    {seg.originalText as string || '\u2014'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs text-[var(--text-primary)]">
                    {seg.judgeText as string || '\u2014'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <SeverityBadge severity={seg.severity as string} />
                </td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px] align-top">
                  {seg.discrepancy as string || '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── FieldCritiqueTable (API flow) ───────────────────────── */

function FieldCritiqueTable({ fieldCritiques, overallAssessment }: {
  fieldCritiques: FieldCritique[];
  overallAssessment: string;
}) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
        Field Comparison ({fieldCritiques.length} fields)
      </h3>
      {overallAssessment && (
        <p className="text-xs text-[var(--text-secondary)] mb-3">{overallAssessment}</p>
      )}
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Field</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">API Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Judge Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-24">Severity</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Critique</th>
            </tr>
          </thead>
          <tbody>
            {fieldCritiques.map((fc, i) => (
              <tr key={i} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 text-xs font-mono text-[var(--text-primary)] align-top">
                  {fc.fieldPath}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs font-mono text-[var(--text-secondary)]">
                    {fc.apiValue == null ? '\u2014' : typeof fc.apiValue === 'object' ? JSON.stringify(fc.apiValue) : String(fc.apiValue)}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs font-mono text-[var(--text-secondary)]">
                    {fc.judgeValue == null ? '\u2014' : typeof fc.judgeValue === 'object' ? JSON.stringify(fc.judgeValue) : String(fc.judgeValue)}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <SeverityBadge severity={fc.severity} />
                </td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px] align-top">
                  {fc.critique || '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── CustomEvalDetail ────────────────────────────────────── */

function CustomEvalDetail({ run }: { run: EvalRun }) {
  const result = run.result as Record<string, unknown> | undefined;
  const config = run.config as Record<string, unknown> | undefined;
  const output = (result?.output ?? {}) as Record<string, unknown>;
  const outputSchema = (config?.output_schema ?? []) as OutputFieldDef[];
  const summary = run.summary as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      {/* Score summary card */}
      {summary?.overall_score != null && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <span className="text-xs text-[var(--text-muted)] uppercase font-semibold">Score</span>
          <p className="text-2xl font-bold mt-1" style={{
            color: getScoreColor(summary.overall_score as number)
          }}>
            {formatScore(summary.overall_score as number)}
          </p>
        </div>
      )}

      {/* Output fields rendered via OutputFieldRenderer */}
      {Object.keys(output).length > 0 && outputSchema.length > 0 ? (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
            Evaluator Output
          </h3>
          <OutputFieldRenderer schema={outputSchema} output={output} mode="card" />
        </div>
      ) : Object.keys(output).length > 0 ? (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
            Evaluator Output
          </h3>
          <div className="space-y-1.5">
            {Object.entries(output).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-sm">
                <span className="text-[var(--text-muted)] shrink-0 font-medium">{key}:</span>
                <span className="text-[var(--text-primary)] break-words">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '\u2014')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Score breakdown */}
      {summary?.breakdown != null && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Score Breakdown
          </h3>
          <div className="space-y-1">
            {Object.entries(summary.breakdown as Record<string, unknown>).map(([key, val]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{key}</span>
                <span className="text-[var(--text-primary)] font-medium">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {typeof summary?.reasoning === 'string' && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Reasoning
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{summary.reasoning}</p>
        </div>
      )}

      {/* Raw data (collapsible) */}
      <details className="group">
        <summary className="text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
          Show raw request &amp; response
        </summary>
        <div className="mt-2 space-y-2">
          {typeof result?.rawRequest === 'string' && (
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-1">Prompt</p>
              <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                {result.rawRequest}
              </pre>
            </div>
          )}
          {typeof result?.rawResponse === 'string' && (
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-1">Response</p>
              <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                {result.rawResponse}
              </pre>
            </div>
          )}
          {typeof result?.rawRequest !== 'string' && typeof result?.rawResponse !== 'string' && (
            <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      </details>
    </div>
  );
}

/* ── Shared sub-components ───────────────────────────────── */

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3 py-2">
      <p className="text-xs text-[var(--text-muted)] uppercase font-semibold">{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = (severity ?? 'none').toUpperCase();
  const styles: Record<string, { bg: string; text: string }> = {
    NONE:     { bg: 'var(--surface-success)', text: 'var(--color-success)' },
    MINOR:    { bg: 'var(--bg-tertiary)',     text: 'var(--text-muted)' },
    MODERATE: { bg: 'var(--surface-warning)', text: 'var(--color-warning)' },
    CRITICAL: { bg: 'var(--surface-error)',   text: 'var(--color-error)' },
  };
  const st = styles[s] ?? styles.MINOR;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase inline-block"
      style={{ backgroundColor: st.bg, color: st.text }}
    >
      {s === 'NONE' ? 'Match' : s}
    </span>
  );
}

function getScoreColor(value: number): string {
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.7) return 'var(--color-success)';
  if (v >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatScore(value: number): string {
  if (value <= 1) return `${(value * 100).toFixed(0)}%`;
  return String(value);
}
