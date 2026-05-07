/**
 * Phase 14 follow-up — orchestration run-domain TanStack Query hooks.
 *
 * Why this file: pre-existing surfaces (`RunDetailPage`, `CampaignRunsPage`,
 * `WorkflowRunHistoryOverlay`) each fetch run / recipient / action data with
 * their own `useState` + `useEffect`. The unified run inspector (right
 * overlay opened from the builder header) replaces all three and is born
 * TanStack-Query-ified per Phase 15's "server data → TQ" invariant. Old
 * code stays on its current data path until it deletes — no big-bang
 * refactor (Phase 15 hard constraint).
 *
 * Query-key discipline (Phase 15 §5):
 *   - `['orchestration', 'workflow', workflowId, 'runs', filters]` — list
 *   - `['orchestration', 'run', runId]`                            — detail
 *   - `['orchestration', 'run', runId, 'recipients', page]`        — recipients (paginated)
 *   - `['orchestration', 'run', runId, 'actions', page, filters]`  — actions (paginated)
 *
 * Polling: an in-flight run (`status === 'running' | 'waiting' | 'pending'`)
 * sets `refetchInterval` to 5 s on the run detail and the recipient/action
 * tables. Returning `false` from `refetchInterval` once the run is terminal
 * (`completed | failed | cancelled`) stops polling automatically.
 *
 * Mutations are intentionally absent. The only run-side mutation today is
 * `applyOverride` (pause / resume / jump-to-node / remove / complete);
 * that's used by run controls outside the inspector and stays where it is.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getRunAction,
  getRun,
  getRunOverlaySnapshot,
  listRuns,
  listRunActions,
  listRunRecipients,
  listWorkflowActions,
  listWorkflows,
  type RunListResponse,
} from '@/services/api/orchestration';
import {
  ACTIVE_RUN_STATUSES,
  type ActionRow,
  type RecipientState,
  type RunOverlaySnapshot,
  type RunStatus,
  type Workflow,
  type WorkflowActionListResponse,
  type WorkflowRun,
} from '@/features/orchestration/types';

// Backend max for these endpoints today is 200; we'll keep all hooks
// page-sized at this default so the table's client-side pagination has a
// sensible chunk to slice. When the backend grows cursor support, swap
// the queryFn to pass cursor + invalidate per page; the hook surface
// stays.
const PAGE_SIZE_DEFAULT = 100;
const TERMINAL_STALE_TIME_MS = 30_000;
const ACTIVE_REFETCH_INTERVAL_MS = 5_000;
const WORKFLOW_ACTIONS_REFETCH_INTERVAL_MS = 30_000;

const ACTIVE_STATUS_SET = new Set<RunStatus>(ACTIVE_RUN_STATUSES);

function isActiveStatus(status: RunStatus | null | undefined): boolean {
  return status ? ACTIVE_STATUS_SET.has(status) : false;
}

// ─── Query-key factories ────────────────────────────────────────────────
// Centralised so invalidation in future PRs (e.g. when a manual run fires
// from the header) can target the right keys without copy-pasting tuples.

export const runQueryKeys = {
  workflowRuns: (workflowId: string, status?: string, limit = PAGE_SIZE_DEFAULT) =>
    [
      'orchestration',
      'workflow',
      workflowId,
      'runs',
      { status: status ?? null, limit },
    ] as const,
  run: (runId: string) =>
    ['orchestration', 'run', runId] as const,
  runOverlay: (runId: string) =>
    ['orchestration', 'run', runId, 'overlay'] as const,
  runRecipients: (runId: string, page: number, pageSize: number) =>
    ['orchestration', 'run', runId, 'recipients', { page, pageSize }] as const,
  runActions: (
    runId: string,
    page: number,
    pageSize: number,
    filters: { channel?: string | null; actionType?: string | null } = {},
  ) =>
    [
      'orchestration',
      'run',
      runId,
      'actions',
      { page, pageSize, ...filters },
    ] as const,
  workflowActionsGlobal: (
    page: number,
    pageSize: number,
    filters: WorkflowActionsFilters,
  ) =>
    [
      'orchestration',
      'actions-global',
      { page, pageSize, ...filters },
    ] as const,
  runsGlobal: (page: number, pageSize: number, filters: RunsFilters) =>
    ['orchestration', 'runs-global', { page, pageSize, ...filters }] as const,
};

/** Filter set accepted by `useRuns` (Logs page Workflow runs tab). Mirrors
 *  `listRuns` minus pagination. `workflowId` null means "all workflows in
 *  the caller's app set"; passing one drills into a single workflow. */
