import { create } from 'zustand';

import type { NodeOverlayStatus } from '@/features/orchestration/components/CustomNode';
import type { RunOverlaySnapshot, RunStatus } from '@/features/orchestration/types';

export interface NodeStepState {
  status: NodeOverlayStatus;
  inputCohortSize?: number;
  outputsSummary?: Record<string, unknown>;
  error?: string;
}

export type RunStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

interface RunOverlayState {
  /** Run currently owning the overlay state. Protects against stale updates
   *  when the user navigates between runs and an older request/stream finishes
   *  late. */
  runId: string | null;
  /** True after at least one deterministic snapshot has hydrated the store. */
  hydrated: boolean;
  /** Lifecycle status of the SSE stream itself (NOT the run). */
  streamStatus: RunStreamStatus;
  /** Lifecycle status of the run as reported by run.* events. */
  runStatus: RunStatus;
  /** Last error string reported by `run.failed`, used by toast surface. */
  runError: string | null;
  /** Per-node aggregated state (latest event wins). */
  byNodeId: Record<string, NodeStepState>;

  reset(): void;
  activateRun(runId: string): void;
  clearRun(runId?: string): void;
  hydrateSnapshot(runId: string, snapshot: RunOverlaySnapshot): void;
  setStreamStatus(runId: string, status: RunStreamStatus): void;
  applyEvent(runId: string, event: { type: string; [k: string]: unknown }): void;
}

function emptyState(runId: string | null = null): Pick<
  RunOverlayState,
  'runId' | 'hydrated' | 'streamStatus' | 'runStatus' | 'runError' | 'byNodeId'
> {
  return {
    runId,
    hydrated: false,
    streamStatus: 'idle',
    runStatus: 'pending',
    runError: null,
    byNodeId: {},
  };
}

export const useRunOverlayStore = create<RunOverlayState>((set) => ({
  ...emptyState(),

  reset: () => set(emptyState()),

  activateRun: (runId) =>
    set((state) => (state.runId === runId ? {} : emptyState(runId))),

  clearRun: (runId) =>
    set((state) => {
      if (runId && state.runId !== runId) {
        return {};
      }
      return emptyState();
    }),

  hydrateSnapshot: (runId, snapshot) =>
    set((state) => {
      if (state.runId !== null && state.runId !== runId) {
        return {};
      }
      return {
        runId,
        hydrated: true,
        runStatus: snapshot.run.status,
        runError: snapshot.run.error,
        byNodeId: Object.fromEntries(
          snapshot.nodeSteps.map((step) => [
            step.nodeId,
            {
              status: step.status,
              inputCohortSize:
                typeof step.inputsSummary?.cohort_size === 'number'
                  ? step.inputsSummary.cohort_size
                  : undefined,
              outputsSummary: step.outputsSummary ?? undefined,
              error: step.error ?? undefined,
            } satisfies NodeStepState,
          ]),
        ),
      };
    }),

  setStreamStatus: (runId, status) =>
    set((state) => (state.runId === runId ? { streamStatus: status } : {})),

  applyEvent: (runId, e) =>
    set((s) => {
      if (s.runId !== runId) {
        return {};
      }
      const nid = e.node_id as string | undefined;
      switch (e.type) {
        case 'run.started':
          return { runStatus: 'running' };
        case 'run.completed': {
          const status = (e.status as RunStatus) ?? 'completed';
          return { runStatus: status };
        }
        case 'run.failed':
          return {
            runStatus: 'failed',
            runError: typeof e.error === 'string' ? e.error : null,
          };
        case 'run.cancelled':
          return { runStatus: 'cancelled' };
        case 'node_step.started':
          if (!nid) return {};
          return {
            byNodeId: {
              ...s.byNodeId,
              [nid]: {
                status: 'running',
                inputCohortSize: e.input_cohort_size as number | undefined,
              },
            },
          };
        case 'node_step.completed':
          if (!nid) return {};
          return {
            byNodeId: {
              ...s.byNodeId,
              [nid]: {
                status: 'completed',
                outputsSummary: e.outputs_summary as Record<string, unknown> | undefined,
                inputCohortSize: s.byNodeId[nid]?.inputCohortSize,
              },
            },
          };
        case 'node_step.failed':
          if (!nid) return {};
          return {
            byNodeId: {
              ...s.byNodeId,
              [nid]: {
                status: 'failed',
                error: typeof e.error === 'string' ? e.error : undefined,
                inputCohortSize: s.byNodeId[nid]?.inputCohortSize,
              },
            },
          };
        default:
          return {};
      }
    }),
}));
