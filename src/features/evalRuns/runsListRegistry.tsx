import type { ReactNode } from 'react';
import { Clock, MoreVertical, Trash2, Square, Loader2 } from 'lucide-react';
import type { EvalRun, AppId } from '@/types';
import type { ColumnDef, FilterFieldConfig } from '@/components/ui';
import {
  ModelBadge,
  VisibilityBadge,
} from '@/components/ui';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { apiLogsForApp, runDetailForApp } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { scoreColor as insideSalesScoreColor } from '@/utils/scoreUtils';
import { cn } from '@/utils/cn';
import type { RunType } from './types';
import { RUN_TYPE_CONFIG } from './types';

/* ── Shared row type used by every per-app config ───────────────── */

export interface RunsListRow {
  id: string;
  kind: 'run' | 'queued';
  runType: RunType;
  title: string;
  status: string;
  score: string;
  scoreColor: string;
  scoreBadge?: string;
  passRate: number | null;
  visibility?: 'private' | 'shared';
  ownerName?: string;
  items?: string;
  evalTypeLabel?: string;
  duration?: string;
  modelName?: string;
  provider?: string;
  dateStr: string;
  isRunning: boolean;
  jobId?: string;
  progress?: { current: number; total: number };
  hasHumanReview: boolean;
  run?: EvalRun;
}

export interface ColumnFactoryDeps {
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  onDelete: (row: RunsListRow) => void;
  onCancel: (jobId: string) => void;
}

export interface EmptyCopy {
  icon: 'runs' | 'search';
  defaultTitle: string;
  defaultDescription: string;
  filteredTitle: string;
  filteredDescription: string;
}

export interface RunsListConfig {
  filterFields: FilterFieldConfig[];
  allowedRunTypes?: ReadonlyArray<'batch' | 'adversarial' | 'thread' | 'custom' | 'evaluation'>;
  extractScore: (run: EvalRun) => { value: string; color: string; badge?: string };
  extractProgress?: (run: EvalRun) => { current: number; total: number } | undefined;
  deriveRunType: (run: EvalRun) => RunType;
  deriveTitle: (run: EvalRun) => string;
  deriveEvalTypeLabel?: (run: EvalRun) => string;
  buildItemsLabel?: (run: EvalRun) => string | undefined;
  resolveRowHref: (row: RunsListRow, appId: AppId) => string;
  buildColumns: (deps: ColumnFactoryDeps) => ColumnDef<RunsListRow>[];
  includeQueuedJobs: boolean;
  emptyCopy: EmptyCopy;
}

/* ── Status styles (shared) ──────────────────────────────────────── */

const STATUS_STYLES: Record<
  string,
  { color: string; dot: string; label: string; pulseClass?: string }
> = {
  completed: { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Completed' },
  success: { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Success' },
  completed_with_errors: {
    color: 'var(--color-warning)',
    dot: 'var(--color-warning)',
    label: 'Partial',
  },
  partial: { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  cancelled: { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Cancelled' },
  failed: { color: 'var(--color-error)', dot: 'var(--color-error)', label: 'Failed' },
  error: { color: 'var(--color-error)', dot: 'var(--color-error)', label: 'Error' },
  running: {
    color: 'var(--color-info)',
    dot: 'var(--color-info)',
    label: 'Running',
    pulseClass: 'animate-pulse',
  },
  pending: { color: 'var(--text-muted)', dot: 'var(--text-muted)', label: 'Pending' },
  queued: {
    color: 'var(--color-info)',
    dot: 'var(--color-info)',
    label: 'Queued',
    pulseClass: 'animate-pulse',
  },
};

/* ── Column builders (composable) ────────────────────────────────── */

function typeColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'type',
    header: 'TYPE',
    width: 'w-[110px]',
    render: (row) => {
      const config = RUN_TYPE_CONFIG[row.runType];
      return (
        <span
          className="inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-white whitespace-nowrap"
          style={{ backgroundColor: config.color }}
        >
          {config.label}
        </span>
      );
    },
  };
}

function nameColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'name',
    header: 'NAME',
    width: 'min-w-[200px]',
    render: (row) => (
      <div>
        <span className="font-semibold text-sm text-[var(--text-primary)]">{row.title}</span>
        <br />
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {row.id.slice(0, 8)}
        </span>
      </div>
    ),
  };
}

function scoreColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'score',
    header: 'SCORE',
    width: 'w-20',
    render: (row) => (
      <div className="flex flex-col">
        <span className="text-sm font-semibold" style={{ color: row.scoreColor }}>
          {row.score}
        </span>
        {row.scoreBadge && (
          <span className="text-[10px] text-[var(--text-muted)] leading-tight">
            {row.scoreBadge}
          </span>
        )}
      </div>
    ),
  };
}

// Pass rate is backend-derived (null for non-adversarial); render N/A when absent.
function passRateColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'passRate',
    header: 'PASS RATE',
    width: 'w-20',
    render: (row) => {
      if (row.passRate == null) {
        return <span className="text-sm text-[var(--text-muted)]">N/A</span>;
      }
      const v = row.passRate;
      const color =
        v >= 0.7
          ? 'var(--color-success)'
          : v >= 0.4
          ? 'var(--color-warning)'
          : 'var(--color-error)';
      return (
        <span className="text-sm font-semibold" style={{ color }}>
          {`${(v * 100).toFixed(0)}%`}
        </span>
      );
    },
  };
}

function statusColumn(options: { showProgress: boolean }): ColumnDef<RunsListRow> {
  return {
    key: 'status',
    header: 'STATUS',
    width: options.showProgress ? 'w-[140px]' : 'w-[120px]',
    sortable: true,
    render: (row) => {
      if (row.status === 'queued') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap border-[var(--color-info)] text-[var(--color-info)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Queued
          </span>
        );
      }
      const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
      const label =
        options.showProgress && row.isRunning && row.progress
          ? `Running (${row.progress.current}/${row.progress.total})`
          : style.label;
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
          style={{ borderColor: style.color, color: style.color }}
        >
          <span
            className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', style.pulseClass)}
            style={{ backgroundColor: style.dot }}
          />
          {label}
        </span>
      );
    },
  };
}

function visibilityColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'visibility',
    header: 'VISIBILITY',
    width: 'w-24',
    render: (row) =>
      row.visibility ? (
        <VisibilityBadge visibility={row.visibility} compact />
      ) : (
        <span className="text-[var(--text-muted)]">--</span>
      ),
  };
}

function ownerColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'owner',
    header: 'OWNER',
    width: 'w-28',
    render: (row) => (
      <span className="text-xs text-[var(--text-secondary)] truncate block max-w-[100px]">
        {row.ownerName ?? '--'}
      </span>
    ),
  };
}

function itemsColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'items',
    header: 'ITEMS',
    width: 'w-20',
    render: (row) => (
      <span className="text-xs text-[var(--text-secondary)]">{row.items ?? '--'}</span>
    ),
  };
}

function evalTypeColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'eval_type',
    header: 'EVAL TYPE',
    width: 'w-28',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-[var(--text-secondary)]">{row.evalTypeLabel ?? '--'}</span>
    ),
  };
}

function durationColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'duration_ms',
    header: 'DURATION',
    width: 'w-24',
    sortable: true,
    render: (row) => (
      <span className="text-xs text-[var(--text-secondary)]">{row.duration ?? '--'}</span>
    ),
  };
}

function modelColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'model',
    header: 'MODEL',
    width: 'w-[140px]',
    render: (row) =>
      row.modelName ? (
        <ModelBadge
          modelName={row.modelName}
          provider={row.provider}
          variant="inline"
        />
      ) : (
        <span className="text-[var(--text-muted)]">--</span>
      ),
  };
}

function dateColumn(): ColumnDef<RunsListRow> {
  return {
    key: 'created_at',
    header: 'DATE',
    width: 'w-24',
    sortable: true,
    render: (row) => (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] whitespace-nowrap">
        <Clock className="h-3 w-3" />
        {row.dateStr}
      </span>
    ),
  };
}

