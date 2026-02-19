import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { FileSpreadsheet, ShieldAlert, FlaskConical, Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { Run, EvalRun } from "@/types";
import { fetchRuns, deleteRun, fetchEvalRuns, deleteEvalRun } from "@/services/api/evalRunsApi";
import { notificationService } from "@/services/notifications";
import { RunCard, RunRowCard, NewBatchEvalOverlay, NewAdversarialOverlay } from "../components";
import { SplitButton, EmptyState, ConfirmDialog } from "@/components/ui";
import { TAG_ACCENT_COLORS } from "@/utils/statusColors";
import { routes } from "@/config/routes";
import { timeAgo, formatDuration } from "@/utils/evalFormatters";
import { useStableRunUpdate, useStableEvalRunUpdate, useDebouncedValue } from "../hooks";
import type { RunType } from "../types";
import { RUN_TYPE_CONFIG } from "../types";

const PAGE_SIZE = 15;

/* ── Helpers ─────────────────────────────────────────────── */

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getRunName(run: EvalRun): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  return (s?.evaluator_name as string) ?? (c?.evaluator_name as string) ?? run.evalType ?? 'Unknown';
}

function getRunScore(run: EvalRun): { value: string; color: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };
  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      return {
        value: `${(v * 100).toFixed(0)}%`,
        color: v >= 0.7 ? 'var(--color-success)' : v >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)',
      };
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
}

function mapEvalRunStatus(status: EvalRun['status']): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'completed_with_errors': return 'completed_with_errors';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'cancelled': return 'cancelled';
    default: return status;
  }
}

function deriveRunType(command: string): RunType {
  if (command.includes('batch')) return 'batch';
  if (command.includes('adversarial')) return 'adversarial';
  if (command.includes('thread')) return 'thread';
  return 'custom';
}

function deriveCustomRunType(evalType: string): RunType {
  if (evalType === 'batch_thread' || evalType === 'batch_adversarial') return 'batch';
  if (evalType === 'custom') return 'custom';
  return 'thread';
}

function deriveStatusFromRun(run: Run): string {
  const s = run.status.toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'completed_with_errors') return 'completed_with_errors';
  if (s === 'failed' || s === 'interrupted') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'cancelled') return 'cancelled';
  return 'pending';
}

type UnifiedItem =
  | { _kind: 'batch'; ts: number; data: Run }
  | { _kind: 'custom'; ts: number; data: EvalRun };

/* ── Filter chip configs ─────────────────────────────────── */

const TYPE_FILTERS: Array<{ key: RunType | 'all'; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'batch', label: 'Batch', dotColor: RUN_TYPE_CONFIG.batch.color },
  { key: 'adversarial', label: 'Adversarial', dotColor: RUN_TYPE_CONFIG.adversarial.color },
  { key: 'thread', label: 'Thread', dotColor: RUN_TYPE_CONFIG.thread.color },
  { key: 'custom', label: 'Custom', dotColor: RUN_TYPE_CONFIG.custom.color },
];

const STATUS_FILTERS: Array<{ key: string; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed', dotColor: 'var(--color-success)' },
  { key: 'partial', label: 'Partial', dotColor: 'var(--color-warning)' },
  { key: 'cancelled', label: 'Cancelled', dotColor: 'var(--color-warning)' },
  { key: 'failed', label: 'Failed', dotColor: 'var(--color-error)' },
  { key: 'running', label: 'Running', dotColor: 'var(--color-info)' },
];

/* ── Component ───────────────────────────────────────────── */

