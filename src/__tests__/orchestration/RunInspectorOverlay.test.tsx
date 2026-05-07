/**
 * Phase-14 follow-up — RunInspectorOverlay smoke + URL-sync coverage.
 *
 * Verifies:
 *  1. The overlay's empty-state path when the workflow has no runs.
 *  2. The picker dropdown lists runs returned by `useWorkflowRuns`.
 *  3. The recipients tab renders rows from `useRunRecipients` via DataTable.
 *  4. Clicking an action row in the actions tab calls `onChangeActionId`
 *     so the page can push `?action=<id>` into the URL.
 *
 * Mocks the orchestration API service functions directly — same pattern
 * used by other overlay tests in this directory.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/orchestration')>();
  return {
    ...actual,
    listRuns: vi.fn(),
    getRun: vi.fn(),
    listRunRecipients: vi.fn(),
    listRunActions: vi.fn(),
  };
});

import {
  getRun,
  listRuns,
  listRunActions,
  listRunRecipients,
} from '@/services/api/orchestration';
import { RunInspectorOverlay } from '@/features/orchestration/components/runs/RunInspectorOverlay';
import type {
  ActionRow,
  RecipientState,
  WorkflowRun,
} from '@/features/orchestration/types';

const RUN_BASE: WorkflowRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  workflowVersionId: 'v-1',
  triggeredBy: 'manual',
  triggeredByUserId: 'user-1',
  status: 'running',
  cohortSizeAtEntry: 124,
  startedAt: '2026-05-06T14:23:00Z',
  completedAt: null,
  error: null,
  params: {},
  createdAt: '2026-05-06T14:22:50Z',
};

const RECIPIENT: RecipientState = {
  recipientId: 'lead-008712',
  currentNodeId: 'sink',
  status: 'completed',
  wakeupAt: null,
  payload: { plan: 'gold' },
  enrolledAt: '2026-05-06T14:23:00Z',
  completedAt: '2026-05-06T14:24:00Z',
  error: null,
};

const ACTION: ActionRow = {
  id: 'act-1',
  recipientId: 'lead-008712',
  channel: 'wati',
  actionType: 'wati_template_sent',
  status: 'success',
  idempotencyKey: 'k-1',
  payload: {},
  response: null,
  providerCorrelationId: 'msg-9821',
  providerStatus: 'delivered',
  providerTerminal: true,
  error: null,
  parentActionId: null,
  createdAt: '2026-05-06T14:23:14Z',
  completedAt: '2026-05-06T14:23:15Z',
};

function setMocks(opts: {
  runs?: WorkflowRun[];
  run?: WorkflowRun | null;
  recipients?: RecipientState[];
  actions?: ActionRow[];
}) {
  (listRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
    runs: opts.runs ?? [],
    total: opts.runs?.length ?? 0,
    limit: 100,
    offset: 0,
  });
  (getRun as ReturnType<typeof vi.fn>).mockResolvedValue(opts.run ?? RUN_BASE);
  (listRunRecipients as ReturnType<typeof vi.fn>).mockResolvedValue(
    opts.recipients ?? [],
  );
  (listRunActions as ReturnType<typeof vi.fn>).mockResolvedValue(
    opts.actions ?? [],
  );
}

describe('RunInspectorOverlay', () => {
  const baseProps = {
    workflowId: 'wf-1',
    runId: 'run-1' as string | null,
    actionId: null as string | null,
    tabId: 'recipients',
    onChangeRunId: vi.fn(),
    onChangeTab: vi.fn(),
    onChangeActionId: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when the workflow has zero runs', async () => {
    setMocks({ runs: [] });
    render(<RunInspectorOverlay {...baseProps} runId={null} />);
    await waitFor(() => {
      expect(screen.getByText('No runs yet')).toBeInTheDocument();
    });
    expect(screen.queryByText('Active run')).not.toBeInTheDocument();
  });

  it('renders the run header + recipients table when a run is selected', async () => {
    setMocks({ runs: [RUN_BASE], run: RUN_BASE, recipients: [RECIPIENT] });
    render(<RunInspectorOverlay {...baseProps} />);

    // Run header surface — picker is visible from the moment runs load.
    await waitFor(() => {
      expect(screen.getByText('Active run')).toBeInTheDocument();
    });
    // Run meta strip waits for `useRun` to resolve, which is a separate
    // query from the runs list. Use a separate waitFor for it.
    await waitFor(() => {
      expect(screen.getByText(/Cohort/)).toBeInTheDocument();
    });

    // Recipients tab is the default; the table renders the row
    await waitFor(() => {
      expect(screen.getByText('lead-008712')).toBeInTheDocument();
    });
  });

  it('clicking an action row pushes the action id back through onChangeActionId', async () => {
    setMocks({ runs: [RUN_BASE], run: RUN_BASE, actions: [ACTION] });
    render(<RunInspectorOverlay {...baseProps} tabId="actions" />);

    await waitFor(() => {
      expect(screen.getByText('wati_template_sent')).toBeInTheDocument();
    });
    // The DataTable row click bubbles to onRowClick — we click the cell
    // text and expect the URL push (onChangeActionId('act-1')) to happen.
    fireEvent.click(screen.getByText('wati_template_sent'));
    await waitFor(() => {
      expect(baseProps.onChangeActionId).toHaveBeenCalledWith('act-1');
    });
  });

  it('shows a "Pick a run" empty state when runs exist but none is selected', async () => {
    setMocks({ runs: [RUN_BASE] });
    render(<RunInspectorOverlay {...baseProps} runId={null} />);
    await waitFor(() => {
      expect(screen.getByText('Pick a run to inspect')).toBeInTheDocument();
    });
  });
});