export interface RunsFilters {
  appId?: string | null;
  workflowId?: string | null;
  status?: RunStatus | null;
}

function normaliseRunsFilters(filters: RunsFilters | undefined): RunsFilters {
  return {
    appId: filters?.appId ?? null,
    workflowId: filters?.workflowId ?? null,
    status: filters?.status ?? null,
  };
}

/** Filter set accepted by `useWorkflowActions` (Logs page Workflow actions
 *  tab). Mirrors `listWorkflowActions` minus pagination. */
export interface WorkflowActionsFilters {
  appId?: string | null;
  workflowId?: string | null;
  channel?: string | null;
  actionType?: string | null;
  status?: string | null;
  recipientId?: string | null;
  providerCorrelationId?: string | null;
  since?: string | null;
  until?: string | null;
}

function normaliseFilters(filters: WorkflowActionsFilters | undefined): WorkflowActionsFilters {
  return {
    appId: filters?.appId ?? null,
    workflowId: filters?.workflowId ?? null,
    channel: filters?.channel ?? null,
    actionType: filters?.actionType ?? null,
    status: filters?.status ?? null,
    recipientId: filters?.recipientId ?? null,
    providerCorrelationId: filters?.providerCorrelationId ?? null,
    since: filters?.since ?? null,
    until: filters?.until ?? null,
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────────

/** All runs for a workflow. Inspector header dropdown reads the most
 *  recent runs from this; the campaign listing's drill-in icon reads the
 *  same data so cache hits across surfaces. */
export function useWorkflowRuns(
  workflowId: string | null | undefined,
  options?: { status?: RunStatus; limit?: number; enabled?: boolean },
) {
  const limit = options?.limit ?? PAGE_SIZE_DEFAULT;
  const enabled = (options?.enabled ?? true) && Boolean(workflowId);

  return useQuery<RunListResponse>({
    queryKey: enabled
      ? runQueryKeys.workflowRuns(workflowId as string, options?.status, limit)
      : (['orchestration', 'workflow', '__disabled__', 'runs'] as const),
    queryFn: () =>
      listRuns({
        workflowId: workflowId as string,
        status: options?.status,
        limit,
      }),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    // List polls every 5 s when ANY run in the most recent page is active.
    // The query data is the source we read here, so the interval reads
    // through `query.data` via TQ's function-form `refetchInterval`.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.runs?.some((r) => isActiveStatus(r.status));
      return hasActive ? ACTIVE_REFETCH_INTERVAL_MS : false;
    },
  });
}

/** Phase 15.1c — generalised cross-workflow runs hook for the Logs page's
 *  Workflow runs tab. Server-side pagination (the backend caps `limit` at
 *  200), filters mirror `listRuns`. Polls every 5 s while any run in the
 *  current page is active.
 *
 *  Distinct from `useWorkflowRuns` (single-workflow, no offset). Keep the
 *  two hooks separate so the builder/inspector cache (per-workflow) isn't
 *  invalidated by a Logs-page filter change. */
export function useRuns(options?: {
  page?: number;
  pageSize?: number;
  filters?: RunsFilters;
  enabled?: boolean;
}) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? PAGE_SIZE_DEFAULT;
  const enabled = options?.enabled ?? true;
  const filters = normaliseRunsFilters(options?.filters);
  const offset = (page - 1) * pageSize;

  return useQuery<RunListResponse>({
    queryKey: runQueryKeys.runsGlobal(page, pageSize, filters),
    queryFn: () =>
      listRuns({
        appId: filters.appId ?? undefined,
        workflowId: filters.workflowId ?? undefined,
        status: filters.status ?? undefined,
        limit: pageSize,
        offset,
      }),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = data.runs?.some((r) => isActiveStatus(r.status));
      return hasActive ? ACTIVE_REFETCH_INTERVAL_MS : false;
    },
  });
}