export default function RunList() {
  const location = useLocation();
  const [runs, setRuns] = useState<Run[]>([]);
  const [customRuns, setCustomRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBatchWizard, setShowBatchWizard] = useState(false);
  const [showAdversarialWizard, setShowAdversarialWizard] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<RunType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Pagination
  const [page, setPage] = useState(0);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<EvalRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Shimmer fix: only show loading on first load
  const isInitialLoad = useRef(true);
  const stableSetRuns = useStableRunUpdate(setRuns);
  const stableSetCustomRuns = useStableEvalRunUpdate(setCustomRuns);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [typeFilter, statusFilter, debouncedSearch]);

  const loadRuns = useCallback(() => {
    if (isInitialLoad.current) {
      setLoading(true);
    }
    setError("");
    Promise.all([
      fetchRuns({ app_id: 'kaira-bot', limit: 200 }).then((r) => r.runs).catch(() => [] as Run[]),
      fetchEvalRuns({ app_id: 'kaira-bot', eval_type: 'custom', limit: 200 }).catch(() => [] as EvalRun[]),
    ])
      .then(([batchRuns, customRunsResult]) => {
        stableSetRuns(batchRuns);
        stableSetCustomRuns(customRunsResult);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [stableSetRuns, stableSetCustomRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns, location.key]);

  // Light polling when runs are active
  const hasRunning = useMemo(
    () => [...runs, ...customRuns].some((r) => {
      const status = 'status' in r ? r.status : '';
      return status === 'running' || status === 'RUNNING';
    }),
    [runs, customRuns],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => loadRuns(), 5000);
    return () => clearInterval(interval);
  }, [hasRunning, loadRuns]);

  /* ── Unified + filtered items ──────────────────────────── */

  const unifiedItems = useMemo((): UnifiedItem[] => {
    const customRunIds = new Set(customRuns.map((r) => r.id));
    const items: UnifiedItem[] = [
      ...runs
        .filter((r) => !customRunIds.has(r.run_id))
        .map((r): UnifiedItem => ({ _kind: 'batch', ts: new Date(r.timestamp).getTime(), data: r })),
      ...customRuns.map((r): UnifiedItem => ({ _kind: 'custom', ts: new Date(r.createdAt).getTime(), data: r })),
    ];
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [runs, customRuns]);

  const filteredItems = useMemo(() => {
    let result = unifiedItems;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((item) => {
        if (item._kind === 'batch') return deriveRunType(item.data.command) === typeFilter;
        return deriveCustomRunType(item.data.evalType) === typeFilter;
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((item) => {
        const s = item._kind === 'batch'
          ? deriveStatusFromRun(item.data)
          : mapEvalRunStatus(item.data.status);
        if (statusFilter === 'partial') return s === 'completed_with_errors';
        if (statusFilter === 'failed') return s === 'failed';
        if (statusFilter === 'completed') return s === 'completed';
        if (statusFilter === 'cancelled') return s === 'cancelled';
        if (statusFilter === 'running') return s === 'running';
        return true;
      });
    }

    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((item) => {
        if (item._kind === 'batch') {
          const run = item.data;
          return (run.name || run.command).toLowerCase().includes(q) ||
            run.run_id.toLowerCase().includes(q);
        }
        const run = item.data;
        return getRunName(run).toLowerCase().includes(q) ||
          run.id.toLowerCase().includes(q);
      });
    }

    return result;
  }, [unifiedItems, typeFilter, statusFilter, debouncedSearch]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* ── Delete handlers ───────────────────────────────────── */

  const handleDelete = useCallback(async (runId: string) => {
    try {
      await deleteRun(runId);
      setRuns((prev) => prev.filter((r) => r.run_id !== runId));
    } catch (e: any) {
      notificationService.error(e.message, "Delete failed");
    }
  }, []);

  const handleDeleteCustom = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setCustomRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed', "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  /* ── Render custom row ─────────────────────────────────── */

  function renderCustomRow(run: EvalRun) {
    const name = getRunName(run);
    const color = TAG_ACCENT_COLORS[hashString(name) % TAG_ACCENT_COLORS.length];
    const { value: score, color: sColor } = getRunScore(run);
    return (
      <RunRowCard
        key={run.id}
        to={`${routes.kaira.logs}?entity_id=${run.id}`}
        status={mapEvalRunStatus(run.status)}
        title={name}
        titleColor={color}
        score={score}
        scoreColor={sColor}
        id={run.id.slice(0, 8)}
        metadata={[
          ...(run.sessionId ? [{ text: run.sessionId.slice(0, 8) }] : []),
          { text: run.evalType },
          { text: run.durationMs ? formatDuration(run.durationMs / 1000) : '--' },
        ]}
        timeAgo={run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : ''}
        onDelete={() => setDeleteTarget(run)}
        runType={deriveCustomRunType(run.evalType)}
        modelName={run.llmModel || undefined}
        provider={run.llmProvider || undefined}
      />
    );
  }

  /* ── Error state ───────────────────────────────────────── */

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  const hasActiveFilters = typeFilter !== 'all' || statusFilter !== 'all' || debouncedSearch.length > 0;

  return (
    <div className="space-y-3 flex-1 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>
        <div className="flex items-center gap-2">
          <SplitButton
            primaryLabel="Batch Evaluation"
            primaryIcon={<FileSpreadsheet className="h-4 w-4" />}
            primaryAction={() => setShowBatchWizard(true)}
            size="sm"
            dropdownItems={[
              {
                label: 'Batch Evaluation',
                icon: <FileSpreadsheet className="h-4 w-4" />,
                description: 'Evaluate conversation threads from CSV data',
                action: () => setShowBatchWizard(true),
              },
              {
                label: 'Adversarial Stress Test',
                icon: <ShieldAlert className="h-4 w-4" />,
                description: 'Run adversarial inputs against live Kaira API',
                action: () => setShowAdversarialWizard(true),
              },
            ]}
          />
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="space-y-2">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or ID..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type label + filters */}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Type</span>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                typeFilter === f.key
                  ? 'bg-[var(--surface-info)] text-[var(--color-info)] border border-[var(--border-info)]'
                  : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {f.dotColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: f.dotColor }}
                />
              )}
              {f.label}
            </button>
          ))}

          <span className="text-[var(--border-default)] mx-1">|</span>

          {/* Status label + filters */}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Status</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                statusFilter === f.key
                  ? 'bg-[var(--surface-info)] text-[var(--color-info)] border border-[var(--border-info)]'
                  : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {f.dotColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: f.dotColor }}
                />
              )}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {pagedItems.map((item) =>
            item._kind === 'batch'
              ? <RunCard key={item.data.run_id} run={item.data} onDelete={handleDelete} onStatusChange={loadRuns} />
              : renderCustomRow(item.data),
          )}
          {pagedItems.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={hasActiveFilters ? Search : FlaskConical}
                title={hasActiveFilters ? 'No matching runs' : 'No runs found'}
                description={hasActiveFilters
                  ? 'Try changing the filters or search query.'
                  : 'Start a batch evaluation, adversarial test, or run a custom evaluator to see results here.'}
              />
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-1 pb-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-colors ${
                page === i
                  ? 'bg-[var(--interactive-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {showBatchWizard && <NewBatchEvalOverlay onClose={() => setShowBatchWizard(false)} />}
      {showAdversarialWizard && <NewAdversarialOverlay onClose={() => setShowAdversarialWizard(false)} />}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteCustom}
        title="Delete Run"
        description={`Delete this evaluator run (${deleteTarget ? getRunName(deleteTarget) : ''})? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