function actionsColumn(
  deps: ColumnFactoryDeps,
  options: { allowCancelOnQueuedSyntheticRow: boolean },
): ColumnDef<RunsListRow> {
  return {
    key: 'actions',
    header: '',
    width: 'w-16',
    render: (row) => {
      const jobIdFromQueued =
        options.allowCancelOnQueuedSyntheticRow && row.kind === 'queued' ? row.id : undefined;
      const jobId = row.jobId ?? jobIdFromQueued;
      const isActive = row.status === 'queued' || row.status === 'pending' || row.isRunning;
      const canCancel = isActive && !!jobId;
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <Popover
            open={deps.menuOpenId === row.id}
            onOpenChange={(open) => deps.setMenuOpenId(open ? row.id : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-fit min-w-[140px] rounded-[8px] bg-[var(--bg-elevated)] py-1"
            >
              {canCancel && (
                <PermissionGate action="evaluation:cancel">
                  <button
                    type="button"
                    onClick={() => {
                      deps.onCancel(jobId!);
                      deps.setMenuOpenId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Cancel
                  </button>
                </PermissionGate>
              )}
              {row.kind === 'run' && (
                <PermissionGate action="evaluation:delete">
                  <button
                    type="button"
                    disabled={isActive}
                    onClick={() => {
                      deps.onDelete(row);
                      deps.setMenuOpenId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)] disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </PermissionGate>
              )}
            </PopoverContent>
          </Popover>
        </div>
      );
    },
  };
}

/* ── Score extractors ────────────────────────────────────────────── */

function formatPctOrUnit(v: number): { value: string; color: string } {
  const normalized = v > 1 ? v / 100 : v;
  return {
    value: v > 1 ? `${v.toFixed(0)}` : `${(v * 100).toFixed(0)}%`,
    color:
      normalized >= 0.7
        ? 'var(--color-success)'
        : normalized >= 0.4
        ? 'var(--color-warning)'
        : 'var(--color-error)',
  };
}

function kairaScore(run: EvalRun): { value: string; color: string; badge?: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };

  const evaluators = s.evaluators as Array<{ average_score?: number }> | undefined;
  const avg = s.average_score;
  if (typeof avg === 'number' && Number.isFinite(avg)) {
    const formatted = formatPctOrUnit(avg);
    return evaluators && evaluators.length > 1
      ? { ...formatted, badge: `avg of ${evaluators.length}` }
      : formatted;
  }

  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      return formatPctOrUnit(v);
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
}

function voiceRxScore(run: EvalRun): { value: string; color: string; badge?: string } {
  const summary = run.summary as Record<string, unknown> | undefined;
  if (!summary) return { value: '--', color: 'var(--text-muted)' };

  const scoreKeys = [
    'overall_score',
    'overall_accuracy',
    'score',
    'accuracy',
    'pass_rate',
    'factual_integrity_score',
  ];
  for (const key of scoreKeys) {
    const val = summary[key];
    if (typeof val === 'number') {
      const raw = val > 1 ? val / 100 : val;
      return {
        value: val <= 1 ? `${(val * 100).toFixed(0)}%` : String(val),
        color:
          raw >= 0.7
            ? 'var(--color-success)'
            : raw >= 0.4
            ? 'var(--color-warning)'
            : 'var(--color-error)',
      };
    }
    if (typeof val === 'boolean') {
      return {
        value: val ? 'Pass' : 'Fail',
        color: val ? 'var(--color-success)' : 'var(--color-error)',
      };
    }
  }

  for (const [, val] of Object.entries(summary)) {
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      return formatPctOrUnit(val);
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
}

function insideSalesScore(run: EvalRun): { value: string; color: string } {
  const summary = run.summary as Record<string, unknown> | undefined;
  const score = summary?.overall_score as number | undefined;
  if (typeof score !== 'number') return { value: '--', color: 'var(--text-muted)' };
  const rounded = Math.round(score);
  return { value: String(rounded), color: insideSalesScoreColor(rounded) };
}

/* ── Title deriver ───────────────────────────────────────────────── */

function defaultTitle(run: EvalRun, fallback: string): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  const batch = run.batchMetadata as Record<string, unknown> | undefined;
  return (
    (s?.evaluator_name as string) ??
    (c?.evaluator_name as string) ??
    (batch?.name as string) ??
    run.evalType ??
    fallback
  );
}

function insideSalesTitle(run: EvalRun): string {
  const config = run.config as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const meta = run.batchMetadata as Record<string, unknown> | undefined;
  return (
    (config?.run_name as string) ??
    (meta?.run_name as string) ??
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    'Call Quality Evaluation'
  );
}

/* ── Run-type derivers ───────────────────────────────────────────── */

function kairaRunType(run: EvalRun): RunType {
  const t = run.evalType;
  if (t === 'batch_thread') return 'batch';
  if (t === 'batch_adversarial') return 'adversarial';
  if (t === 'custom') return 'custom';
  if (t === 'full_evaluation') return 'evaluation';
  return 'thread';
}

function voiceRxRunType(run: EvalRun): RunType {
  const t = run.evalType;
  if (t === 'batch_thread' || t === 'batch_adversarial') return 'batch';
  if (t === 'custom') return 'custom';
  return 'evaluation';
}

/* ── Per-app filter fields ───────────────────────────────────────── */

const KAIRA_FILTER_FIELDS: FilterFieldConfig[] = [
  { key: 'q', label: 'Search', control: 'text', placeholder: 'Search by name or run ID' },
  {
    key: 'run_type',
    label: 'Type',
    control: 'segmented',
    options: [
      { value: 'batch', label: 'Batch' },
      { value: 'adversarial', label: 'Adversarial' },
      { value: 'thread', label: 'Thread' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    control: 'segmented',
    options: [
      { value: 'completed', label: 'Completed' },
      { value: 'completed_with_errors', label: 'Partial' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'failed', label: 'Failed' },
      { value: 'running', label: 'Running' },
    ],
  },
];

const VOICE_RX_FILTER_FIELDS: FilterFieldConfig[] = [
  { key: 'q', label: 'Search', control: 'text', placeholder: 'Search by name or run ID' },
  {
    key: 'run_type',
    label: 'Type',
    control: 'segmented',
    options: [
      { value: 'batch', label: 'Batch' },
      { value: 'evaluation', label: 'Evaluation' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    control: 'segmented',
    options: [
      { value: 'completed', label: 'Completed' },
      { value: 'completed_with_errors', label: 'Partial' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'failed', label: 'Failed' },
      { value: 'running', label: 'Running' },
    ],
  },
];

const INSIDE_SALES_FILTER_FIELDS: FilterFieldConfig[] = [
  { key: 'q', label: 'Search', control: 'text', placeholder: 'Search by name or run ID' },
  {
    key: 'status',
    label: 'Status',
    control: 'segmented',
    options: [
      { value: 'running', label: 'Running' },
      { value: 'completed', label: 'Completed' },
      { value: 'completed_with_errors', label: 'Partial' },
      { value: 'failed', label: 'Failed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
];

/* ── Per-app configs ─────────────────────────────────────────────── */

const KAIRA_CONFIG: RunsListConfig = {
  filterFields: KAIRA_FILTER_FIELDS,
  allowedRunTypes: ['batch', 'adversarial', 'thread', 'custom'],
  extractScore: kairaScore,
  deriveRunType: kairaRunType,
  deriveTitle: (run) => defaultTitle(run, 'Unknown'),
  buildItemsLabel: (run) => {
    const summary = run.summary as Record<string, unknown> | undefined;
    const totalItemsCount =
      (summary?.total_threads as number | undefined) ??
      (summary?.total_tests as number | undefined) ??
      ((run as unknown as { total_items?: number }).total_items as number | undefined) ??
      undefined;
    if (totalItemsCount != null) {
      return `${totalItemsCount} ${run.evalType === 'batch_adversarial' ? 'tests' : 'threads'}`;
    }
    return run.evalType;
  },
  resolveRowHref: (row, appId) =>
    row.runType === 'batch' || row.runType === 'adversarial'
      ? runDetailForApp(appId, row.id)
      : `${apiLogsForApp(appId)}?run_id=${row.id}`,
  buildColumns: (deps) => [
    typeColumn(),
    nameColumn(),
    passRateColumn(),
    statusColumn({ showProgress: false }),
    visibilityColumn(),
    ownerColumn(),
    itemsColumn(),
    durationColumn(),
    modelColumn(),
    dateColumn(),
    actionsColumn(deps, { allowCancelOnQueuedSyntheticRow: true }),
  ],
  includeQueuedJobs: true,
  emptyCopy: {
    icon: 'runs',
    defaultTitle: 'No runs found',
    defaultDescription:
      'Start a batch evaluation, adversarial test, or run a custom evaluator to see results here.',
    filteredTitle: 'No matching runs',
    filteredDescription: 'Try changing the filters or search query.',
  },
};

const VOICE_RX_CONFIG: RunsListConfig = {
  filterFields: VOICE_RX_FILTER_FIELDS,
  allowedRunTypes: ['batch', 'evaluation', 'custom'],
  extractScore: voiceRxScore,
  deriveRunType: voiceRxRunType,
  deriveTitle: (run) => defaultTitle(run, 'Unknown'),
  deriveEvalTypeLabel: (run) => {
    const config = run.config as Record<string, unknown> | undefined;
    return (config?.evaluator_type as string) ?? run.evalType ?? '--';
  },
  resolveRowHref: (row, appId) => runDetailForApp(appId, row.id),
  buildColumns: (deps) => [
    typeColumn(),
    nameColumn(),
    scoreColumn(),
    statusColumn({ showProgress: false }),
    visibilityColumn(),
    ownerColumn(),
    evalTypeColumn(),
    durationColumn(),
    modelColumn(),
    dateColumn(),
    actionsColumn(deps, { allowCancelOnQueuedSyntheticRow: false }),
  ],
  includeQueuedJobs: false,
  emptyCopy: {
    icon: 'runs',
    defaultTitle: 'No evaluator runs yet',
    defaultDescription: 'Run an evaluator on a recording to see results here.',
    filteredTitle: 'No matching runs',
    filteredDescription: 'Try changing the filters or search query.',
  },
};

const INSIDE_SALES_CONFIG: RunsListConfig = {
  filterFields: INSIDE_SALES_FILTER_FIELDS,
  extractScore: insideSalesScore,
  extractProgress: (run) => {
    const summary = run.summary as Record<string, unknown> | undefined;
    const evaluated = summary?.evaluated as number | undefined;
    const total = summary?.total as number | undefined;
    if (typeof evaluated === 'number' && typeof total === 'number') {
      return { current: evaluated, total };
    }
    return undefined;
  },
  deriveRunType: () => 'call_quality',
  deriveTitle: insideSalesTitle,
  resolveRowHref: (row, appId) => runDetailForApp(appId, row.id),
  buildColumns: (deps) => [
    nameColumn(),
    scoreColumn(),
    statusColumn({ showProgress: true }),
    visibilityColumn(),
    ownerColumn(),
    durationColumn(),
    modelColumn(),
    dateColumn(),
    actionsColumn(deps, { allowCancelOnQueuedSyntheticRow: false }),
  ],
  includeQueuedJobs: false,
  emptyCopy: {
    icon: 'runs',
    defaultTitle: 'No evaluation runs yet',
    defaultDescription: 'Start a new evaluation from the wizard.',
    filteredTitle: 'No matching runs',
    filteredDescription: 'Try changing the filters or search query.',
  },
};

const REGISTRY: Record<AppId, RunsListConfig> = {
  'kaira-bot': KAIRA_CONFIG,
  'voice-rx': VOICE_RX_CONFIG,
  'inside-sales': INSIDE_SALES_CONFIG,
};

export function getRunsListConfig(appId: AppId): RunsListConfig {
  return REGISTRY[appId];
}

/* ── Row builder shared across apps ──────────────────────────────── */

export interface BuildRowInput {
  run: EvalRun;
  config: RunsListConfig;
}

export function buildRunsListRow({ run, config }: BuildRowInput): RunsListRow {
  const { value: score, color, badge } = config.extractScore(run);
  const status = run.status;
  const isRunning = status === 'running';
  return {
    id: run.id,
    kind: 'run',
    runType: config.deriveRunType(run),
    title: config.deriveTitle(run),
    status,
    score,
    scoreColor: color,
    scoreBadge: badge,
    passRate: run.passRate ?? null,
    visibility: run.visibility,
    ownerName: run.ownerName ?? undefined,
    items: config.buildItemsLabel?.(run),
    evalTypeLabel: config.deriveEvalTypeLabel?.(run),
    duration: run.durationMs ? formatDuration(run.durationMs / 1000) : '--',
    modelName: run.llmModel || undefined,
    provider: run.llmProvider || undefined,
    dateStr: run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : '',
    isRunning,
    jobId: run.jobId,
    progress: config.extractProgress?.(run),
    hasHumanReview: !!run.latestReviewId,
    run,
  };
}

/* ── Re-export for consumers (keep shared import surface minimal) ──── */

export type { ReactNode };
