// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Workflow, WorkflowRun } from '@/features/orchestration/types';
import type { RunListResponse } from '@/services/api/orchestration';

const { listRunsMock, listWorkflowsMock } = vi.hoisted(() => ({
  listRunsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
}));

vi.mock('@/services/api/orchestration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/orchestration')>();
  return {
    ...actual,
    listRuns: listRunsMock,
    listWorkflows: listWorkflowsMock,
  };
});

import { WorkflowRunsTab } from './WorkflowRunsTab';

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: overrides.id ?? 'run-1',
    workflowId: overrides.workflowId ?? 'wf-1',
    workflowVersionId: overrides.workflowVersionId ?? 'wfv-1',
    triggeredBy: overrides.triggeredBy ?? 'manual',
    triggeredByUserId: overrides.triggeredByUserId ?? 'u-1',
    status: overrides.status ?? 'completed',
    cohortSizeAtEntry: overrides.cohortSizeAtEntry ?? 12,
    startedAt: overrides.startedAt ?? new Date(Date.now() - 60_000).toISOString(),
    completedAt: overrides.completedAt ?? new Date().toISOString(),
    error: overrides.error ?? null,
    params: overrides.params ?? {},
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: overrides.id ?? 'wf-1',
    tenantId: 'tnt',
    appId: 'inside-sales',
    workflowType: overrides.workflowType ?? 'crm',
    slug: overrides.slug ?? 'cardio',
    name: overrides.name ?? 'Cardio Outreach',
    description: null,
    active: true,
    currentPublishedVersionId: null,
    currentPublishedVersionNumber: null,
    createdBy: 'u',
    createdByName: null,
    createdByEmail: null,
    visibility: overrides.visibility ?? 'private',
    sharedBy: overrides.sharedBy ?? null,
    sharedAt: overrides.sharedAt ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunId: null,
    lastRunAt: null,
    lastRunStatus: null,
  } as Workflow;
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/voice-rx/logs"
          element={<WorkflowRunsTab appId="inside-sales" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listRunsMock.mockResolvedValue({
    runs: [
      makeRun({ id: 'run-1', status: 'completed' }),
      makeRun({ id: 'run-2', status: 'failed' }),
      makeRun({ id: 'run-3', status: 'running', completedAt: null }),
    ],
    total: 3,
    limit: 25,
    offset: 0,
  } satisfies RunListResponse);
  listWorkflowsMock.mockResolvedValue([makeWorkflow()]);
});

afterEach(() => {
  vi.clearAllMocks();
});

test('renders rows from listRuns and resolves workflow names', async () => {
  renderAt('/voice-rx/logs');
  expect(await screen.findAllByText('Cardio Outreach', { selector: 'span' })).toHaveLength(3);
  expect(listRunsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales', limit: 25, offset: 0 }),
  );
});

test('?status=failed deep-link forwards filter to backend', async () => {
  renderAt('/voice-rx/logs?status=failed');
  await screen.findAllByText('Cardio Outreach', { selector: 'span' });
  expect(listRunsMock).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'inside-sales', status: 'failed' }),
  );
});

test('clicking a status pill writes to URL and re-fetches', async () => {
  const user = userEvent.setup();
  renderAt('/voice-rx/logs');
  await screen.findAllByText('Cardio Outreach', { selector: 'span' });
  await user.click(screen.getByRole('button', { name: 'Failed' }));
  expect(listRunsMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ appId: 'inside-sales', status: 'failed' }),
  );
});

test('row click navigates to the workflow run sub-route page', async () => {
  const user = userEvent.setup();
  const { container } = renderAt('/voice-rx/logs');
  const rows = await screen.findAllByText('Cardio Outreach', { selector: 'span' });
  const row = rows[0].closest('tr')!;
  await user.click(within(row).getAllByText('Cardio Outreach')[0]);
  // Sub-route navigation, no overlay opens.
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