/** One run's detail. Polls while in-flight; settles once terminal so the
 *  run inspector's header status pill stays accurate without manual
 *  refresh. */
export function useRun(runId: string | null | undefined) {
  const enabled = Boolean(runId);
  return useQuery<WorkflowRun>({
    queryKey: enabled
      ? runQueryKeys.run(runId as string)
      : (['orchestration', 'run', '__disabled__'] as const),
    queryFn: () => getRun(runId as string),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return isActiveStatus(data.status) ? ACTIVE_REFETCH_INTERVAL_MS : false;
    },
  });
}

/** Recipients for a run, page-sliced. Polls while the run is active so
 *  the per-recipient `currentNodeId` / `status` columns stay fresh. */
export function useRunRecipients(
  runId: string | null | undefined,
  options?: { page?: number; pageSize?: number; runStatus?: RunStatus },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? PAGE_SIZE_DEFAULT;
  const enabled = Boolean(runId);
  const offset = (page - 1) * pageSize;

  return useQuery<RecipientState[]>({
    queryKey: enabled
      ? runQueryKeys.runRecipients(runId as string, page, pageSize)
      : (['orchestration', 'run', '__disabled__', 'recipients'] as const),
    queryFn: () =>
      listRunRecipients(runId as string, { limit: pageSize, offset }),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: () =>
      isActiveStatus(options?.runStatus) ? ACTIVE_REFETCH_INTERVAL_MS : false,
  });
}

/** Action log rows for a run, page-sliced. Optional channel /
 *  action-type filters mirror the backend `listRunActions` query string. */
export function useRunActions(
  runId: string | null | undefined,
  options?: {
    page?: number;
    pageSize?: number;
    channel?: string | null;
    actionType?: string | null;
    runStatus?: RunStatus;
  },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? PAGE_SIZE_DEFAULT;
  const enabled = Boolean(runId);
  const offset = (page - 1) * pageSize;

  return useQuery<ActionRow[]>({
    queryKey: enabled
      ? runQueryKeys.runActions(runId as string, page, pageSize, {
          channel: options?.channel ?? null,
          actionType: options?.actionType ?? null,
        })
      : (['orchestration', 'run', '__disabled__', 'actions'] as const),
    queryFn: () =>
      listRunActions(runId as string, {
        channel: options?.channel ?? undefined,
        actionType: options?.actionType ?? undefined,
        limit: pageSize,
        offset,
      }),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: () =>
      isActiveStatus(options?.runStatus) ? ACTIVE_REFETCH_INTERVAL_MS : false,
  });
}

export function useRunAction(
  runId: string | null | undefined,
  actionId: string | null | undefined,
) {
  const enabled = Boolean(runId && actionId);
  return useQuery<ActionRow>({
    queryKey: enabled
      ? (['orchestration', 'run', runId as string, 'action', actionId as string] as const)
      : (['orchestration', 'run', '__disabled__', 'action'] as const),
    queryFn: () => getRunAction(runId as string, actionId as string),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
  });
}

/** Per-node overlay snapshot for a run — what the canvas paints. The
 *  inspector hydrates `runOverlayStore` from this so the builder canvas
 *  behind the overlay shows the correct per-node statuses for the
 *  selected past run, not just live SSE-streamed runs.
 *
 *  Polling matches `useRun`: in-flight runs refetch every 5 s, terminal
 *  runs settle to a one-shot fetch with the standard stale time. */
