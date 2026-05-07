/**
 * Phase 14 / Phase E — publish-error surfacing on the builder header
 * + the canvas node decoration.
 *
 * What this exercises end-to-end inside the FE store:
 *   1. A 400 with array `detail` (the new structured 400 from the
 *      Python validator — same shape as 422 dispatch errors) decodes
 *      into `kind: 'fieldErrors'`.
 *   2. The lifecycle store's `lastPublishOutcome` carries the body so
 *      `usePublishErrorsByNodeId` derives a per-node group.
 *   3. `<PublishErrorPanel>` renders one row per item, with node label
 *      + field prefix.
 *   4. `selectPublishErrorsByNodeId` returns an empty record when the
 *      outcome is success / non-fieldErrors / null.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/services/api/orchestration', () => ({
  createDraftVersion: vi.fn(),
  fireManualRun: vi.fn(),
  getWorkflow: vi.fn(),
  publishVersion: vi.fn(),
}));

vi.mock('@/services/notifications', () => ({
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  createDraftVersion,
  publishVersion,
} from '@/services/api/orchestration';
import { ApiError } from '@/services/api/client';
import { WorkflowHeaderBar } from '@/features/orchestration/components/WorkflowHeaderBar';
import {
  selectPublishErrorsByNodeId,
  useWorkflowBuilderStore,
} from '@/features/orchestration/store/workflowBuilderStore';
import { decodeApiError } from '@/features/orchestration/contracts/errorDecoder';
import { useAppStore } from '@/stores/appStore';

describe('PublishErrorSurfacing — Phase 14 / Phase E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ currentApp: 'inside-sales' });
    useWorkflowBuilderStore.getState().reset();
    useWorkflowBuilderStore.getState().setMetadata({
      workflowId: 'wf-1',
      versionId: 'ver-1',
      name: 'WF',
      workflowType: 'crm',
      currentPublishedVersionId: null,
    });
    useWorkflowBuilderStore.getState().addNode({
      id: 'wati-1',
      type: 'crm.send_wati',
      position: { x: 0, y: 0 },
      data: { label: 'WATI', nodeType: 'crm.send_wati' },
      config: {},
    });
    useWorkflowBuilderStore.getState().addNode({
      id: 'edge-bad',
      type: 'sink.complete',
      position: { x: 0, y: 0 },
      data: { label: 'End', nodeType: 'sink.complete' },
      config: {},
    });
  });

  it('renders mixed publish errors (missing template + duplicate edge) in the panel + decorates nodes', async () => {
    // Server-shape body — array detail with two issues.
    const body = {
      detail: [
        {
          node_id: 'wati-1',
          field: 'config.template_name',
          message: 'Pick the WATI message template.',
        },
        {
          node_id: 'edge-bad',
          field: 'edges[e1]',
          message: "duplicate edge id: 'e1'",
        },
      ],
    };
    (createDraftVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ver-2',
      definition: useWorkflowBuilderStore.getState().toDefinition(),
    });
    (publishVersion as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, 'Publish failed', body),
    );

    render(<WorkflowHeaderBar />);

    // Phase-14 follow-up — workflow lands in view mode. Enter edit, then
    // open the overflow dropdown to reach Publish (a `dirty-draft`
    // lifecycle keeps Save Draft as primary; Publish moves to the menu).
    fireEvent.click(screen.getByRole('button', { name: /Edit workflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Publish$/ }));

    // Both messages render in the panel.
    await waitFor(() => {
      expect(
        screen.getByText('Pick the WATI message template.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("duplicate edge id: 'e1'")).toBeInTheDocument();

    // Lifecycle outcome carries the structured body.
    const outcome = useWorkflowBuilderStore.getState().lastPublishOutcome;
    expect(outcome?.status).toBe('fail');
    if (outcome?.status === 'fail') {
      expect(outcome.error.kind).toBe('fieldErrors');
    }

    // Per-node selector groups by node id so the canvas decoration can
    // render a badge on each affected card.
    const grouped = selectPublishErrorsByNodeId(outcome ?? null);
    expect(grouped['wati-1']).toBeDefined();
    expect(grouped['wati-1']).toHaveLength(1);
    expect(grouped['edge-bad']).toBeDefined();
  });

  it('selectPublishErrorsByNodeId returns {} for null / ok / message outcomes', () => {
    expect(selectPublishErrorsByNodeId(null)).toEqual({});
    expect(
      selectPublishErrorsByNodeId({ status: 'ok', at: 1 }),
    ).toEqual({});
    expect(
      selectPublishErrorsByNodeId({
        status: 'fail',
        at: 1,
        error: { kind: 'message', message: 'boom' },
      }),
    ).toEqual({});
  });

  it('a 400 with array detail decodes to fieldErrors (same path as 422)', () => {
    const arr = [
      { node_id: 'n1', field: 'config', message: 'invalid' },
      { node_id: 'n2', field: 'edges', message: 'bad edge' },
    ];
    const decoded = decodeApiError(
      new ApiError(400, 'Publish failed', { detail: arr }),
    );
    expect(decoded.kind).toBe('fieldErrors');
    if (decoded.kind === 'fieldErrors') {
      expect(decoded.items).toHaveLength(2);
      expect(decoded.items[0].nodeId).toBe('n1');
      expect(decoded.items[0].field).toBe('config');
    }
  });
});
