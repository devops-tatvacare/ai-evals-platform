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

import { fireManualRun } from '@/services/api/orchestration';
import {
  createDraftVersion,
  getWorkflow,
  publishVersion,
} from '@/services/api/orchestration';
import { useAppStore } from '@/stores/appStore';
import { WorkflowHeaderBar } from '@/features/orchestration/components/WorkflowHeaderBar';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

describe('WorkflowHeaderBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ currentApp: 'inside-sales' });
    useWorkflowBuilderStore.getState().reset();
    useWorkflowBuilderStore.getState().setMetadata({
      workflowId: 'wf-1',
      versionId: 'ver-1',
      name: 'Concierge Workflow',
      workflowType: 'crm',
      currentPublishedVersionId: 'ver-1',
    });
    (fireManualRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'run-live-1',
    });
  });

  it('starts a manual run and surfaces it via onRunStarted, staying on the builder', async () => {
    // Phase 13 UX: Run Now keeps the user on the builder canvas. Live node
    // pills + edge highlights render in-place via runOverlayStore. The page
    // host receives the run through ``onRunStarted`` to drive the SSE
    // session; navigation is reserved for the explicit "Open run" action
    // on the run-detail surface, never automatic.
    const onRunStarted = vi.fn();
    render(<WorkflowHeaderBar onRunStarted={onRunStarted} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run Now' }));

    await waitFor(() => expect(fireManualRun).toHaveBeenCalledWith('wf-1'));
    await waitFor(() =>
      expect(onRunStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-live-1' })),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the header in publishing state while publish auto-saves dirty edits', async () => {
    useWorkflowBuilderStore.getState().addNode({
      id: 'dirty-1',
      type: 'sink.complete',
      position: { x: 0, y: 0 },
      data: { label: 'End', nodeType: 'sink.complete' },
      config: {},
    });

    (
      createDraftVersion as ReturnType<typeof vi.fn>
    ).mockImplementation(async () => ({
      id: 'ver-2',
      definition: useWorkflowBuilderStore.getState().toDefinition(),
    }));

    let resolvePublish: () => void = () => {};
    const publishPromise = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    (publishVersion as ReturnType<typeof vi.fn>).mockReturnValue(publishPromise);
    (getWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentPublishedVersionId: 'ver-2',
    });

    render(<WorkflowHeaderBar />);

    // Phase-14 follow-up — workflow lands in view mode. Enter edit mode
    // before any save/publish action surfaces.
    fireEvent.click(screen.getByRole('button', { name: /Edit workflow/i }));

    // With a dirty change against a published workflow, the lifecycle is
    // `dirty-published-edits` → primary button is `Save Draft`. Publish
    // lives in the overflow dropdown ("More actions").
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Publish$/ }));

    await waitFor(() =>
      expect(createDraftVersion).toHaveBeenCalledWith(
        'wf-1',
        expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ id: 'dirty-1' })]),
        }),
      ),
    );
    await waitFor(() => expect(publishVersion).toHaveBeenCalledWith('wf-1', 'ver-2'));

    // "Publishing…" surfaces twice — once in the lifecycle pill, once
    // on the primary button. The button is the one we care about: it
    // must be disabled while the publish is in flight so the operator
    // can't double-click. `getAllByText` documents that both labels
    // exist; the primary button assertion below is the load-bearing one.
    expect(screen.getAllByText('Publishing…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Publishing…/ })).toBeDisabled();

    resolvePublish();

    await waitFor(() => expect(getWorkflow).toHaveBeenCalledWith('wf-1'));
  });

  it('lands in view mode and shows Run Now + Test Run + Edit; Edit unlocks Save/Publish', async () => {
    render(<WorkflowHeaderBar />);

    // View-mode actions: Run Now, Test Run (disabled), Edit.
    expect(screen.getByRole('button', { name: /Run Now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test Run/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit workflow/i })).toBeInTheDocument();

    // No save / publish surface in view mode — operator can't accidentally
    // mutate a published workflow they only meant to inspect.
    expect(screen.queryByRole('button', { name: /Save Draft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish$/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Edit workflow/i }));

    // Edit mode: the contextual primary surfaces (clean-published →
    // Save Draft, disabled with the "no changes" tooltip).
    await waitFor(() => {
      expect(useWorkflowBuilderStore.getState().viewMode).toBe('edit');
    });
    expect(screen.getByRole('button', { name: /More actions/i })).toBeInTheDocument();
  });

  it('Test Run is disabled with the "coming soon" tooltip in both modes', async () => {
    render(<WorkflowHeaderBar />);

    const testRunView = screen.getByRole('button', { name: /Test Run/i });
    expect(testRunView).toBeDisabled();
    expect(testRunView).toHaveAttribute(
      'title',
      expect.stringMatching(/coming soon/i),
    );

    fireEvent.click(screen.getByRole('button', { name: /Edit workflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    const testRunEdit = await screen.findByRole('button', {
      name: /Test Run/i,
    });
    expect(testRunEdit).toBeDisabled();
  });
});