export function useRunOverlaySnapshot(
  runId: string | null | undefined,
  options?: { runStatus?: RunStatus },
) {
  const enabled = Boolean(runId);
  return useQuery<RunOverlaySnapshot>({
    queryKey: enabled
      ? runQueryKeys.runOverlay(runId as string)
      : (['orchestration', 'run', '__disabled__', 'overlay'] as const),
    queryFn: () => getRunOverlaySnapshot(runId as string),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: () =>
      isActiveStatus(options?.runStatus) ? ACTIVE_REFETCH_INTERVAL_MS : false,
  });
}

/** Look up a single action row from the cached page of actions. The
 *  secondary action-detail overlay reads this so deep-linking
 *  `?action=<id>` works even before the page query settles. Falls back
 *  to scanning whatever page is in cache; if nothing matches, the
 *  caller is expected to render an empty / loading state.
 *
 *  Backend has no GET-by-id endpoint for actions today, so this is a
 *  cache lookup, not a fetch. When the backend gains
 *  `/runs/:runId/actions/:actionId`, swap the body for a real query. */
export function useRunActionFromCache(
  actionsForCurrentPage: ActionRow[] | undefined,
  actionId: string | null | undefined,
): ActionRow | null {
  if (!actionId || !actionsForCurrentPage) return null;
  return actionsForCurrentPage.find((a) => a.id === actionId) ?? null;
}

/** Phase 15.1b — tenant-wide outbound action log. Powers the platform Logs
 *  page's Workflow actions tab. Server-side pagination (the backend caps
 *  ``limit`` at 200), filters mirror ``listWorkflowActions``. Polls every
 *  30 s when at least one workflow run is in flight on the tenant — that
 *  signal is supplied by the caller (so we don't fan out an extra
 *  ``useRuns`` from inside the hook). */
export function useWorkflowActions(
  options?: {
    page?: number;
    pageSize?: number;
    filters?: WorkflowActionsFilters;
    /** When true (caller derives this from a runs query), refetch every
     *  5 s. Defaults to false so closed / archival views are quiet. */
    livePoll?: boolean;
    enabled?: boolean;
  },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? PAGE_SIZE_DEFAULT;
  const enabled = options?.enabled ?? true;
  const filters = normaliseFilters(options?.filters);
  const offset = (page - 1) * pageSize;

  return useQuery<WorkflowActionListResponse>({
    queryKey: runQueryKeys.workflowActionsGlobal(page, pageSize, filters),
    queryFn: () =>
      listWorkflowActions({
        appId: filters.appId ?? undefined,
        workflowId: filters.workflowId ?? undefined,
        channel: filters.channel ?? undefined,
        actionType: filters.actionType ?? undefined,
        status: filters.status ?? undefined,
        recipientId: filters.recipientId ?? undefined,
        providerCorrelationId: filters.providerCorrelationId ?? undefined,
        since: filters.since ?? undefined,
        until: filters.until ?? undefined,
        limit: pageSize,
        offset,
      }),
    enabled,
    staleTime: TERMINAL_STALE_TIME_MS,
    refetchInterval: () => (options?.livePoll ? WORKFLOW_ACTIONS_REFETCH_INTERVAL_MS : false),
  });
}

/** Cache lookup variant of `useRunActionFromCache` for the global rows.
 *  Used by the Workflow actions tab → Action Detail overlay flow so the
 *  detail surface lights up immediately on row click. */
export function useWorkflowActionFromCache(
  page: WorkflowActionListResponse | undefined,
  actionId: string | null | undefined,
) {
  if (!actionId || !page) return null;
  return page.items.find((a) => a.id === actionId) ?? null;
}

/** Phase 15.1b — workflow list for filter Comboboxes (Logs / cross-tab
 *  affordances). App-scoped via the caller's app picker. Workflows change
 *  rarely, so a long stale time keeps the dropdown snappy. */
export function useWorkflows(
  options?: { appId?: string; enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && Boolean(options?.appId);
  return useQuery<Workflow[]>({
    queryKey: enabled
      ? (['orchestration', 'workflows', { appId: options?.appId }] as const)
      : (['orchestration', 'workflows', '__disabled__'] as const),
    queryFn: () => listWorkflows({ appId: options?.appId }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
